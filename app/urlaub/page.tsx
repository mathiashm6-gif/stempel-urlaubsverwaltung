"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { isHoliday } from "@/lib/holidays";

type VacationRequest = {
  id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};

const YEAR = new Date().getFullYear();
const ABSENCE_TYPES = [
  "Urlaub",
  "Krankheit",
  "Arzt",
  "Sonderurlaub",
  "Zeitausgleich",
];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function workingDays(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6 && !isHoliday(dayKey(d))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function statusLabel(status: string) {
  if (status === "approved")
    return { text: "Genehmigt", cls: "bg-emerald-50 text-emerald-700" };
  if (status === "rejected")
    return { text: "Abgelehnt", cls: "bg-red-50 text-red-700" };
  return { text: "Offen", cls: "bg-amber-50 text-amber-700" };
}

export default function UrlaubPage() {
  const router = useRouter();

  const [vacationDays, setVacationDays] = useState(0);
  const [type, setType] = useState("Urlaub");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
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
      .select("vacation_days")
      .eq("id", user.id)
      .single();
    if (profile) setVacationDays(Number(profile.vacation_days || 0));

    const { data, error } = await supabase
      .from("vacation_requests")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }
    setRequests((data || []) as VacationRequest[]);
    setLoading(false);
  }

  async function handleSubmit() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    if (!startDate || !endDate) {
      alert("Bitte Start- und Enddatum auswählen.");
      return;
    }
    if (endDate < startDate) {
      alert("Das Enddatum darf nicht vor dem Startdatum liegen.");
      return;
    }
    const { error } = await supabase.from("vacation_requests").insert([
      {
        user_id: user.id,
        type,
        start_date: startDate,
        end_date: endDate,
        status: "pending",
      },
    ]);
    if (error) {
      alert(error.message);
      return;
    }
    setType("Urlaub");
    setStartDate("");
    setEndDate("");
    await loadData();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isUrlaub = (r: VacationRequest) => (r.type || "Urlaub") === "Urlaub";
  const thisYearUrlaub = requests.filter(
    (r) => isUrlaub(r) && new Date(r.start_date).getFullYear() === YEAR
  );
  const takenDays = thisYearUrlaub
    .filter((r) => r.status === "approved")
    .reduce((a, r) => a + workingDays(r.start_date, r.end_date), 0);
  const pendingDays = thisYearUrlaub
    .filter((r) => r.status === "pending")
    .reduce((a, r) => a + workingDays(r.start_date, r.end_date), 0);
  const restDays = vacationDays - takenDays;
  const usedPct =
    vacationDays > 0 ? Math.min(100, Math.round((takenDays / vacationDays) * 100)) : 0;

  const inputCls =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <Shell title="Urlaub" subtitle={`Urlaubskonto ${YEAR} und Abwesenheitsanträge`}>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { l: "Jahresanspruch", v: vacationDays, h: "Urlaubstage", c: "text-slate-900" },
          { l: "Genommen", v: takenDays, h: "genehmigt", c: "text-slate-900" },
          { l: "Beantragt", v: pendingDays, h: "offen", c: "text-slate-900" },
          {
            l: "Resturlaub",
            v: restDays,
            h: "Tage verfügbar",
            c: restDays >= 0 ? "text-emerald-600" : "text-red-600",
          },
        ].map((s) => (
          <div
            key={s.l}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-[12.5px] text-slate-500">{s.l}</p>
            <p className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${s.c}`}>
              {s.v}
            </p>
            <p className="mt-1 text-xs text-slate-400">{s.h}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {takenDays} von {vacationDays} Tagen genommen
            {pendingDays ? ` · ${pendingDays} beantragt` : ""}
          </span>
          <span className="font-semibold text-slate-700">{usedPct}%</span>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-violet-500"
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Nur Anträge vom Typ Urlaub wirken sich auf das Urlaubskonto aus.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900">
            Neue Abwesenheit beantragen
          </h2>
          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Art der Abwesenheit
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={inputCls}
              >
                {ABSENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  Von
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  Bis
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            {startDate && endDate && endDate >= startDate && (
              <p className="text-sm text-slate-500">
                Das entspricht{" "}
                <span className="font-semibold text-slate-700">
                  {workingDays(startDate, endDate)} Arbeitstagen
                </span>{" "}
                (Mo–Fr).
              </p>
            )}
            <button
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              <Icon name="check" className="h-4 w-4" />
              Antrag absenden
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-slate-900">
              Meine Anträge
            </h2>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-sm text-slate-500">Wird geladen…</p>
          ) : requests.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Keine Anträge vorhanden.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Art</th>
                  <th className="px-4 py-2.5">Zeitraum</th>
                  <th className="px-4 py-2.5 text-right">Tage</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const label = statusLabel(r.status);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {r.type || "Urlaub"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {new Date(r.start_date).toLocaleDateString("de-DE")} –{" "}
                        {new Date(r.end_date).toLocaleDateString("de-DE")}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {workingDays(r.start_date, r.end_date)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${label.cls}`}
                        >
                          {label.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Arbeitstage werden als Werktage (Mo–Fr) ohne gesetzliche Feiertage
        (Österreich) gezählt.
      </p>
    </Shell>
  );
}
