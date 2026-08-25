// Arbeitszeitmodelle mit fixen Arbeitstagen.
//
// Ein Zeitmodell legt je Wochentag die Sollstunden fest. Ein Wochentag mit
// Sollstunden > 0 ist ein **fixer Arbeitstag** dieses Modells. Daraus ergeben
// sich einheitlich:
//   - das Tagessoll (Journal, Auswertung, Stundenkonto)
//   - welche Tage bei Urlaub/Abwesenheit gezaehlt werden
//   - wie viele Arbeitstage pro Woche das Modell hat (Basis der Aliquotierung)
//
// Ist einem Mitarbeiter kein Modell zugeordnet, wird ersatzweise die klassische
// Woche Mo-Fr angenommen, damit bestehende Daten nicht kippen.

import { isHoliday } from "./holidays";

export type WorkModel = {
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

// Spaltennamen je Wochentag. idx = Date#getDay() (0 = Sonntag).
export const WEEKDAYS: {
  idx: number;
  field: keyof WorkModel;
  short: string;
  label: string;
}[] = [
  { idx: 1, field: "monday_hours", short: "Mo", label: "Montag" },
  { idx: 2, field: "tuesday_hours", short: "Di", label: "Dienstag" },
  { idx: 3, field: "wednesday_hours", short: "Mi", label: "Mittwoch" },
  { idx: 4, field: "thursday_hours", short: "Do", label: "Donnerstag" },
  { idx: 5, field: "friday_hours", short: "Fr", label: "Freitag" },
  { idx: 6, field: "saturday_hours", short: "Sa", label: "Samstag" },
  { idx: 0, field: "sunday_hours", short: "So", label: "Sonntag" },
];

export const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// Fallback ohne Zeitmodell: Mo-Fr sind Arbeitstage, Soll aber 0.
function fallbackIsWorkday(weekday: number) {
  return weekday >= 1 && weekday <= 5;
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// "YYYY-MM-DD" -> lokales Date (ohne Zeitzonen-Verschiebung).
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Sollstunden des Modells fuer einen Wochentag (0 = Sonntag). */
export function hoursForWeekday(model: WorkModel | null | undefined, weekday: number) {
  if (!model) return 0;
  const day = WEEKDAYS.find((w) => w.idx === weekday);
  if (!day) return 0;
  return Number(model[day.field] || 0);
}

/** Tagessoll in Minuten. */
export function targetMinutesForWeekday(model: WorkModel | null | undefined, weekday: number) {
  return Math.round(hoursForWeekday(model, weekday) * 60);
}

/** Fixer Arbeitstag laut Modell? Ohne Modell gilt Mo-Fr. */
export function isWorkday(model: WorkModel | null | undefined, weekday: number) {
  if (!model) return fallbackIsWorkday(weekday);
  return hoursForWeekday(model, weekday) > 0;
}

/** Arbeitstag und kein gesetzlicher Feiertag. */
export function isVacationDay(model: WorkModel | null | undefined, date: Date) {
  return isWorkday(model, date.getDay()) && !isHoliday(dayKey(date));
}

/** Anzahl fixer Arbeitstage pro Woche. */
export function workDaysPerWeek(model: WorkModel | null | undefined) {
  if (!model) return 5;
  return WEEKDAYS.filter((w) => Number(model[w.field] || 0) > 0).length;
}

/** Wochenstunden des Modells. */
export function weeklyHours(model: WorkModel | null | undefined) {
  if (!model) return 0;
  return WEEKDAYS.reduce((a, w) => a + Number(model[w.field] || 0), 0);
}

/** Kurzform der fixen Arbeitstage, z. B. "Mo, Di, Do". */
export function workdayLabel(model: WorkModel | null | undefined) {
  if (!model) return "Mo-Fr";
  const days = WEEKDAYS.filter((w) => Number(model[w.field] || 0) > 0);
  if (days.length === 0) return "keine";
  return days.map((w) => w.short).join(", ");
}

/**
 * Arbeitstage im Zeitraum laut Zeitmodell, ohne gesetzliche Feiertage.
 * Grundlage fuer den Urlaubsverbrauch: ein Urlaubstag = ein fixer Arbeitstag.
 */
export function countWorkDays(
  model: WorkModel | null | undefined,
  start: string,
  end: string
) {
  const s = parseDateKey(start) || new Date(start);
  const e = parseDateKey(end) || new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    if (isVacationDay(model, d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Sollstunden im Zeitraum laut Zeitmodell, ohne Feiertage. */
export function targetHours(model: WorkModel | null | undefined, start: string, end: string) {
  const s = parseDateKey(start) || new Date(start);
  const e = parseDateKey(end) || new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let hours = 0;
  const d = new Date(s);
  while (d <= e) {
    if (!isHoliday(dayKey(d))) hours += hoursForWeekday(model, d.getDay());
    d.setDate(d.getDate() + 1);
  }
  return hours;
}

// ---------------------------------------------------------------------------
// Aliquoter Urlaubsanspruch (Kalenderjahr)
// ---------------------------------------------------------------------------

/**
 * Rundung des aliquoten Anspruchs. 2 = halbe Tage, 1 = ganze Tage,
 * 4 = Viertel. Aufgerundet zugunsten des Mitarbeiters.
 */
export const ALIQUOT_STEP = 2;

function roundUpToStep(value: number) {
  return Math.ceil(value * ALIQUOT_STEP - 1e-9) / ALIQUOT_STEP;
}

function daysBetween(a: Date, b: Date) {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86400000) + 1; // inklusive beider Tage
}

export type VacationEntitlement = {
  /** Anspruch fuer das Kalenderjahr (aliquotiert). */
  days: number;
  /** Voller Jahresanspruch bei ganzjaehriger Beschaeftigung. */
  fullDays: number;
  /** true, wenn aliquotiert wurde. */
  aliquot: boolean;
  /** Beschaeftigte Kalendertage im Jahr. */
  coveredDays: number;
  /** Kalendertage des Jahres. */
  yearDays: number;
  /** Erster anspruchsrelevanter Tag im Jahr ("YYYY-MM-DD"). */
  from: string;
  /** Letzter anspruchsrelevanter Tag im Jahr ("YYYY-MM-DD"). */
  to: string;
};

/**
 * Aliquoter Urlaubsanspruch fuer ein Kalenderjahr.
 *
 * Regel: Wer ganzjaehrig beschaeftigt ist, bekommt den vollen Jahresanspruch.
 * Bei unterjaehrigem Eintritt wird tagesgenau aliquotiert:
 *
 *   Anspruch = Jahresanspruch x (beschaeftigte Kalendertage / Kalendertage des Jahres)
 *
 * Das Ergebnis wird auf halbe Tage aufgerundet (siehe ALIQUOT_STEP).
 *
 * @param fullDays   Jahresanspruch laut Profil (z. B. 25)
 * @param entryDate  Eintrittsdatum "YYYY-MM-DD" oder null
 * @param year       Kalenderjahr
 * @param exitDate   optionales Austrittsdatum "YYYY-MM-DD"
 */
export function vacationEntitlement(
  fullDays: number,
  entryDate: string | null | undefined,
  year: number,
  exitDate?: string | null
): VacationEntitlement {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const yearDays = daysBetween(yearStart, yearEnd);
  const full = Number(fullDays || 0);

  let from = yearStart;
  let to = yearEnd;

  const entry = entryDate ? parseDateKey(entryDate) : null;
  if (entry && entry > yearStart) from = entry;

  const exit = exitDate ? parseDateKey(exitDate) : null;
  if (exit && exit < yearEnd) to = exit;

  const base = {
    fullDays: full,
    yearDays,
    from: dayKey(from),
    to: dayKey(to),
  };

  // Eintritt nach dem Jahr bzw. Austritt davor: kein Anspruch.
  if (to < from) {
    return { ...base, days: 0, aliquot: true, coveredDays: 0 };
  }

  const coveredDays = daysBetween(from, to);
  if (coveredDays >= yearDays) {
    return { ...base, days: full, aliquot: false, coveredDays };
  }

  return {
    ...base,
    days: roundUpToStep((full * coveredDays) / yearDays),
    aliquot: true,
    coveredDays,
  };
}

/** Zahl ohne unnoetige Nachkommastellen, z. B. 12,5 / 25. */
export function formatDays(value: number) {
  return Number(value.toFixed(2)).toLocaleString("de-AT");
}
