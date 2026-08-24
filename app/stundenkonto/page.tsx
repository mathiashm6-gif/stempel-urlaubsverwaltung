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
type MonthRow = {
  key: string; // YYYY-MM
  label: string;
  soll: number;
  ist: number;
  saldo: number;
  running: number;
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

export default function StundenkontoPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [hasModel, setHasModel] = useState(true);
  const [opening, setOpening] = useState(0);
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [balance, setBalance] = useState(0);

  async function load() {
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
      .select("*")
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
    setHasModel(!!model);
    // Optionaler Startsaldo (Spalte opening_balance in Minuten – 0, falls nicht vorhanden)
    const openingMin = Number(profile?.opening_balance || 0);
    setOpening(openingMin);

    const { data: entryData } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .order("clock_in", { ascending: true });

    const { data: vacData } = await supabase
      .from("vacation_requests")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "approved");

    const entries = (entryData || []) as TimeEntry[];
    const vacations = (vacData || []) as VacationRequest[];

    // Ist-Minuten je Tag inkl. automatischer Pausenverrechnung (§ 11 AZG)
    const workedByDay = netWorkedMsByDay(
      entries,
      (iso) => localDateKey(new Date(iso)),
      Date.now()
    );

    let firstDate: Date | null = null;
    entries.forEach((e) => {
      if (!e.clock_in) return;
      const inDate = new Date(e.clock_in);
      if (!firstDate || inDate < firstDate) firstDate = inDate;
    });

    if (!firstDate) {
      setRows([]);
      setBalance(openingMin);
      setLoading(false);
      return;
    }

    const now = new Date();
    const todayKey = localDateKey(now);
    const months: Record<string, { soll: number; ist: number; saldo: number }> = {};
    const order: string[] = [];

    const cur = new Date(
      (firstDate as Date).getFullYear(),
      (firstDate as Date).getMonth(),
      (firstDate as Date).getDate()
    );
    while (localDateKey(cur) <= todayKey) {
      const key = localDateKey(cur);
      const mKey = key.slice(0, 7);
      if (!months[mKey]) {
        months[mKey] = { soll: 0, ist: 0, saldo: 0 };
        order.push(mKey);
      }
      const weekday = cur.getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const holiday = !isWeekend ? holidayName(key) : null;
      const target = isWeekend || holiday ? 0 : targetForWeekday(model, weekday);
      const worked = Math.max(0, Math.round((workedByDay[key] || 0) / 60000));

      let absence = false;
      if (!holiday) {
        vacations.forEach((v) => {
          if (key >= v.start_date && key <= v.end_date && !isWeekend)
            absence = true;
        });
      }

      months[mKey].ist += worked;
      months[mKey].soll += target;
      if (!absence) months[mKey].saldo += worked - target;

      cur.setDate(cur.getDate() + 1);
    }

    let running = openingMin;
    const built: MonthRow[] = order.map((mKey) => {
      running += months[mKey].saldo;
      const y = Number(mKey.slice(0, 4));
      const m = Number(mKey.slice(5, 7));
      return {
        key: mKey,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        soll: months[mKey].soll,
        ist: months[mKey].ist,
        saldo: months[mKey].saldo,
        running,
      };
    });

    setRows(built);
    setBalance(running);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentMonthSaldo = rows.length ? rows[rows.length - 1].saldo : 0;

  function exportCsv() {
    const header = ["Monat", "Soll", "Ist", "Saldo", "Kontostand"];
    const dataRows = rows.map((r) => [
      r.label,
      formatMinutes(r.soll),
      formatMinutes(r.ist),
      `${r.saldo >= 0 ? "+" : ""}${formatMinutes(r.saldo)}`,
      `${r.running >= 0 ? "+" : ""}${formatMinutes(r.running)}`,
    ]);
    downloadCsv("stundenkonto.csv", [header, ...dataRows]);
  }

  return (
    <Shell
      title="Stundenkonto"
      subtitle="Fortlaufender Gleitzeit-Saldo über alle Monate"
      actions={
        rows.length ? (
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Icon name="download" className="h-4 w-4 text-slate-500" />
            CSV exportieren
          </button>
        ) : undefined
      }
    >
      {!hasModel && !loading && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
          <Icon name="info" className="mt-0.5 h-4 w-4 text-blue-500" />
          Kein Zeitmodell zugewiesen – ohne Sollzeiten ist der Saldo wenig
          aussagekräftig. Ein Admin kann in der Verwaltung ein Zeitmodell
          zuweisen.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Aktueller Kontostand</p>
          <p
            className={`mt-1.5 text-3xl font-bold tracking-tight tabular-nums ${
              balance >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {balance >= 0 ? "+" : ""}
            {formatMinutes(balance)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Stunden gesamt</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Dieser Monat</p>
          <p
            className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${
              currentMonthSaldo >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {currentMonthSaldo >= 0 ? "+" : ""}
            {formatMinutes(currentMonthSaldo)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Saldo laufender Monat</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Startsaldo</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-slate-900">
            {opening >= 0 ? "+" : ""}
            {formatMinutes(opening)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Anfangsguthaben</p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Stundenkonto wird geladen…</p>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Noch keine Buchungen vorhanden – das Stundenkonto füllt sich, sobald du
          zu stempeln beginnst.
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Monat</th>
                <th className="px-4 py-2.5 text-right">Soll</th>
                <th className="px-4 py-2.5 text-right">Ist</th>
                <th className="px-4 py-2.5 text-right">Saldo</th>
                <th className="px-4 py-2.5 text-right">Kontostand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-medium text-slate-700">
                    {r.label}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMinutes(r.soll)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMinutes(r.ist)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={r.saldo >= 0 ? "text-emerald-600" : "text-red-600"}
                    >
                      {r.saldo >= 0 ? "+" : ""}
                      {formatMinutes(r.saldo)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    <span
                      className={
                        r.running >= 0 ? "text-emerald-600" : "text-red-600"
                      }
                    >
                      {r.running >= 0 ? "+" : ""}
                      {formatMinutes(r.running)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Der Kontostand summiert Ist − Soll über alle Monate ab der ersten
        Buchung. Wochenenden, Feiertage und genehmigte Abwesenheiten sind
        neutral. Ein Anfangsguthaben lässt sich optional pro Mitarbeiter
        hinterlegen.
      </p>
    </Shell>
  );
}
