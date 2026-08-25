"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { holidayName } from "@/lib/holidays";
import {
  WorkModel,
  isWorkday,
  targetMinutesForWeekday,
} from "@/lib/workmodel";
import { downloadCsv } from "@/lib/csv";
import { dayFigures } from "@/lib/time";

type TimeEntry = {
  id: string;
  user_id: string;
  clock_in: string | null;
  clock_out: string | null;
  created_at: string;
  kind?: string | null;
};

type VacationRequest = {
  id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};


type JournalRow = {
  day: number;
  dateLabel: string;
  dayName: string;
  isWeekend: boolean;
  isFuture: boolean;
  komm: string;
  geht: string;
  pauseMin: number;
  autoPauseMin: number;
  targetMin: number;
  workedMin: number;
  running: boolean;
  absence: string | null;
  holiday: string | null;
};

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTH_NAMES = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function formatMinutes(min: number) {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
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

export default function JournalPage() {
  const router = useRouter();
  const now = new Date();

  const [workModel, setWorkModel] = useState<WorkModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());


  async function loadJournal() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setLoading(true);

    const { data: profile } = await supabase
      .from("profiles")
      .select("work_model_id")
      .eq("id", user.id)
      .single();

    let model: WorkModel | null = null;
    if (profile?.work_model_id) {
      const { data: wm } = await supabase
        .from("work_models")
        .select("*")
        .eq("id", profile.work_model_id)
        .single();
      model = (wm as WorkModel) || null;
    }
    setWorkModel(model);

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);

    const { data: entryData, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("clock_in", start.toISOString())
      .lt("clock_in", end.toISOString())
      .order("clock_in", { ascending: true });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    const { data: vacData } = await supabase
      .from("vacation_requests")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "approved");

    const entries = (entryData || []) as TimeEntry[];
    const vacations = (vacData || []) as VacationRequest[];

    const byDay: Record<string, TimeEntry[]> = {};
    entries.forEach((e) => {
      if (!e.clock_in) return;
      const key = localDateKey(e.clock_in);
      (byDay[key] = byDay[key] || []).push(e);
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = localDateKey(now.toISOString());
    const built: JournalRow[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const weekday = date.getDay();
      const isWeekend = !isWorkday(model, weekday);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(
        d
      ).padStart(2, "0")}`;
      const isFuture = iso > todayKey;

      const dayEntries = (byDay[iso] || []).sort(
        (a, b) =>
          new Date(a.clock_in as string).getTime() -
          new Date(b.clock_in as string).getTime()
      );

      const holiday = !isWeekend ? holidayName(iso) : null;
      let absence: string | null = null;
      if (!holiday) {
        vacations.forEach((v) => {
          if (iso >= v.start_date && iso <= v.end_date && !isWeekend) {
            absence = v.type || "Urlaub";
          }
        });
      }

      const fig = dayFigures(dayEntries, Date.now());
      const targetMin = holiday ? 0 : targetMinutesForWeekday(model, weekday);
      const workedMin = Math.round(fig.workedMs / 60000);

      built.push({
        day: d,
        dateLabel: `${String(d).padStart(2, "0")}.${String(month + 1).padStart(
          2,
          "0"
        )}.`,
        dayName: DAY_NAMES[weekday],
        isWeekend,
        isFuture,
        komm: fig.komm ? timeLabel(fig.komm) : "",
        geht: fig.geht ? timeLabel(fig.geht) : "",
        pauseMin: Math.round(fig.pauseMs / 60000),
        autoPauseMin: Math.round(fig.autoPauseMs / 60000),
        targetMin,
        workedMin: absence ? targetMin : workedMin,
        running: fig.running,
        absence,
        holiday,
      });
    }

    setRows(built);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJournal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const sumTarget = rows.reduce((a, r) => a + (r.isFuture ? 0 : r.targetMin), 0);
  const sumWorked = rows.reduce((a, r) => a + (r.isFuture ? 0 : r.workedMin), 0);
  const sumPause = rows.reduce((a, r) => a + r.pauseMin, 0);
  const sumDiff = sumWorked - sumTarget;

  function exportCsv() {
    const header = [
      "Datum",
      "Wochentag",
      "Kommt",
      "Geht",
      "Pause",
      "Soll",
      "Ist",
      "Differenz",
      "Hinweis",
    ];
    const dataRows = rows.map((r) => {
      const diff = r.workedMin - r.targetMin;
      const showDiff = !r.isWeekend && !r.isFuture && !r.absence && !r.holiday;
      const hinweis = r.holiday
        ? `Feiertag (${r.holiday})`
        : r.absence
        ? r.absence
        : r.isWeekend
        ? "Wochenende"
        : r.isFuture
        ? "offen"
        : "";
      return [
        r.dateLabel,
        r.dayName,
        r.komm || "",
        r.running ? "läuft" : r.geht || "",
        r.pauseMin ? formatMinutes(r.pauseMin) : "",
        r.targetMin ? formatMinutes(r.targetMin) : "",
        r.isFuture ? "" : formatMinutes(r.workedMin),
        showDiff ? `${diff >= 0 ? "+" : ""}${formatMinutes(diff)}` : "",
        hinweis,
      ];
    });
    const sumRow = [
      "Summe",
      "",
      "",
      "",
      formatMinutes(sumPause),
      formatMinutes(sumTarget),
      formatMinutes(sumWorked),
      `${sumDiff >= 0 ? "+" : ""}${formatMinutes(sumDiff)}`,
      "",
    ];
    downloadCsv(
      `journal_${year}_${String(month + 1).padStart(2, "0")}.csv`,
      [header, ...dataRows, sumRow]
    );
  }

  return (
    <Shell title="Monatsjournal" subtitle="Alle erfassten Zeiten des Monats">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm font-semibold text-slate-700">Monat</span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={i} value={i}>
              {name}
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
        <button
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <Icon name="download" className="h-4 w-4 text-slate-500" />
          CSV exportieren
        </button>
      </div>

      {!workModel && !loading && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
          <Icon name="info" className="mt-0.5 h-4 w-4 text-blue-500" />
          Kein Zeitmodell zugewiesen – die Sollzeiten werden als 0:00 angezeigt.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Journal wird geladen…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-slate-900">
              {MONTH_NAMES[month]} {year}
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
                    <td className="px-4 py-2.5">
                      {r.running ? (
                        <span className="text-emerald-600">läuft…</span>
                      ) : (
                        r.geht || "–"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.pauseMin ? formatMinutes(r.pauseMin) : "–"}
                      {r.autoPauseMin > 0 && (
                        <span
                          className="ml-1 text-amber-600"
                          title={`Davon ${r.autoPauseMin} min gesetzliche Pause automatisch verrechnet`}
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.targetMin ? formatMinutes(r.targetMin) : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.holiday ? (
                        <span
                          title={r.holiday}
                          className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
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
                        formatMinutes(r.workedMin)
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
                          {formatMinutes(diff)}
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
                <td className="px-4 py-3" colSpan={3}>
                  Summe
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatMinutes(sumPause)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatMinutes(sumTarget)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatMinutes(sumWorked)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span
                    className={sumDiff >= 0 ? "text-emerald-600" : "text-red-600"}
                  >
                    {sumDiff >= 0 ? "+" : ""}
                    {formatMinutes(sumDiff)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Wochenenden sind ausgegraut, Feiertage blau markiert (Soll 0),
        genehmigte Abwesenheiten erfüllen das Soll, zukünftige Tage sind noch
        offen. Ein <span className="text-amber-600">*</span> bei der Pause
        bedeutet, dass die gesetzliche Ruhepause von 30 Minuten (ab mehr als
        6 Stunden Arbeitszeit, § 11 AZG) automatisch verrechnet wurde.
      </p>
    </Shell>
  );
}
