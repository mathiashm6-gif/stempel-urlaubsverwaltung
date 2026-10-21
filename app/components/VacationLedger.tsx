"use client";

// Kontoauszug des Urlaubskontos: je Anspruch (Startsaldo, Jahre) gutgeschrieben,
// verbraucht (aeltester zuerst), Rest und Verjaehrung. Reine Anzeige –
// ausgebucht wird nie automatisch.

import {
  VacationAccount,
  WorkModel,
  formatDays,
  formatHm,
  minutesToDays,
} from "@/lib/workmodel";

function dateLabel(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

export default function VacationLedger({
  account,
  model,
  todayKey,
}: {
  account: VacationAccount;
  model: WorkModel | null;
  /** "YYYY-MM-DD" */
  todayKey: string;
}) {
  if (!account.lots.length) return null;
  const nextYearEnd = `${Number(todayKey.slice(0, 4)) + 1}-12-31`;
  const days = (min: number) =>
    model ? ` (${formatDays(minutesToDays(model, min))} T)` : "";

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-slate-900">Kontoauszug Urlaub</h2>
        <p className="text-xs text-slate-500">
          Konto seit {dateLabel(account.fromKey)}, Resturlaub wird übertragen.
          Verbraucht wird immer der älteste Anspruch zuerst.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Anspruch</th>
            <th className="px-4 py-2.5 text-right">Gutgeschrieben</th>
            <th className="px-4 py-2.5 text-right">Verbraucht</th>
            <th className="px-4 py-2.5 text-right">Rest</th>
            <th className="px-4 py-2.5 text-right">Verjährt am</th>
          </tr>
        </thead>
        <tbody>
          {account.lots.map((l) => {
            const soon = l.restMinutes > 0 && l.expiresKey <= nextYearEnd;
            return (
              <tr key={l.label} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium text-slate-700">{l.label}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {formatHm(l.minutes)}
                  <span className="text-xs text-slate-400">{days(l.minutes)}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {l.usedMinutes ? formatHm(l.usedMinutes) : "–"}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                  {formatHm(l.restMinutes)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums ${
                    l.restMinutes <= 0
                      ? "text-slate-300"
                      : soon
                      ? "font-semibold text-amber-600"
                      : "text-slate-500"
                  }`}
                >
                  {l.restMinutes <= 0 ? "verbraucht" : dateLabel(l.expiresKey)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
        Hinweis: Urlaub verjährt zwei Jahre nach Ende des Urlaubsjahres (§ 4 UrlG),
        aber nur, wenn rechtzeitig darauf hingewiesen wurde. Das Tool bucht nichts
        automatisch aus. Ein Startsaldo wird vorsichtshalber dem Vorjahr zugerechnet.
      </p>
    </div>
  );
}
