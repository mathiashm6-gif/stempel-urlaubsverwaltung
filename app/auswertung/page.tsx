"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { holidayName } from "@/lib/holidays";
import { downloadCsv } from "@/lib/csv";
import { netWorkedMsByDay } from "@/lib/time";

type TimeEntry = {
  id: string;
  user_id: string;
  clock_in: string | null;
  clock_out: string | null;
  kind?: string | null;
};
type VacationRequest = {
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
};
type WorkModel = {
  id: string;
  name: string;
  monday_hours: number | null;
  tuesday_hours: number | null;
  wednesday_hours: number | null;
  thursday_hours: number | null;
  friday_hours: number | null;
  saturday_hours: number | null;
  sunday_hours: number | null;
};
type Totals = {
  sollToDate: number;
  istActual: number;
  saldo: number;
  workDays: number;
  vacationDays: number;
};

const MONTH_NAMES = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function formatMinutes(min: number) {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function AuswertungPage() {
  const router = useRouter();
  const now = new Date();

  const [workModel, setWorkModel] = useState<WorkModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [totals, setTotals] = useState<Totals>({
    sollToDate: 0,
    istActual: 0,
    saldo: 0,
    workDays: 0,
    vacationDays: 0,
  });

  function targetForWeekday(model: WorkModel | null, weekday: number) {
    if (!model) return 0;
    const map: Record<number, number | null> = {
      0: model.sunday_hours,
      1: model.monday_hours,
      2: model.tuesday_hours,
      3: model.wednesday_hours,
      4: model.thursday_hours,
      5: model.friday_hours,
      6: model.saturday_hours,
    };
    return Math.round(Number(map[weekday] || 0) * 60);
  }

  async function loadMonthData() {
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
      .lt("clock_in", end.toISOString());

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

    // Netto-Arbeitszeit je Tag inkl. automatischer Pausenverrechnung (§ 11 AZG)
    const workedByDay = netWorkedMsByDay(
      entries,
      (iso) => localDateKey(new Date(iso)),
      Date.now()
    );

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = localDateKey(now);

    let sollToDate = 0;
    let istActual = 0;
    let saldo = 0;
    let workDays = 0;
    let vacationDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const weekday = date.getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const key = localDateKey(date);
      if (key > todayKey) continue;

      const holiday = !isWeekend ? holidayName(key) : null;
      const target =
        isWeekend || holiday ? 0 : targetForWeekday(model, weekday);
      const worked = Math.max(0, Math.round((workedByDay[key] || 0) / 60000));

      let absence = false;
      if (!holiday) {
        vacations.forEach((v) => {
          if (key >= v.start_date && key <= v.end_date && !isWeekend)
            absence = true;
        });
      }

      istActual += worked;
      sollToDate += target;
      if (absence) {
        vacationDays += 1;
      } else {
        saldo += worked - target;
        if (target > 0) workDays += 1;
      }
    }

    setTotals({ sollToDate, istActual, saldo, workDays, vacationDays });
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMonthData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const pct =
    totals.sollToDate > 0
      ? Math.min(100, Math.round((totals.istActual / totals.sollToDate) * 100))
      : 0;
  const weeklyHours = workModel
    ? [
        workModel.monday_hours,
        workModel.tuesday_hours,
        workModel.wednesday_hours,
        workModel.thursday_hours,
        workModel.friday_hours,
        workModel.saturday_hours,
        workModel.sunday_hours,
      ].reduce((a: number, h) => a + Number(h || 0), 0)
    : 0;

  function exportCsv() {
    const rows: (string | number)[][] = [
      ["Monat", `${MONTH_NAMES[month]} ${year}`],
      ["Soll (bis heute)", formatMinutes(totals.sollToDate)],
      ["Ist (geleistet)", formatMinutes(totals.istActual)],
      [
        "Saldo Monat",
        `${totals.saldo >= 0 ? "+" : ""}${formatMinutes(totals.saldo)}`,
      ],
      ["Arbeitstage", totals.workDays],
      ["Urlaubstage", totals.vacationDays],
      ["Sollerfüllung (%)", pct],
      ["Zeitmodell", workModel ? workModel.name : "-"],
      ["Wochenarbeitszeit", weeklyHours ? `${weeklyHours} Std` : "-"],
    ];
    downloadCsv(
      `auswertung_${year}_${String(month + 1).padStart(2, "0")}.csv`,
      rows
    );
  }

  return (
    <Shell
      title="Soll / Ist"
      subtitle="Sollzeit im Vergleich zur geleisteten Arbeit"
    >
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
        <p className="text-sm text-slate-500">Auswertung wird geladen…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[12.5px] text-slate-500">Soll (bis heute)</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {formatMinutes(totals.sollToDate)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {MONTH_NAMES[month]} {year}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[12.5px] text-slate-500">Ist (geleistet)</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {formatMinutes(totals.istActual)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {totals.workDays} Arbeitstage
                {totals.vacationDays
                  ? ` · ${totals.vacationDays} Urlaubstage`
                  : ""}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[12.5px] text-slate-500">Saldo Monat</p>
              <p
                className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
                  totals.saldo >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {totals.saldo >= 0 ? "+" : ""}
                {formatMinutes(totals.saldo)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Ist − Soll (Urlaub neutral)
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Sollerfüllung {MONTH_NAMES[month]}:{" "}
                {formatMinutes(totals.istActual)} von{" "}
                {formatMinutes(totals.sollToDate)} Std
              </span>
              <span className="font-semibold text-slate-700">{pct}%</span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${
                  pct >= 100 ? "bg-emerald-500" : "bg-blue-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500">Zeitmodell</p>
                <p className="font-semibold text-slate-800">
                  {workModel ? workModel.name : "–"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Wochenarbeitszeit</p>
                <p className="font-semibold text-slate-800">
                  {weeklyHours ? `${weeklyHours} Std / Woche` : "–"}
                </p>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Der Saldo bezieht sich auf den gewählten Monat. Ein dauerhafter
            Übertrag ins Zeitkonto über Monatsgrenzen (Gleitzeit) lässt sich
            später über ein zusätzliches Feld ergänzen.
          </p>
        </>
      )}
    </Shell>
  );
}
