"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { holidayName } from "@/lib/holidays";

type Profile = { id: string; email: string; full_name: string | null };
type Vacation = {
  id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};

const COLORS = [
  "#2563eb", "#16a34a", "#b45309", "#6d4bd6", "#0e7490", "#be185d",
  "#0d9488", "#c2410c", "#7c3aed", "#0369a1",
];
const MONTH_NAMES = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function KalenderPage() {
  const router = useRouter();
  const now = new Date();

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  async function load() {
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
    const [{ data: profileData }, { data: vacData }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").order("full_name"),
      supabase
        .from("vacation_requests")
        .select("*")
        .in("status", ["approved", "pending"]),
    ]);
    setProfiles((profileData || []) as Profile[]);
    setVacations((vacData || []) as Vacation[]);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function colorOf(userId: string) {
    const idx = profiles.findIndex((p) => p.id === userId);
    return COLORS[(idx < 0 ? 0 : idx) % COLORS.length];
  }
  function nameOf(userId: string) {
    const p = profiles.find((x) => x.id === userId);
    return p ? p.full_name || p.email : "?";
  }

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else setMonth(month + 1);
  }

  // Kalender-Gitter (Montag zuerst)
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;

  function absentees(iso: string) {
    return vacations.filter(
      (v) => iso >= v.start_date && iso <= v.end_date
    );
  }

  return (
    <Shell title="Urlaubskalender" subtitle="Abwesenheiten aller Mitarbeiter">
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          onClick={prevMonth}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ←
        </button>
        <span className="min-w-[150px] text-center text-[15px] font-semibold text-slate-900">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          →
        </button>
        <button
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
          }}
          className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Heute
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Kalender wird geladen…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {WD.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((d, di) => {
                if (d === null)
                  return (
                    <div
                      key={di}
                      className="min-h-[92px] border-b border-r border-slate-100 bg-slate-50/40"
                    />
                  );
                const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
                const wd = new Date(year, month, d).getDay();
                const isWeekend = wd === 0 || wd === 6;
                const hol = !isWeekend ? holidayName(iso) : null;
                const abs = absentees(iso);
                const isToday = iso === todayKey;
                return (
                  <div
                    key={di}
                    className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 ${
                      isWeekend ? "bg-slate-50/50" : ""
                    } ${hol ? "bg-blue-50/40" : ""}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                          isToday
                            ? "bg-blue-600 font-bold text-white"
                            : "text-slate-500"
                        }`}
                      >
                        {d}
                      </span>
                      {hol && (
                        <span
                          title={hol}
                          className="truncate text-[9px] text-blue-500"
                        >
                          {hol}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {abs.map((v) => {
                        const c = colorOf(v.user_id);
                        const approved = v.status === "approved";
                        return (
                          <span
                            key={v.id}
                            title={`${nameOf(v.user_id)} · ${v.type || "Urlaub"}${
                              approved ? "" : " (offen)"
                            }`}
                            className="inline-flex h-5 items-center rounded px-1 text-[10px] font-semibold"
                            style={
                              approved
                                ? { background: c, color: "#fff" }
                                : {
                                    border: `1px dashed ${c}`,
                                    color: c,
                                    background: "#fff",
                                  }
                            }
                          >
                            {initials(nameOf(v.user_id))}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-6 rounded bg-slate-400" /> genehmigt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-6 rounded border border-dashed border-slate-400" />{" "}
          beantragt (offen)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="info" className="h-3.5 w-3.5 text-blue-500" /> Kürzel =
          Mitarbeiter (Name per Maus-over)
        </span>
      </div>
    </Shell>
  );
}
