// E-Mail-Benachrichtigungen über das SMTP-Postfach der Firma.
//
// Ereignisse:
//   vacation_requested   MA stellt Abwesenheitsantrag      -> Admin
//   vacation_decided     Admin genehmigt / lehnt ab         -> MA
//   correction_requested MA beantragt Zeitkorrektur         -> Admin
//   correction_decided   Admin genehmigt / lehnt Korrektur  -> MA
//   offday_work          MA stempelt an einem Tag, der laut Zeitmodell kein
//                        Arbeitstag ist (oder an einem Feiertag) -> Admin.
//                        Die Zeit wird trotzdem voll gerechnet; die Mail ist
//                        nur ein Hinweis. Der Server prueft selbst, ob der Tag
//                        frei ist, und meldet je MA und Tag nur einmal.
//
// Die App ruft diesen Endpoint nach dem Speichern auf und schickt nur das
// Ereignis und die IDs. Alles Weitere liest der Server selbst – mit dem
// Token des angemeldeten Benutzers, also unter denselben RLS-Regeln. Ein MA
// kann damit nur Mails zu seinen eigenen offenen Anträgen auslösen, eine
// Entscheidungs-Mail nur ein Admin.
//
// Umgebungsvariablen (in Vercel unter Settings -> Environment Variables):
//   SMTP_HOST            z. B. mail.imkereibedarf-seiringer.com
//   SMTP_PORT            587 (STARTTLS) oder 465 (SSL), Standard 587
//   SMTP_SECURE          "true" bei Port 465 (wird bei 465 automatisch gesetzt)
//   SMTP_USER            Login des Postfachs
//   SMTP_PASS            Passwort des Postfachs
//   MAIL_FROM            Absender, z. B. "Zeiterfassung <office@...>"; Standard SMTP_USER
//   NOTIFY_ADMIN_EMAILS  Empfänger für Anträge, mehrere mit Komma getrennt
//   APP_URL              Link in den Mails; Standard ist die Vercel-Adresse
//
// Ist SMTP nicht konfiguriert, antwortet der Endpoint mit skipped und die
// App arbeitet normal weiter – eine fehlende Mail blockiert nie einen Antrag.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { holidayName, loadSpecialDays } from "@/lib/holidays";
import { WorkModel, isWorkday, parseDateKey, workdayLabel } from "@/lib/workmodel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotifyEvent =
  | "vacation_requested"
  | "vacation_decided"
  | "correction_requested"
  | "correction_decided"
  | "offday_work";

const EVENTS: NotifyEvent[] = [
  "vacation_requested",
  "vacation_decided",
  "correction_requested",
  "correction_decided",
  "offday_work",
];

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  active?: boolean | null;
  work_model_id?: string | null;
};

type TimeEntry = {
  id: string;
  user_id: string;
  clock_in: string | null;
  kind: string | null;
};

const DAY_NAMES = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

/** Kalendertag in Oesterreich ("YYYY-MM-DD"), unabhaengig von der Server-Zeitzone. */
function viennaDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const isWorkEntry = (e: TimeEntry) => (e.kind || "work") === "work";

type Vacation = {
  id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type: string | null;
};

type Correction = {
  id: number;
  user_id: string;
  kind: string;
  entry_kind: string | null;
  target_date: string;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  reason: string | null;
  status: string;
};

type Mail = { to: string[]; subject: string; lines: string[]; link: string };

const KIND_LABEL: Record<string, string> = {
  create: "Nachtragen",
  edit: "Zeit ändern",
  delete: "Löschen",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "genehmigt",
  rejected: "abgelehnt",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function appUrl() {
  return (process.env.APP_URL || "https://stempel-urlaubsverwaltung.vercel.app").replace(
    /\/+$/,
    ""
  );
}

function adminRecipients() {
  return (process.env.NOTIFY_ADMIN_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

function dateLabel(key: string | null) {
  if (!key) return "–";
  const [y, m, d] = key.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function timeLabel(iso: string | null) {
  if (!iso) return "offen";
  return new Date(iso).toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Vienna",
  });
}

function personName(p: Profile | undefined | null) {
  return p?.full_name || p?.email || "Unbekannt";
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function periodLabel(v: Vacation) {
  return v.start_date === v.end_date
    ? dateLabel(v.start_date)
    : `${dateLabel(v.start_date)} – ${dateLabel(v.end_date)}`;
}

function correctionLine(c: Correction) {
  const what = c.entry_kind === "pause" ? "Pause" : "Arbeitszeit";
  const kind = KIND_LABEL[c.kind] || c.kind;
  const times = `${timeLabel(c.requested_clock_in)} – ${timeLabel(c.requested_clock_out)}`;
  const reason = c.reason ? ` · Grund: ${c.reason}` : "";
  return `${dateLabel(c.target_date)}: ${kind} (${what}) ${times}${reason}`;
}

function transport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

async function sendMail(mailer: NonNullable<ReturnType<typeof transport>>, mail: Mail) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "";
  const text = [
    ...mail.lines,
    "",
    `Zur Zeiterfassung: ${mail.link}`,
    "",
    "Diese Nachricht wurde automatisch von der Zeiterfassung verschickt.",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
${mail.lines.map((l) => (l ? `<p style="margin:0 0 8px">${escapeHtml(l)}</p>` : "<br>")).join("\n")}
<p style="margin:16px 0"><a href="${escapeHtml(mail.link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600">Zur Zeiterfassung</a></p>
<p style="margin:0;color:#94a3b8;font-size:12px">Diese Nachricht wurde automatisch von der Zeiterfassung verschickt.</p>
</div>`;
  await mailer.sendMail({ from, to: mail.to, subject: mail.subject, text, html });
}

async function loadProfiles(db: SupabaseClient, ids: string[]) {
  const { data } = await db.from("profiles").select("*").in("id", ids);
  const map = new Map<string, Profile>();
  ((data || []) as Profile[]).forEach((p) => map.set(p.id, p));
  return map;
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return json({ ok: false, error: "Supabase nicht konfiguriert" }, 500);

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Nicht angemeldet" }, 401);

  let body: { event?: string; ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Ungültige Anfrage" }, 400);
  }
  const event = body.event as NotifyEvent;
  if (!EVENTS.includes(event)) return json({ ok: false, error: "Unbekanntes Ereignis" }, 400);
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === "number" || typeof x === "string").slice(0, 50)
    : [];
  if (!ids.length) return json({ ok: false, error: "Keine IDs" }, 400);

  const mailer = transport();
  if (!mailer) return json({ ok: false, skipped: "SMTP nicht konfiguriert" });

  // Alle Abfragen laufen mit dem Token des Benutzers (RLS greift).
  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return json({ ok: false, error: "Nicht angemeldet" }, 401);

  const { data: meData } = await db.from("profiles").select("*").eq("id", user.id).single();
  const me = meData as Profile | null;
  const isAdmin = me?.role === "admin";
  const link = appUrl();
  const mails: Mail[] = [];

  if (event === "offday_work") {
    const to = adminRecipients();
    if (!to.length) return json({ ok: false, skipped: "NOTIFY_ADMIN_EMAILS fehlt" });

    const { data } = await db
      .from("time_entries")
      .select("*")
      .in("id", ids)
      .eq("user_id", user.id);
    const entries = ((data || []) as TimeEntry[]).filter(
      (e) => isWorkEntry(e) && e.clock_in
    );
    if (!entries.length) return json({ ok: false, error: "Keine Buchung gefunden" }, 404);

    await loadSpecialDays(db);
    let model: WorkModel | null = null;
    if (me?.work_model_id) {
      const { data: m } = await db
        .from("work_models")
        .select("*")
        .eq("id", me.work_model_id)
        .single();
      model = (m as WorkModel | null) || null;
    }

    for (const e of entries) {
      const clockIn = e.clock_in as string;
      const key = viennaDateKey(clockIn);
      const date = parseDateKey(key);
      if (!date) continue;
      const weekday = date.getDay();
      const holiday = holidayName(key);
      const offModel = !isWorkday(model, weekday);
      if (!holiday && !offModel) continue;

      // Nur die erste Arbeitsbuchung des Tages meldet (kein Mail-Stapel bei
      // mehrmaligem Kommen/Gehen am selben freien Tag).
      const since = new Date(new Date(clockIn).getTime() - 36 * 3600000).toISOString();
      const { data: before } = await db
        .from("time_entries")
        .select("*")
        .eq("user_id", user.id)
        .gte("clock_in", since)
        .lt("clock_in", clockIn);
      const earlier = ((before || []) as TimeEntry[]).some(
        (b) => b.id !== e.id && isWorkEntry(b) && b.clock_in && viennaDateKey(b.clock_in) === key
      );
      if (earlier) continue;

      const reason = holiday
        ? `Feiertag (${holiday})`
        : `kein Arbeitstag laut Zeitmodell ${model ? `"${model.name}"` : "(Standard Mo–Fr)"}, fixe Arbeitstage: ${workdayLabel(model)}`;
      mails.push({
        to,
        subject: `Regelverstoß: ${personName(me)} arbeitet am ${DAY_NAMES[weekday]}, ${dateLabel(key)}`,
        lines: [
          `${personName(me)} hat sich am ${DAY_NAMES[weekday]}, ${dateLabel(key)} um ${timeLabel(clockIn)} Uhr eingestempelt.`,
          `Grund des Hinweises: ${reason}.`,
          "Die Arbeitszeit wird trotzdem voll erfasst und dem Stundenkonto gutgeschrieben.",
          "Falls der Einsatz nicht vereinbart war, bitte mit dem Mitarbeiter klären.",
        ],
        link: `${link}/mitarbeiter`,
      });
    }
    if (!mails.length) return json({ ok: true, sent: 0 });
  } else if (event === "vacation_requested" || event === "correction_requested") {
    const to = adminRecipients();
    if (!to.length) return json({ ok: false, skipped: "NOTIFY_ADMIN_EMAILS fehlt" });

    if (event === "vacation_requested") {
      const { data } = await db
        .from("vacation_requests")
        .select("*")
        .in("id", ids)
        .eq("user_id", user.id)
        .eq("status", "pending");
      const rows = (data || []) as Vacation[];
      if (!rows.length) return json({ ok: false, error: "Kein offener Antrag gefunden" }, 404);
      mails.push({
        to,
        subject: `Neuer Abwesenheitsantrag: ${personName(me)}`,
        lines: [
          `${personName(me)} hat einen Abwesenheitsantrag gestellt:`,
          ...rows.map((v) => `${v.type || "Urlaub"}: ${periodLabel(v)}`),
          "",
          "Bitte in der Verwaltung genehmigen oder ablehnen.",
        ],
        link: `${link}/admin`,
      });
    } else {
      const { data } = await db
        .from("time_corrections")
        .select("*")
        .in("id", ids)
        .eq("user_id", user.id)
        .eq("status", "pending");
      const rows = (data || []) as Correction[];
      if (!rows.length) return json({ ok: false, error: "Kein offener Antrag gefunden" }, 404);
      mails.push({
        to,
        subject: `Neuer Korrekturantrag: ${personName(me)}`,
        lines: [
          `${personName(me)} hat eine Zeitkorrektur beantragt:`,
          ...rows.map(correctionLine),
          "",
          "Bitte in der Verwaltung genehmigen oder ablehnen.",
        ],
        link: `${link}/admin`,
      });
    }
  } else {
    // Entscheidungen verschickt nur ein Admin.
    if (!isAdmin) return json({ ok: false, error: "Nur für Admins" }, 403);

    if (event === "vacation_decided") {
      const { data } = await db
        .from("vacation_requests")
        .select("*")
        .in("id", ids)
        .in("status", ["approved", "rejected"]);
      const rows = (data || []) as Vacation[];
      const people = await loadProfiles(db, [...new Set(rows.map((r) => r.user_id))]);
      rows.forEach((v) => {
        const p = people.get(v.user_id);
        if (!p?.email) return;
        const status = STATUS_LABEL[v.status] || v.status;
        mails.push({
          to: [p.email],
          subject: `Dein Antrag wurde ${status}: ${v.type || "Urlaub"} ${periodLabel(v)}`,
          lines: [
            `Hallo ${personName(p)},`,
            `dein Antrag (${v.type || "Urlaub"}, ${periodLabel(v)}) wurde ${status}.`,
          ],
          link: `${link}/urlaub`,
        });
      });
    } else {
      const { data } = await db
        .from("time_corrections")
        .select("*")
        .in("id", ids)
        .in("status", ["approved", "rejected"]);
      const rows = (data || []) as Correction[];
      const people = await loadProfiles(db, [...new Set(rows.map((r) => r.user_id))]);
      // Eine Mail pro Mitarbeiter und Status.
      const groups = new Map<string, Correction[]>();
      rows.forEach((c) => {
        const k = `${c.user_id}|${c.status}`;
        groups.set(k, [...(groups.get(k) || []), c]);
      });
      groups.forEach((list) => {
        const p = people.get(list[0].user_id);
        if (!p?.email) return;
        const status = STATUS_LABEL[list[0].status] || list[0].status;
        mails.push({
          to: [p.email],
          subject: `Deine Zeitkorrektur wurde ${status}`,
          lines: [
            `Hallo ${personName(p)},`,
            `deine Zeitkorrektur wurde ${status}:`,
            ...list.map(correctionLine),
          ],
          link: `${link}/korrektur`,
        });
      });
    }
    if (!mails.length) return json({ ok: false, error: "Kein Empfänger gefunden" }, 404);
  }

  try {
    for (const m of mails) await sendMail(mailer, m);
  } catch (err) {
    console.error("Mailversand fehlgeschlagen:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Mailversand fehlgeschlagen" },
      502
    );
  }
  return json({ ok: true, sent: mails.length });
}
