// Gesetzliche Feiertage Österreich (bundesweit).
// Bewegliche Feiertage werden über die Osterberechnung (Meeus/Gauss) ermittelt.
//
// Dazu kommen Sondertage aus der Tabelle `special_days` (Admin-Pflege),
// z. B. 24. und 31.12. als halber Arbeitstag laut KV Handel:
//   - target_percent 0      -> ganzer Tag frei, zaehlt wie ein Feiertag
//   - target_percent 1..99  -> verkuerztes Tagessoll (Soll x Prozent)
//   - target_percent 100    -> nur Markierung, Soll unveraendert

import type { SupabaseClient } from "@supabase/supabase-js";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function key(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const cache: Record<number, Record<string, string>> = {};

function build(year: number): Record<string, string> {
  const easter = easterSunday(year);
  const rel = (offset: number) => {
    const d = new Date(easter);
    d.setDate(d.getDate() + offset);
    return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  return {
    [key(year, 1, 1)]: "Neujahr",
    [key(year, 1, 6)]: "Heilige Drei Könige",
    [rel(1)]: "Ostermontag",
    [key(year, 5, 1)]: "Staatsfeiertag",
    [rel(39)]: "Christi Himmelfahrt",
    [rel(50)]: "Pfingstmontag",
    [rel(60)]: "Fronleichnam",
    [key(year, 8, 15)]: "Mariä Himmelfahrt",
    [key(year, 10, 26)]: "Nationalfeiertag",
    [key(year, 11, 1)]: "Allerheiligen",
    [key(year, 12, 8)]: "Mariä Empfängnis",
    [key(year, 12, 25)]: "Christtag",
    [key(year, 12, 26)]: "Stefanitag",
  };
}

/** Nur gesetzliche Feiertage. dateKey im Format "YYYY-MM-DD". */
export function legalHolidayName(dateKey: string): string | null {
  const year = Number(dateKey.slice(0, 4));
  if (!year) return null;
  if (!cache[year]) cache[year] = build(year);
  return cache[year][dateKey] || null;
}

// ---------------------------------------------------------------------------
// Sondertage
// ---------------------------------------------------------------------------

export type SpecialDay = {
  id: string;
  /** "YYYY-MM-DD"; bei recurring das erste Jahr, ab dem der Tag gilt. */
  day: string;
  name: string;
  /** Anteil des normalen Tagessolls in Prozent (0-100). */
  target_percent: number;
  /** Jedes Jahr am selben Tag/Monat. */
  recurring: boolean;
};

let specialRows: SpecialDay[] = [];
let inflight: Promise<void> | null = null;

/** Sondertage setzen (z. B. nach dem Speichern im Admin). */
export function setSpecialDays(rows: SpecialDay[]) {
  specialRows = (rows || []).map((r) => ({
    ...r,
    day: String(r.day).slice(0, 10),
    target_percent: Math.max(0, Math.min(100, Number(r.target_percent))),
    recurring: !!r.recurring,
  }));
}

export function getSpecialDays() {
  return specialRows;
}

/**
 * Sondertage aus Supabase laden. Vor jeder Soll-Berechnung aufrufen.
 * Fehlt die Tabelle (Migration noch nicht ausgefuehrt), wird ohne
 * Sondertage weitergerechnet.
 */
export function loadSpecialDays(client: SupabaseClient): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await client
      .from("special_days")
      .select("*")
      .order("day");
    if (error) {
      console.warn("Sondertage nicht geladen:", error.message);
      return;
    }
    setSpecialDays((data || []) as SpecialDay[]);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Sondertag fuer ein Datum. Ein Eintrag fuer genau dieses Datum gewinnt,
 * sonst der juengste jaehrliche Eintrag mit gleichem Tag/Monat, der im
 * betreffenden Jahr schon gilt.
 */
export function specialDay(dateKey: string): SpecialDay | null {
  const key = (dateKey || "").slice(0, 10);
  const exact = specialRows.find((r) => r.day === key);
  if (exact) return exact;
  const md = key.slice(5);
  const year = key.slice(0, 4);
  let best: SpecialDay | null = null;
  for (const r of specialRows) {
    if (!r.recurring || r.day.slice(5) !== md || r.day.slice(0, 4) > year) continue;
    if (!best || r.day > best.day) best = r;
  }
  return best;
}

/**
 * Anteil des normalen Tagessolls: 0 an Feiertagen und freien Sondertagen,
 * z. B. 0,5 am 24.12., sonst 1.
 */
export function dayTargetFactor(dateKey: string): number {
  if (legalHolidayName(dateKey)) return 0;
  const s = specialDay(dateKey);
  return s ? s.target_percent / 100 : 1;
}

/**
 * Verkuerzter Sondertag (Soll zwischen 1 und 99 %)? Liefert eine
 * Anzeige wie "Heiliger Abend (50 % Soll)".
 */
export function shortDayLabel(dateKey: string): string | null {
  if (legalHolidayName(dateKey)) return null;
  const s = specialDay(dateKey);
  if (!s || s.target_percent <= 0 || s.target_percent >= 100) return null;
  return `${s.name} (${s.target_percent} % Soll)`;
}

/**
 * Name eines ganztags freien Tages: gesetzlicher Feiertag oder Sondertag
 * mit 0 % Soll. Verkuerzte Tage liefern null (siehe shortDayLabel).
 */
export function holidayName(dateKey: string): string | null {
  const legal = legalHolidayName(dateKey);
  if (legal) return legal;
  const s = specialDay(dateKey);
  return s && s.target_percent <= 0 ? s.name : null;
}

export function isHoliday(dateKey: string): boolean {
  return holidayName(dateKey) !== null;
}
