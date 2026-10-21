"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { dayTargetFactor, loadSpecialDays } from "@/lib/holidays";
import {
  WorkModel,
  dayKey,
  formatDays,
  formatHm,
  hoursForWeekday,
  minutesToDays,
  isWorkday,
  parseDateKey,
  workdayLabel,
} from "@/lib/workmodel";
import { dayFigures, isPause } from "@/lib/time";
import { notify } from "@/lib/notify";
import { loadAccounts } from "@/lib/accounts";
import Link from "next/link";


type TimeEntry = {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  created_at: string;
  kind?: string | null;
};

// Offene Arbeitsbuchungen (clock_out = null) eines Benutzers – unabhängig vom
// Datum. Genau daraus ergibt sich, ob jemand "eingestempelt" ist; eine
// Buchung, die gestern vergessen wurde, darf heute kein zweites Kommen erlauben.
async function loadOpenWorkEntries(userId: string) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("user_id", userId)
    .is("clock_out", null)
    .order("clock_in", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data || []) as TimeEntry[]).filter((e) => e.clock_in && !isPause(e));
}

export default function DashboardPage() {
  const router = useRouter();

  const [workModel, setWorkModel] = useState<WorkModel | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [staleOpen, setStaleOpen] = useState<TimeEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [dayEnded, setDayEnded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dayKey(new Date()));
  // Eigener ZA-Stand und Resturlaub (gleiche Rechnung wie Stundenkonto/Urlaub).
  const [summary, setSummary] = useState<{
    za: number;
    vacRest: number;
    vacDays: string;
  } | null>(null);

  async function loadSummary() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const accs = await loadAccounts(supabase, [user.id]);
      const a = accs[user.id];
      if (!a) return;
      setSummary({
        za: a.za.balanceMinutes,
        vacRest: a.vacation.restMinutes,
        vacDays: a.model
          ? `${formatDays(minutesToDays(a.model, a.vacation.restMinutes))} Tage`
          : "",
      });
    } catch (err) {
      console.warn("Kontostände nicht geladen:", err);
    }
  }

  async function loadEntries(dateValue = selectedDate) {
    await loadSpecialDays(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("work_model_id")
      .eq("id", user.id)
      .single();

    if (profile?.work_model_id) {
      const { data: model } = await supabase
        .from("work_models")
        .select("*")
        .eq("id", profile.work_model_id)
        .single();
      setWorkModel((model as WorkModel) || null);
    } else {
      setWorkModel(null);
    }

    // Tagesgrenzen lokal bilden (nicht über new Date("YYYY-MM-DD"), das ist UTC).
    const startDate = parseDateKey(dateValue) || new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    // Nach clock_in filtern, nicht nach created_at: nachgetragene Buchungen
    // werden an einem anderen Tag angelegt, gehören aber zum Zieltag.
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("clock_in", startDate.toISOString())
      .lt("clock_in", endDate.toISOString())
      .order("clock_in", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    const loaded = (data || []) as TimeEntry[];
    setEntries(loaded);

    // Offene Buchungen immer datumsunabhängig laden: nur so ist der Status
    // "Eingestempelt" verlässlich, egal welcher Tag gerade angezeigt wird.
    let open: TimeEntry[] = [];
    try {
      open = await loadOpenWorkEntries(user.id);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    const todayKey = dayKey(new Date());
    const openToday = open.filter(
      (e) => dayKey(new Date(e.clock_in as string)) === todayKey
    );
    setActiveEntry(openToday[openToday.length - 1] || null);
    setStaleOpen(
      open.filter((e) => dayKey(new Date(e.clock_in as string)) !== todayKey)
    );
    if (dateValue !== todayKey) setDayEnded(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function dateLabel(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  async function handleClockIn() {
    // Schutz gegen Doppelklick / zwei parallele Anfragen.
    if (busy || activeEntry) return;
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const today = dayKey(new Date());

      // Serverstand prüfen, nicht den (möglicherweise veralteten) Bildschirm:
      // ein zweiter Tab oder ein anderes Gerät kann längst eingestempelt haben.
      const open = await loadOpenWorkEntries(user.id);
      const openToday = open.filter(
        (e) => dayKey(new Date(e.clock_in as string)) === today
      );
      if (openToday.length > 0) {
        alert(
          "Du bist bereits eingestempelt – die Anzeige wurde aktualisiert."
        );
        await loadEntries(today);
        return;
      }

      // Offene Buchung von einem früheren Tag (Feierabend vergessen): mit
      // Dauer 0 schließen, damit keine Phantomstunden entstehen. Die echte
      // Geht-Zeit muss über die Zeitkorrektur nachgetragen werden.
      const stale = open.filter(
        (e) => dayKey(new Date(e.clock_in as string)) !== today
      );
      for (const s of stale) {
        const { error } = await supabase
          .from("time_entries")
          .update({ clock_out: s.clock_in })
          .eq("id", s.id)
          .is("clock_out", null);
        if (error) {
          alert(
            `Die offene Buchung vom ${dateLabel(
              s.clock_in
            )} konnte nicht geschlossen werden: ${error.message}`
          );
          return;
        }
      }
      if (stale.length > 0) {
        alert(
          `Für den ${stale
            .map((s) => dateLabel(s.clock_in))
            .join(", ")} war noch eine Buchung offen (Feierabend vergessen). ` +
            "Sie wurde mit 0:00 Std geschlossen – bitte die richtige Geht-Zeit " +
            "über die Zeitkorrektur nachtragen."
        );
      }

      const { data: inserted, error } = await supabase
        .from("time_entries")
        .insert([{ user_id: user.id, clock_in: new Date().toISOString() }])
        .select("id");
      if (error) {
        // 23505 = unique_violation: die Datenbank lässt je Benutzer nur eine
        // offene Arbeitsbuchung zu (Index time_entries_one_open_per_user).
        if (error.code === "23505" || /bereits eingestempelt/i.test(error.message)) {
          alert("Du bist bereits eingestempelt – die Anzeige wurde aktualisiert.");
        } else {
          alert(error.message);
        }
        await loadEntries(today);
        return;
      }
      // Stempeln an einem freien Tag ist erlaubt und wird voll gerechnet;
      // der Server prueft den Tag und schickt dem Admin ggf. einen Hinweis.
      void notify(
        "offday_work",
        (inserted || []).map((r: { id: string }) => r.id)
      );
      setDayEnded(false);
      setSelectedDate(today);
      await loadEntries(today);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeActive(markEnded: boolean) {
    if (busy || !activeEntry) return;
    setBusy(true);
    try {
      // Nur schließen, wenn die Buchung serverseitig noch offen ist – sonst
      // hat ein anderer Tab bereits gestempelt und wir überschreiben nichts.
      const { data, error } = await supabase
        .from("time_entries")
        .update({ clock_out: new Date().toISOString() })
        .eq("id", activeEntry.id)
        .is("clock_out", null)
        .select("id");
      if (error) {
        alert(error.message);
        return;
      }
      if (!data || data.length === 0) {
        alert(
          "Diese Buchung wurde bereits beendet – die Anzeige wurde aktualisiert."
        );
        await loadEntries();
        return;
      }
      setDayEnded(markEnded);
      await loadEntries();
      if (markEnded) void loadSummary();
    } finally {
      setBusy(false);
    }
  }

  function durationMs(clockIn: string | null, clockOut: string | null) {
    if (!clockIn) return 0;
    const end = clockOut ? new Date(clockOut).getTime() : nowMs;
    return Math.max(0, end - new Date(clockIn).getTime());
  }

  function formatHMS(ms: number) {
    const abs = Math.max(0, ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs / 60000) % 60);
    const s = Math.floor((abs / 1000) % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s
    ).padStart(2, "0")}`;
  }

  function formatMs(ms: number) {
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs / 60000) % 60);
    return `${ms < 0 ? "-" : ""}${h}:${String(m).padStart(2, "0")}`;
  }

  function totalMs() {
    return dayFigures(entries, nowMs).workedMs;
  }

  // Tagessoll laut Zeitmodell. Kein fixer Arbeitstag oder Feiertag -> 0.
  function targetHoursForDate(dateValue: string) {
    if (!workModel) return 0;
    const d = parseDateKey(dateValue);
    if (!d) return 0;
    // Feiertag -> 0, verkuerzter Sondertag (z. B. 24.12.) -> anteilig.
    const hours = hoursForWeekday(workModel, d.getDay()) * dayTargetFactor(dateValue);
    return Math.round(hours * 100) / 100;
  }

  // Ist der gewaehlte Tag ein fixer Arbeitstag des Modells?
  function isWorkdayForDate(dateValue: string) {
    return isWorkday(workModel, new Date(dateValue).getDay());
  }

  const figures = dayFigures(entries, nowMs);
  const autoPauseMin = Math.round(figures.autoPauseMs / 60000);

  const today = dayKey(new Date());
  const isToday = selectedDate === today;
  const hasWorkedToday = entries.length > 0;
  const isOnBreak = hasWorkedToday && !activeEntry && !dayEnded && isToday;
  const targetHours = targetHoursForDate(selectedDate);
  const targetMs = targetHours * 3600000;
  const diffMs = totalMs() - targetMs;
  const liveElapsed =
    activeEntry && activeEntry.clock_in && nowMs
      ? formatHMS(nowMs - new Date(activeEntry.clock_in).getTime())
      : null;
  const pct =
    targetMs > 0 ? Math.min(100, Math.round((totalMs() / targetMs) * 100)) : 0;

  const statusPill = activeEntry ? (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Eingestempelt
    </span>
  ) : isOnBreak ? (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> In Pause
    </span>
  ) : dayEnded ? (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Feierabend
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Ausgestempelt
    </span>
  );

  return (
    <Shell
      title="Stempeluhr"
      subtitle="Ein- und Ausstempeln, Pausen erfassen"
    >
      {!workModel && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
          <Icon name="info" className="mt-0.5 h-4 w-4 text-blue-500" />
          Diesem Konto ist kein Zeitmodell zugewiesen. Die Sollzeit wird daher
          als 0:00 angezeigt – ein Admin kann in der Verwaltung ein Zeitmodell
          zuweisen.
        </div>
      )}

      {staleOpen.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <Icon name="info" className="mt-0.5 h-4 w-4 text-amber-600" />
          <span>
            Es ist noch eine Buchung vom{" "}
            {staleOpen.map((s) => dateLabel(s.clock_in)).join(", ")} offen
            (Feierabend vergessen?). Beim nächsten Kommen wird sie mit 0:00 Std
            geschlossen – die richtige Geht-Zeit bitte über die Zeitkorrektur
            nachtragen.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Status</p>
          <div className="mt-2.5">{statusPill}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Heute gearbeitet</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {formatMs(totalMs())}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {workModel && !isWorkdayForDate(selectedDate)
              ? `Kein Arbeitstag laut Zeitmodell (${workdayLabel(workModel)})`
              : `Tagesziel ${targetHours ? `${targetHours}` : "0"} Std`}
          </p>
          {autoPauseMin > 0 && (
            <p className="mt-1.5 text-xs text-amber-600">
              Abzüglich {autoPauseMin} min gesetzliche Pause (ab 6 Std)
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Differenz zum Soll</p>
          <p
            className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
              diffMs >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {diffMs >= 0 ? "+" : ""}
            {formatMs(diffMs)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {targetMs === 0 ? "Kein Soll hinterlegt" : "Std heute"}
          </p>
        </div>
      </div>

      {summary && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Link
            href="/stundenkonto"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200"
          >
            <p className="text-[12.5px] text-slate-500">Mein Zeitausgleich</p>
            <p
              className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
                summary.za >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {summary.za > 0 ? "+" : ""}
              {formatHm(summary.za)} Std
            </p>
            <p className="mt-1 text-xs text-slate-400">Stand inkl. heute · Details im Stundenkonto</p>
          </Link>
          <Link
            href="/urlaub"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200"
          >
            <p className="text-[12.5px] text-slate-500">Mein Resturlaub</p>
            <p
              className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
                summary.vacRest >= 0 ? "text-slate-900" : "text-red-600"
              }`}
            >
              {formatHm(summary.vacRest)} Std
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {summary.vacDays ? `≈ ${summary.vacDays} · ` : ""}Details unter Urlaub
            </p>
          </Link>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
          {new Date().toLocaleDateString("de-AT", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <p className="mt-1.5 text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
          {activeEntry && liveElapsed ? liveElapsed : formatMs(totalMs())}
        </p>
        <p className="mb-6 mt-1 text-xs text-slate-400">
          {activeEntry ? "seit dem letzten Einstempeln" : "heute gesamt"}
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={activeEntry || busy ? undefined : handleClockIn}
            disabled={!!activeEntry || busy}
            className="inline-flex items-center gap-2 rounded-[11px] bg-emerald-600 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="play" className="h-4 w-4" />
            {isOnBreak ? "Pause beenden" : "Kommen"}
          </button>
          <button
            onClick={() => closeActive(false)}
            disabled={!activeEntry || busy}
            className="inline-flex items-center gap-2 rounded-[11px] bg-amber-500 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="pause" className="h-4 w-4" />
            Pause
          </button>
          <button
            onClick={() => closeActive(true)}
            disabled={!activeEntry || busy}
            className="inline-flex items-center gap-2 rounded-[11px] bg-red-600 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="stop" className="h-4 w-4" />
            Feierabend
          </button>
        </div>

        <div className="mx-auto mt-7 max-w-md">
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>Fortschritt Tagesziel</span>
            <span className="font-semibold text-slate-700">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-slate-900">
            {isToday
              ? "Heutige Buchungen"
              : `Buchungen vom ${new Date(selectedDate).toLocaleDateString(
                  "de-DE"
                )}`}
          </h2>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
          />
        </div>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Für diesen Tag gibt es keine Buchungen.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Kommt</th>
                  <th className="px-4 py-2.5">Geht</th>
                  <th className="px-4 py-2.5 text-right">Dauer</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      {isPause(e) && (
                        <span className="mr-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                          Pause
                        </span>
                      )}
                      {e.clock_in
                        ? new Date(e.clock_in).toLocaleTimeString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "–"}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.clock_out ? (
                        new Date(e.clock_out).toLocaleTimeString("de-DE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      ) : (
                        <span className="text-emerald-600">läuft…</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMs(durationMs(e.clock_in, e.clock_out))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-800">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Gesamt
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMs(totalMs())}
                  </td>
                </tr>
              </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
