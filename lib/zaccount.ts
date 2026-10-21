// Zeitausgleichskonto (ZA / Gleitzeit-Saldo) – eine gemeinsame Rechnung fuer
// Stundenkonto, Team, Mitarbeiter-Ansicht und Dashboard.
//
//   Kontostand = Startsaldo + Summe(Ist - Soll) je Tag ab Kontobeginn
//
// Kontobeginn ist die erste Buchung, bei gesetztem Stichtag fruehestens der
// Stichtag (der Zeitraum davor steckt im Startsaldo). Abwesenheitstage
// (genehmigter Urlaub, Krankenstand ...) sind neutral, ausser Zeitausgleich. Arbeit an Tagen, die
// laut Zeitmodell frei sind, zaehlt voll (Soll 0).

import { holidayName } from "./holidays";
import { netWorkedMsByDay } from "./time";
import {
  WorkModel,
  dayKey,
  isWorkday,
  parseDateKey,
  targetMinutesForDate,
} from "./workmodel";

/**
 * Abwesenheitsart "Zeitausgleich": der Tag wird aus dem ZA-Konto genommen,
 * also NICHT neutral – Soll zaehlt, Ist ist 0, das Konto sinkt um das Tagessoll.
 * Alle anderen Abwesenheiten (Urlaub, Krankheit, Arzt, Sonderurlaub) sind neutral.
 */
export const ZA_ABSENCE_TYPE = "Zeitausgleich";

export function absenceIsNeutral(type?: string | null) {
  return (type || "Urlaub") !== ZA_ABSENCE_TYPE;
}

export type ZaEntry = {
  id: string;
  user_id: string;
  clock_in: string | null;
  clock_out: string | null;
  kind?: string | null;
};

export type ZaAbsence = {
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};

export type ZaMonth = {
  /** "YYYY-MM" */
  key: string;
  soll: number;
  ist: number;
  saldo: number;
  /** Kontostand am Monatsende (inkl. Startsaldo). */
  running: number;
};

export type ZaAccount = {
  openingMinutes: number;
  openingDate: string | null;
  /** Aktueller Kontostand in Minuten. */
  balanceMinutes: number;
  /** Saldo des laufenden Monats in Minuten. */
  currentMonthMinutes: number;
  months: ZaMonth[];
};

export function zaAccount(input: {
  model: WorkModel | null | undefined;
  entries: ZaEntry[];
  /** Genehmigte Abwesenheiten (alle Typen). */
  absences: ZaAbsence[];
  openingMinutes?: number | null;
  openingDate?: string | null;
  now?: Date;
}): ZaAccount {
  const { model, entries } = input;
  const now = input.now || new Date();
  const openingDate = input.openingDate || null;
  const opening = Number(input.openingMinutes || 0);
  const absences = input.absences.filter((a) => a.status === "approved");
  const todayKey = dayKey(now);

  const empty: ZaAccount = {
    openingMinutes: opening,
    openingDate,
    balanceMinutes: opening,
    currentMonthMinutes: 0,
    months: [],
  };

  const workedByDay = netWorkedMsByDay(
    entries,
    (iso) => dayKey(new Date(iso)),
    now.getTime()
  );

  let first: Date | null = null;
  for (const e of entries) {
    if (!e.clock_in) continue;
    const d = new Date(e.clock_in);
    if (!first || d < first) first = d;
  }
  if (!first) return empty;

  const openingStart = openingDate ? parseDateKey(openingDate) : null;
  const start = openingStart && openingStart > first ? openingStart : first;
  if (dayKey(start) > todayKey) return empty;

  const months: Record<string, { soll: number; ist: number; saldo: number }> = {};
  const order: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  while (dayKey(cur) <= todayKey) {
    const key = dayKey(cur);
    const mKey = key.slice(0, 7);
    if (!months[mKey]) {
      months[mKey] = { soll: 0, ist: 0, saldo: 0 };
      order.push(mKey);
    }
    const isOff = !isWorkday(model, cur.getDay());
    const holiday = !isOff ? holidayName(key) : null;
    const target = isOff || holiday ? 0 : targetMinutesForDate(model, key);
    const worked = Math.max(0, Math.round((workedByDay[key] || 0) / 60000));
    const absent =
      !isOff &&
      !holiday &&
      absences.some(
        (a) => key >= a.start_date && key <= a.end_date && absenceIsNeutral(a.type)
      );

    months[mKey].ist += worked;
    months[mKey].soll += target;
    if (!absent) months[mKey].saldo += worked - target;
    cur.setDate(cur.getDate() + 1);
  }

  let running = opening;
  const list: ZaMonth[] = order.map((k) => {
    running += months[k].saldo;
    return { key: k, ...months[k], running };
  });

  const nowMonth = todayKey.slice(0, 7);
  const last = list[list.length - 1];
  return {
    openingMinutes: opening,
    openingDate,
    balanceMinutes: running,
    currentMonthMinutes: last && last.key === nowMonth ? last.saldo : 0,
    months: list,
  };
}
