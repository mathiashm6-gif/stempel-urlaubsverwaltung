// Gemeinsame Zeit-Berechnung.
//
// Buchungen mit kind === "pause" reduzieren die Nettoarbeitszeit; alle anderen
// (kind "work" oder ohne kind) zählen als Arbeit.
//
// Die Berechnung arbeitet auf einer Zeitachse (Intervall-Vereinigung), nicht
// durch Aufsummieren einzelner Buchungen. Dadurch gilt an jedem Punkt des Tages
// genau einer von drei Zuständen: Arbeit, Pause oder nichts. Überlappende oder
// doppelte Buchungen (z. B. doppeltes Einstempeln, eine gestempelte Pause, die
// zusätzlich noch einmal nachgetragen wurde) zählen daher nie mehrfach.
//
// Gesetzliche Ruhepause nach § 11 AZG: Übersteigt die Arbeitszeit eines Tages
// sechs Stunden, gebührt eine Ruhepause von mindestens einer halben Stunde, die
// nicht zur Arbeitszeit zählt. Erfasste Pausen (Pausenbuchungen und Lücken
// zwischen zwei Arbeitsbuchungen, also Zeiten, in denen ausgestempelt war)
// werden darauf angerechnet; nur der fehlende Rest wird automatisch abgezogen.
//   - 8:00–17:00 ohne Pause            -> 30 min automatisch, netto 8:30
//   - 8:00–12:00, 12:35–17:00 (Pause)  -> 35 min Pause (30 gesetzlich + 5),
//                                         kein zusätzlicher Abzug, netto 8:25
//   - 8:00–17:00 + Pause 12:00–12:30
//     nachgetragen                     -> 30 min Pause, kein Abzug, netto 8:30

export const PAUSE_SCHWELLE_MS = 6 * 60 * 60 * 1000; // ab dieser Arbeitszeit
export const PFLICHT_PAUSE_MS = 30 * 60 * 1000; // ... mindestens so viel Pause

// Wenn true, wird höchstens so viel abgezogen, dass die Arbeitszeit nicht unter
// die Sechs-Stunden-Grenze rutscht. Beispiel: 6:10 gearbeitet, keine Pause
// erfasst.
//   false -> 30 min Abzug, Ergebnis 5:40 (der volle gesetzliche Abzug)
//   true  -> 10 min Abzug, Ergebnis 6:00 (Abzug bis zur Grenze gekappt)
export const ABZUG_KAPPEN = false;

export type WorkEntry = {
  clock_in: string | null;
  clock_out: string | null;
  kind?: string | null;
};

export function isPause(e: WorkEntry) {
  return (e.kind || "work") === "pause";
}

export function entryMs(e: WorkEntry, nowMs: number) {
  if (!e.clock_in) return 0;
  const out = e.clock_out ? new Date(e.clock_out).getTime() : nowMs;
  return Math.max(0, out - new Date(e.clock_in).getTime());
}

/**
 * Automatisch abzuziehende Pause für einen Tag.
 *
 * @param arbeitMs         Arbeitszeit nach Abzug der erfassten Pausen
 * @param erfasstePauseMs  Bereits erfasste Pause (Pausenbuchungen + Lücken)
 */
export function autoPauseMs(arbeitMs: number, erfasstePauseMs: number) {
  if (arbeitMs <= PAUSE_SCHWELLE_MS) return 0;
  const fehlt = PFLICHT_PAUSE_MS - Math.max(0, erfasstePauseMs);
  if (fehlt <= 0) return 0;
  if (ABZUG_KAPPEN) {
    return Math.max(0, Math.min(fehlt, arbeitMs - PAUSE_SCHWELLE_MS));
  }
  return fehlt;
}

// ---------------------------------------------------------------------------
// Intervall-Arithmetik (halboffene Intervalle [start, end) in ms)
// ---------------------------------------------------------------------------

export type Interval = { start: number; end: number };

function toIntervals(entries: WorkEntry[], nowMs: number): Interval[] {
  const out: Interval[] = [];
  entries.forEach((e) => {
    if (!e.clock_in) return;
    const start = new Date(e.clock_in).getTime();
    const end = e.clock_out ? new Date(e.clock_out).getTime() : nowMs;
    if (isNaN(start) || isNaN(end)) return;
    if (end > start) out.push({ start, end });
  });
  return out;
}

// Vereinigung: sortiert, überlappende/angrenzende Intervalle verschmolzen.
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  sorted.forEach((i) => {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  });
  return out;
}

// a minus b (beide bereits vereinigt/sortiert).
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  a.forEach((iv) => {
    let cursor = iv.start;
    b.forEach((cut) => {
      if (cut.end <= cursor || cut.start >= iv.end) return;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    });
    if (cursor < iv.end) out.push({ start: cursor, end: iv.end });
  });
  return out;
}

export function intervalsMs(list: Interval[]) {
  return list.reduce((a, i) => a + (i.end - i.start), 0);
}

// ---------------------------------------------------------------------------

// Kennzahlen eines Tages inkl. Pausen (erfasste Pausen, Lücken zwischen
// Arbeitsbuchungen und die automatisch verrechnete gesetzliche Pause).
export function dayFigures(entries: WorkEntry[], nowMs: number) {
  const workEntries = entries.filter((e) => e.clock_in && !isPause(e));
  const pauseEntries = entries.filter((e) => e.clock_in && isPause(e));

  const work = mergeIntervals(toIntervals(workEntries, nowMs));
  const pause = mergeIntervals(toIntervals(pauseEntries, nowMs));

  // Lücken zwischen erstem Kommen und letztem Gehen = ausgestempelte Zeit.
  const gaps =
    work.length > 1
      ? subtractIntervals(
          [{ start: work[0].start, end: work[work.length - 1].end }],
          work
        )
      : [];

  // Arbeit abzüglich erfasster Pausenbuchungen (Pause schlägt Arbeit).
  const netWork = subtractIntervals(work, pause);
  const netVorAbzug = intervalsMs(netWork);

  // Erfasste Pause = Lücken ∪ Pausenbuchungen – jede Minute zählt nur einmal,
  // auch wenn sie sowohl gestempelt als auch nachgetragen wurde.
  const erfasstePauseMs = intervalsMs(mergeIntervals([...gaps, ...pause]));
  const autoMs = autoPauseMs(netVorAbzug, erfasstePauseMs);

  const running = workEntries.some((e) => !e.clock_out);
  let komm: string | null = null;
  let geht: string | null = null;
  workEntries.forEach((e) => {
    if (!komm || (e.clock_in as string) < komm) komm = e.clock_in;
    if (e.clock_out && (!geht || e.clock_out > geht)) geht = e.clock_out;
  });

  return {
    workedMs: Math.max(0, netVorAbzug - autoMs),
    pauseMs: erfasstePauseMs + autoMs,
    erfasstePauseMs,
    autoPauseMs: autoMs,
    running,
    komm,
    geht: running ? null : geht,
  };
}

// Netto-Arbeitszeit (ms) eines Tages inkl. automatischer Pausenverrechnung.
export function netWorkedMs(entries: WorkEntry[], nowMs: number) {
  return dayFigures(entries, nowMs).workedMs;
}

/**
 * Netto-Arbeitszeit je Kalendertag. Die Pausenregel wirkt pro Tag, deshalb muss
 * erst nach Tagen gruppiert und dann gerechnet werden – ein simples Aufsummieren
 * aller Buchungen würde den Abzug verschlucken.
 *
 * @param dateKey Liefert zu einem clock_in-Zeitstempel den Tagesschlüssel
 *                (z. B. "2026-08-24") in der lokalen Zeitzone.
 */
export function netWorkedMsByDay<T extends WorkEntry>(
  entries: T[],
  dateKey: (clockIn: string) => string,
  nowMs: number
): Record<string, number> {
  const byDay: Record<string, T[]> = {};
  entries.forEach((e) => {
    if (!e.clock_in) return;
    const key = dateKey(e.clock_in);
    (byDay[key] = byDay[key] || []).push(e);
  });

  const result: Record<string, number> = {};
  for (const key of Object.keys(byDay)) {
    result[key] = netWorkedMs(byDay[key], nowMs);
  }
  return result;
}
