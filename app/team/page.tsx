"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { holidayName } from "@/lib/holidays";
import { isPause, netWorkedMsByDay } from "@/lib/time";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  work_model_id: string | null;
};
type WorkModel = {
  id: string;
  monday_hours: number | null;
  tuesday_hours: number | null;
  wednesday_hours: number | null;
  thursday_hours: number | null;
  friday_hours: number | null;
  saturday_hours: number | null;
  sunday_hours: number | null;
};
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
type TeamRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  present: boolean;
  todayMin: number;
  saldoMin: number;
};

const COLORS = [
  "#2563eb", "#16a34a", "#b45309", "#6d4bd6", "#0e7490", "#be185d",
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
function targetForWeekday(model: WorkModel | undefined, weekday: number) {
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
function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function TeamPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TeamRow[]>([]);

  async function loadTeam() {
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
    setLoading(true);

    const now = new Date();
    const todayKey = localDateKey(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      { data: profileData },
      { data: modelData },
      { data: entryData },
      { data: vacData },
    ] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("work_models").select("*"),
      supabase
        .from("time_entries")
        .select("*")
        .gte("clock_in", monthStart.toISOString())
        .lt("clock_in", monthEnd.toISOString()),
      supabase.from("vacation_requests").select("*").eq("status", "approved"),
    ]);

    const profiles = (profileData || []) as Profile[];
    const models = (modelData || []) as WorkModel[];
    const entries = (entryData || []) as TimeEntry[];
    const vacations = (vacData || []) as VacationRequest[];

    const modelById: Record<string, WorkModel> = {};
    models.forEach((m) => (modelById[m.id] = m));

    const entriesByUser: Record<string, TimeEntry[]> = {};
    entries.forEach((e) => {
      if (!e.clock_in) return;
      (entriesByUser[e.user_id] = entriesByUser[e.user_id] || []).push(e);
    });

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const built: TeamRow[] = profiles.map((p) => {
      const userEntries = entriesByUser[p.id] || [];
      const model = p.work_model_id ? modelById[p.work_model_id] : undefined;
      const userVac = vacations.filter((v) => v.user_id === p.id);

      // Netto-Arbeitszeit je Tag inkl. automatischer Pausenverrechnung (§ 11 AZG)
      const workedByDay = netWorkedMsByDay(
        userEntries,
        (iso) => localDateKey(new Date(iso)),
        Date.now()
      );

      let present = false;
      userEntries.forEach((e) => {
        if (!e.clock_in) return;
        if (localDateKey(new Date(e.clock_in)) !== todayKey) return;
        if (!e.clock_out && !isPause(e)) present = true;
      });

      const todayMin = (workedByDay[todayKey] || 0) / 60000;

      let saldoMin = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        const key = localDateKey(date);
        if (key > todayKey) break;
        const weekday = date.getDay();
        const isWeekend = weekday === 0 || weekday === 6;
        const holiday = !isWeekend ? holidayName(key) : null;
        let absence = false;
        if (!holiday) {
          userVac.forEach((v) => {
            if (key >= v.start_date && key <= v.end_date && !isWeekend)
              absence = true;
          });
        }
        if (absence) continue;
        const target =
          isWeekend || holiday ? 0 : targetForWeekday(model, weekday);
        const worked = Math.max(0, Math.round((workedByDay[key] || 0) / 60000));
        saldoMin += worked - target;
      }

      const name = p.full_name || p.email;
      return {
        id: p.id,
        name,
        email: p.email,
        role: p.role,
        present,
        todayMin: Math.max(0, Math.round(todayMin)),
        saldoMin,
      };
    });

    setRows(built);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presentCount = rows.filter((r) => r.present).length;
  const absentCount = rows.length - presentCount;

  const refreshBtn = (
    <button
      onClick={loadTeam}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      <Icon name="refresh" className="h-4 w-4 text-slate-500" />
      Aktualisieren
    </button>
  );

  return (
    <Shell
      title="Team-Status"
      subtitle="Wer ist gerade eingestempelt?"
      actions={refreshBtn}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Mitarbeiter</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
            {rows.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Anwesend</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-600">
            {presentCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12.5px] text-slate-500">Abwesend</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-400">
            {absentCount}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Team wird geladen…</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Mitarbeiter</th>
                <th className="px-4 py-2.5">Rolle</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Heute</th>
                <th className="px-4 py-2.5 text-right">Saldo Monat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                        style={{ background: COLORS[i % COLORS.length] }}
                      >
                        {initials(r.name)}
                      </span>
                      <div>
                        <p className="font-medium text-slate-800">{r.name}</p>
                        <p className="text-xs text-slate-400">{r.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.role}</td>
                  <td className="px-4 py-3">
                    {r.present ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        Anwesend
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Abwesend
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMinutes(r.todayMin)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span
                      className={
                        r.saldoMin >= 0 ? "text-emerald-600" : "text-red-600"
                      }
                    >
                      {r.saldoMin >= 0 ? "+" : ""}
                      {formatMinutes(r.saldoMin)}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Keine Mitarbeiter gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Anwesend bedeutet eine aktuell offene Stempelung. Pause und Feierabend
        lassen sich aus den gespeicherten Buchungen nicht unterscheiden und
        zählen beide als abwesend. Saldo = Ist − Soll des laufenden Monats bis
        heute (Abwesenheiten neutral).
      </p>
    </Shell>
  );
}
