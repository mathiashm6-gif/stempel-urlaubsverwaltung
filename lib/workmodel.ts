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

// ---------------------------------------------------------------------------
// Urlaubskonto in Stunden
//
// Warum Stunden statt Tage: sobald Teilzeitmodelle unterschiedlich lange
// Arbeitstage haben (z. B. Mo 7 h, Fr 6 h), ist "ein Urlaubstag" keine
// einheitliche Groesse mehr. Gefuehrt wird daher in Minuten; ein Urlaubstag
// verbraucht genau die Sollstunden dieses Wochentags.
//
// Der Startsaldo (Uebernahme aus dem Altsystem) gilt zu einem Stichtag:
//
//   Rest = Startsaldo + Ansprueche der Jahre NACH dem Stichtagsjahr
//          - Verbrauch ab dem Stichtag
//
// Ohne Stichtag bleibt es bei der reinen Jahresbetrachtung wie bisher.
// ---------------------------------------------------------------------------

/** Durchschnittliche Sollstunden je fixem Arbeitstag (Basis Tage <-> Stunden). */
export function hoursPerWorkday(model: WorkModel | null | undefined) {
  const days = workDaysPerWeek(model);
  if (!days) return 0;
  return weeklyHours(model) / days;
}

/** Minuten als "h:mm", negative Werte mit Vorzeichen. */
export function formatHm(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * "87:33", "87,55", "-12:30", "8" -> Minuten. Ungueltig -> null.
 * Doppelpunkt = Stunden:Minuten, Komma/Punkt = Dezimalstunden.
 */
export function parseHm(text: string): number | null {
  const raw = (text || "").trim().replace(/\s/g, "");
  if (!raw) return null;
  const neg = raw.startsWith("-");
  const body = raw.replace(/^[+-]/, "");
  if (body.includes(":")) {
    const m = /^(\d+):([0-5]?\d)$/.exec(body);
    if (!m) return null;
    const min = Number(m[1]) * 60 + Number(m[2]);
    return neg ? -min : min;
  }
  const num = Number(body.replace(",", "."));
  if (!isFinite(num)) return null;
  const min = Math.round(num * 60);
  return neg ? -min : min;
}

/** Minuten -> Urlaubstage laut Modell (nur fuer die Anzeige "entspricht x Tagen"). */
export function minutesToDays(model: WorkModel | null | undefined, minutes: number) {
  const h = hoursPerWorkday(model);
  if (!h) return 0;
  return minutes / 60 / h;
}

/** Urlaubstage -> Minuten laut Modell (Umrechnung beim Erfassen des Startsaldos). */
export function daysToMinutes(model: WorkModel | null | undefined, days: number) {
  return Math.round(days * hoursPerWorkday(model) * 60);
}

/**
 * Urlaubsverbrauch eines Zeitraums in Minuten: Sollstunden aller fixen
 * Arbeitstage ohne Feiertage. Mit `from`/`to` (jeweils "YYYY-MM-DD") laesst
 * sich auf einen Stichtagsbereich einschraenken.
 */
export function vacationMinutes(
  model: WorkModel | null | undefined,
  start: string,
  end: string,
  from?: string | null,
  to?: string | null
) {
  const s = parseDateKey(start) || new Date(start);
  const e = parseDateKey(end) || new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let minutes = 0;
  const d = new Date(s);
  while (d <= e) {
    const key = dayKey(d);
    const inRange = (!from || key >= from) && (!to || key <= to);
    if (inRange && isVacationDay(model, d)) {
      minutes += targetMinutesForWeekday(model, d.getDay());
    }
    d.setDate(d.getDate() + 1);
  }
  return minutes;
}

/** Jahresanspruch in Minuten (aliquotiert wie die Tagesvariante). */
export function entitlementMinutes(
  model: WorkModel | null | undefined,
  fullDays: number,
  entryDate: string | null | undefined,
  year: number,
  exitDate?: string | null
) {
  const ent = vacationEntitlement(fullDays, entryDate, year, exitDate);
  return { ...ent, minutes: daysToMinutes(model, ent.days) };
}

export type VacationRequestLike = {
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};

export type VacationAccount = {
  /** Uebernommener Startsaldo in Minuten. */
  openingMinutes: number;
  /** Stichtag des Startsaldos ("YYYY-MM-DD") oder null. */
  openingDate: string | null;
  /** Seit dem Stichtag hinzugekommene Jahresansprueche in Minuten. */
  accruedMinutes: number;
  /** Genehmigter Urlaub ab dem Stichtag in Minuten. */
  usedMinutes: number;
  /** Beantragter, noch offener Urlaub ab dem Stichtag in Minuten. */
  pendingMinutes: number;
  /** Verfuegbarer Rest in Minuten (offene Antraege noch nicht abgezogen). */
  restMinutes: number;
  /** Erster gezaehlter Tag ("YYYY-MM-DD"). */
  fromKey: string;
  /** Jahresansprueche, die auf den Startsaldo addiert wurden. */
  accrualYears: { year: number; minutes: number; days: number; aliquot: boolean }[];
  /** true, wenn mit Startsaldo gerechnet wird (sonst reine Jahresbetrachtung). */
  hasOpening: boolean;
};

/**
 * Urlaubskonto in Minuten.
 *
 * Mit Stichtag laeuft das Konto fortlaufend weiter: der uebernommene Saldo
 * plus die Jahresansprueche der Folgejahre, minus alles, was ab dem Stichtag
 * genehmigt wurde. Ohne Stichtag zaehlt nur das laufende Kalenderjahr.
 */
export function vacationAccount(input: {
  model: WorkModel | null | undefined;
  fullDays: number;
  entryDate?: string | null;
  exitDate?: string | null;
  openingMinutes?: number | null;
  openingDate?: string | null;
  requests: VacationRequestLike[];
  today?: Date;
}): VacationAccount {
  const {
    model,
    fullDays,
    entryDate,
    exitDate,
    requests,
    today = new Date(),
  } = input;

  const year = today.getFullYear();
  const openingDate = input.openingDate || null;
  const opening = openingDate ? Number(input.openingMinutes || 0) : 0;

  const accrualYears: VacationAccount["accrualYears"] = [];
  let fromKey: string;

  if (openingDate) {
    // Der Startsaldo enthaelt den Anspruch seines eigenen Jahres bereits.
    const openingYear = (parseDateKey(openingDate) || today).getFullYear();
    for (let y = openingYear + 1; y <= year; y++) {
      const ent = entitlementMinutes(model, fullDays, entryDate, y, exitDate);
      accrualYears.push({
        year: y,
        minutes: ent.minutes,
        days: ent.days,
        aliquot: ent.aliquot,
      });
    }
    fromKey = openingDate;
  } else {
    const ent = entitlementMinutes(model, fullDays, entryDate, year, exitDate);
    accrualYears.push({
      year,
      minutes: ent.minutes,
      days: ent.days,
      aliquot: ent.aliquot,
    });
    fromKey = `${year}-01-01`;
  }

  const accrued = accrualYears.reduce((a, y) => a + y.minutes, 0);

  const isVacation = (r: VacationRequestLike) => (r.type || "Urlaub") === "Urlaub";
  const sum = (status: string) =>
    requests
      .filter((r) => isVacation(r) && r.status === status)
      .reduce(
        (a, r) => a + vacationMinutes(model, r.start_date, r.end_date, fromKey),
        0
      );

  const used = sum("approved");
  const pending = sum("pending");

  return {
    openingMinutes: opening,
    openingDate,
    accruedMinutes: accrued,
    usedMinutes: used,
    pendingMinutes: pending,
    restMinutes: opening + accrued - used,
    fromKey,
    accrualYears,
    hasOpening: !!openingDate,
  };
}
