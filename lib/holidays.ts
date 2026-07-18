// Gesetzliche Feiertage Österreich (bundesweit).
// Bewegliche Feiertage werden über die Osterberechnung (Meeus/Gauss) ermittelt.

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

// dateKey im Format "YYYY-MM-DD"
export function holidayName(dateKey: string): string | null {
  const year = Number(dateKey.slice(0, 4));
  if (!year) return null;
  if (!cache[year]) cache[year] = build(year);
  return cache[year][dateKey] || null;
}

export function isHoliday(dateKey: string): boolean {
  return holidayName(dateKey) !== null;
}
