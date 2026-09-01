"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { holidayName } from "@/lib/holidays";
import { dayFigures } from "@/lib/time";
import {
  WorkModel,
  formatDays,
  formatHm,
  hoursPerWorkday,
  isWorkday,
  minutesToDays,
  targetMinutesForWeekday,
  vacationAccount,
  weeklyHours,
  workdayLabel,
} from "@/lib/workmodel";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  vacation_days: number;
  work_model_id: string | null;
  active?: boolean | null;
  entry_date?: string | null;
  vacation_opening_balance?: number | null;
  vacation_opening_date?: string | null;
};
type TimeEntry = {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  kind?: string | null;
};
type Vacation = {
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};
type Row = {
  day: number;
  dateLabel: string;
  dayName: string;
  isWeekend: boolean;
  isFuture: boolean;
  komm: string;
  geht: string;
  pauseMin: number;
  targetMin: number;
  workedMin: number;
  absence: string | null;
  holiday: string | null;
};

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTH_NAMES = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const YEAR_NOW = new Date().getFullYear();

function fmt(min: number) {
  const s = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}
function localDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function timeLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MitarbeiterPage() {
  const router = useRouter();
  const now = new Date();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [selProfile, setSelProfile] = useState<Profile | null>(null);
  const [workModel, setWorkModel] = useState<WorkModel | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  // Urlaubskonto in Minuten (Stundenbasis, siehe lib/workmodel.ts)
  const [vac, setVac] = useState({
    budget: 0,
    opening: 0,
    hasOpening: false,
    from: "",
    taken: 0,
    pending: 0,
    rest: 0,
  });
  const [loading, setLoading] = useState(true);

  async function init() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!me || me.role !== "admin") {
      router.push("/dashboard");
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name");
    const list = (data || []) as Profile[];
    setProfiles(list);
    if (list.length) setSelectedId(list[0].id);
  }

  async function loadDetail() {
    if (!selectedId) return;
    setLoading(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", selectedId)
      .single();
    const prof = (profile as Profile) || null;
    setSelProfile(prof);

    let model: WorkModel | null = null;
    if (prof?.work_model_id) {
      const { data: wm } = await supabase
        .from("work_models")
        .select("*")
        .eq("id", prof.work_model_id)
        .single();
      model = (wm as WorkModel) || null;
    }
    setWorkModel(model);

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    const { data: entryData } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", selectedId)
      .gte("clock_in", start.toISOString())
      .lt("clock_in", end.toISOString())
      .order("clock_in", { ascending: true });
    const { data: vacData } = await supabase
      .from("vacation_requests")
      .select("*")
      .eq("user_id", selectedId);

    const entries = (entryData || []) as TimeEntry[];
    const vacations = (vacData || []) as Vacation[];

    // Journal aufbauen
    const byDay: Record<string, TimeEntry[]> = {};
    entries.forEach((e) => {
      if (!e.clock_in) return;
      const k = localDateKey(e.clock_in);
      (byDay[k] = byDay[k] || []).push(e);
    });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = localDateKey(now.toISOString());
    const built: Row[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const wd = date.getDay();
      // Kein fixer Arbeitstag laut Zeitmodell (frueher pauschal Sa/So).
      const isWeekend = !isWorkday(model, wd);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = iso > todayKey;
      const holiday = !isWeekend ? holidayName(iso) : null;
      let absence: string | null = null;
      if (!holiday) {
        vacations.forEach((v) => {
          if (
            v.status === "approved" &&
            iso >= v.start_date &&
            iso <= v.end_date &&
            !isWeekend
          )
            absence = v.type || "Urlaub";
        });
      }
      const fig = dayFigures(byDay[iso] || [], Date.now());
      const targetMin = holiday ? 0 : targetMinutesForWeekday(model, wd);
      const workedMin = Math.round(fig.workedMs / 60000);
      built.push({
        day: d,
        dateLabel: `${String(d).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.`,
        dayName: DAY_NAMES[wd],
        isWeekend,
        isFuture,
        komm: fig.komm ? timeLabel(fig.komm) : "",
        geht: fig.geht ? timeLabel(fig.geht) : "",
        pauseMin: Math.round(fig.pauseMs / 60000),
        targetMin,
        workedMin: absence ? targetMin : workedMin,
        absence,
        holiday,
      });
    }
    setRows(built);

    // Urlaubskonto in Stunden: Startsaldo + Ansprueche seither - Verbrauch
    const account = vacationAccount({
      model,
      fullDays: Number(prof?.vacation_days || 0),
      entryDate: prof?.entry_date || null,
      openingMinutes: Number(prof?.vacation_opening_balance || 0),
      openingDate: (prof?.vacation_opening_date as string | null) || null,
      requests: vacations,
    });
    setVac({
      budget: account.openingMinutes + account.accruedMinutes,
      opening: account.openingMinutes,
      hasOpening: account.hasOpening,
      from: account.fromKey,
      taken: account.usedMinutes,
      pending: account.pendingMinutes,
      rest: account.restMinutes,
    });

    setLoading(false);
  }

  // Minuten als Tagesangabe, sofern ein Zeitmodell zugeordnet ist.
  const vacDays = (min: number) =>
    hoursPerWorkday(workModel) > 0
      ? `${formatDays(minutesToDays(workModel, min))} Tage`
      : "Tage unbekannt";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, year, month]);

  const sumTarget = rows.reduce((a, r) => a + (r.isFuture ? 0 : r.targetMin), 0);
  const sumWorked = rows.reduce((a, r) => a + (r.isFuture ? 0 : r.workedMin), 0);
  const sumDiff = sumWorked - sumTarget;

  return (
    <Shell title="Mitarbeiter" subtitle="Alle Daten eines Mitarbeiters auf einen Blick">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm font-semibold text-slate-700">Mitarbeiter</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-[220px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm font-semibold text-slate-700">Monat</span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {MONTH_NAMES.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Wird geladen…</p>
      ) : !selProfile ? (
        <p className="text-sm text-slate-500">Kein Mitarbeiter ausgewählt.</p>
      ) : (
        <>
          {/* Stammdaten */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  {selProfile.full_name || "–"}
                </p>
                <p className="text-sm text-slate-500">{selProfile.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selProfile.role === "admin" ? (
                  <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                    Chef / Admin
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Mitarbeiter
                  </span>
                )}
                {selProfile.active !== false ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Aktiv
                  </span>
                ) : (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Wartet
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500">Zeitmodell</p>
                <p className="font-semibold text-slate-800">
                  {workModel ? workModel.name : "–"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Fixe Arbeitstage</p>
                <p className="font-semibold text-slate-800">
                  {workdayLabel(workModel)}
                  {workModel ? (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {formatDays(weeklyHours(workModel))} h/Woche
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Eintritt</p>
                <p className="font-semibold text-slate-800">
                  {selProfile.entry_date
                    ? new Date(selProfile.entry_date).toLocaleDateString("de-DE")
                    : "–"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">
                  {vac.hasOpening ? "Urlaubsguthaben" : "Urlaubsanspruch"}
                </p>
                <p className="font-semibold text-slate-800">
                  {formatHm(vac.budget)} h
                  {vac.hasOpening ? (
                    <span className="ml-1 text-xs font-normal text-amber-600">
                      inkl. Startsaldo {formatHm(vac.opening)}
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">
                  Resturlaub{vac.hasOpening ? "" : ` ${YEAR_NOW}`}
                </p>
                <p
                  className={`font-semibold ${
                    vac.rest >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {formatHm(vac.rest)} h
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {vacDays(vac.rest)}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Urlaubskonto */}
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            {[
              {
                l: vac.hasOpening ? "Guthaben gesamt" : "Anspruch",
                v: formatHm(vac.budget),
                h: vac.hasOpening
                  ? `ab ${new Date(vac.from).toLocaleDateString("de-DE")}`
                  : vacDays(vac.budget),
              },
              { l: "Genommen", v: formatHm(vac.taken), h: vacDays(vac.taken) },
              { l: "Beantragt", v: formatHm(vac.pending), h: vacDays(vac.pending) },
              { l: "Rest", v: formatHm(vac.rest), h: vacDays(vac.rest) },
            ].map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-[12.5px] text-slate-500">{s.l}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {s.v}
                </p>
                <p className="text-xs text-slate-400">{s.h}</p>
              </div>
            ))}
          </div>

          {/* Monatsjournal */}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-slate-900">
                Monatsjournal {MONTH_NAMES[month]} {year}
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Datum</th>
                  <th className="px-4 py-2.5">Kommt</th>
                  <th className="px-4 py-2.5">Geht</th>
                  <th className="px-4 py-2.5 text-right">Pause</th>
                  <th className="px-4 py-2.5 text-right">Soll</th>
                  <th className="px-4 py-2.5 text-right">Ist</th>
                  <th className="px-4 py-2.5 text-right">±</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = r.workedMin - r.targetMin;
                  const showDiff =
                    !r.isWeekend && !r.isFuture && !r.absence && !r.holiday;
                  return (
                    <tr
                      key={r.day}
                      className={`border-t border-slate-100 ${
                        r.holiday
                          ? "bg-blue-50/40"
                          : r.isWeekend
                          ? "bg-slate-50/60 text-slate-400"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-slate-700">
                          {r.dateLabel}
                        </span>{" "}
                        <span className="text-slate-400">{r.dayName}</span>
                      </td>
                      <td className="px-4 py-2.5">{r.komm || "–"}</td>
                      <td className="px-4 py-2.5">{r.geht || "–"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {r.pauseMin ? fmt(r.pauseMin) : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {r.targetMin ? fmt(r.targetMin) : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {r.holiday ? (
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Feiertag
                          </span>
                        ) : r.absence ? (
                          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {r.absence}
                          </span>
                        ) : r.isFuture ? (
                          "–"
                        ) : r.isWeekend && !r.workedMin ? (
                          ""
                        ) : (
                          fmt(r.workedMin)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {showDiff ? (
                          <span
                            className={
                              diff >= 0 ? "text-emerald-600" : "text-red-600"
                            }
                          >
                            {diff >= 0 ? "+" : ""}
                            {fmt(diff)}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-800">
                  <td className="px-4 py-3" colSpan={4}>
                    Summe
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmt(sumTarget)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmt(sumWorked)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span
                      className={sumDiff >= 0 ? "text-emerald-600" : "text-red-600"}
                    >
                      {sumDiff >= 0 ? "+" : ""}
                      {fmt(sumDiff)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
