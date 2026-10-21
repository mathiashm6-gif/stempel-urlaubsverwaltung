"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { loadAccounts } from "@/lib/accounts";
import { downloadCsv } from "@/lib/csv";

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

export default function StundenkontoPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [hasModel, setHasModel] = useState(true);
  const [opening, setOpening] = useState(0);
  const [openingDate, setOpeningDate] = useState<string | null>(null);
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

    // Gemeinsame Rechnung (lib/zaccount.ts): Startsaldo + Ist - Soll je Tag
    // ab Kontobeginn, Abwesenheiten neutral, freie Tage voll als Plus.
    const accounts = await loadAccounts(supabase, [user.id]);
    const acc = accounts[user.id];
    if (!acc) {
      setLoading(false);
      return;
    }
    setHasModel(!!acc.model);
    setOpening(acc.za.openingMinutes);
    setOpeningDate(acc.za.openingDate);
    setRows(
      acc.za.months.map((m) => {
        const y = Number(m.key.slice(0, 4));
        const mo = Number(m.key.slice(5, 7));
        return {
          key: m.key,
          label: `${MONTH_NAMES[mo - 1]} ${y}`,
          soll: m.soll,
          ist: m.ist,
          saldo: m.saldo,
          running: m.running,
        };
      })
    );
    setBalance(acc.za.balanceMinutes);
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
          <p className="mt-1 text-xs text-slate-400">
            {openingDate
              ? `Stand ${new Date(openingDate).toLocaleDateString("de-DE")}`
              : "Anfangsguthaben"}
          </p>
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
        neutral. Ist ein Startsaldo mit Stichtag hinterlegt, beginnt die
        Zählung erst an diesem Tag – alles davor steckt bereits im Startsaldo.
      </p>
    </Shell>
  );
}
