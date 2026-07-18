"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { holidayName } from "@/lib/holidays";
import { netWorkedMs, isPause } from "@/lib/time";

type WorkModel = {
  name: string;
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
  clock_in: string | null;
  clock_out: string | null;
  created_at: string;
  kind?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();

  const [workModel, setWorkModel] = useState<WorkModel | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [dayEnded, setDayEnded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  async function loadEntries(dateValue = selectedDate) {
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

    const startDate = new Date(dateValue);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", startDate.toISOString())
      .lt("created_at", endDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    const loaded = (data || []) as TimeEntry[];
    setEntries(loaded);

    const today = new Date().toISOString().split("T")[0];
    if (dateValue === today) {
      setActiveEntry(
        loaded.find((e) => e.clock_out === null && !isPause(e)) || null
      );
    } else {
      setActiveEntry(null);
      setDayEnded(false);
    }
  }

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

  async function handleClockIn() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || activeEntry) return;
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase
      .from("time_entries")
      .insert([{ user_id: user.id, clock_in: new Date().toISOString() }]);
    if (error) {
      alert(error.message);
      return;
    }
    setDayEnded(false);
    setSelectedDate(today);
    await loadEntries(today);
  }

  async function closeActive(markEnded: boolean) {
    if (!activeEntry) return;
    const { error } = await supabase
      .from("time_entries")
      .update({ clock_out: new Date().toISOString() })
      .eq("id", activeEntry.id);
    if (error) {
      alert(error.message);
      return;
    }
    setDayEnded(markEnded);
    await loadEntries();
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
    return netWorkedMs(entries, nowMs);
  }

  function targetHoursForDate(dateValue: string) {
    if (!workModel) return 0;
    if (holidayName(dateValue)) return 0;
    const day = new Date(dateValue).getDay();
    const map: Record<number, number | null> = {
      0: workModel.sunday_hours,
      1: workModel.monday_hours,
      2: workModel.tuesday_hours,
      3: workModel.wednesday_hours,
      4: workModel.thursday_hours,
      5: workModel.friday_hours,
      6: workModel.saturday_hours,
    };
    return Number(map[day] || 0);
  }

  const today = new Date().toISOString().split("T")[0];
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
            Tagesziel {targetHours ? `${targetHours}` : "0"} Std
          </p>
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
            onClick={activeEntry ? undefined : handleClockIn}
            disabled={!!activeEntry}
            className="inline-flex items-center gap-2 rounded-[11px] bg-emerald-600 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="play" className="h-4 w-4" />
            {isOnBreak ? "Pause beenden" : "Kommen"}
          </button>
          <button
            onClick={() => closeActive(false)}
            disabled={!activeEntry}
            className="inline-flex items-center gap-2 rounded-[11px] bg-amber-500 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="pause" className="h-4 w-4" />
            Pause
          </button>
          <button
            onClick={() => closeActive(true)}
            disabled={!activeEntry}
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
        )}
      </div>
    </Shell>
  );
}
