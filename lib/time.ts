// Gemeinsame Zeit-Berechnung.
//
// Buchungen mit kind === "pause" reduzieren die Nettoarbeitszeit; alle anderen
// (kind "work" oder ohne kind) zählen als Arbeit.
//
// Zusätzlich wird die gesetzliche Ruhepause nach § 11 AZG berücksichtigt:
// Übersteigt die Arbeitszeit eines Tages sechs Stunden, gebührt eine Ruhepause
// von mindestens einer halben Stunde. Die Ruhepause zählt nicht zur Arbeitszeit.
// Erfasste Pausen und Lücken zwischen zwei Arbeitsbuchungen (also Zeiten, in
// denen tatsächlich ausgestempelt war) werden darauf angerechnet; nur der
// fehlende Rest wird automatisch abgezogen.

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

// Kennzahlen eines Tages inkl. Pausen (erfasste Pausen, Lücken zwischen
// Arbeitsbuchungen und die automatisch verrechnete gesetzliche Pause).
export function dayFigures(entries: WorkEntry[], nowMs: number) {
  const work = entries
    .filter((e) => e.clock_in && !isPause(e))
    .sort(
      (a, b) =>
        new Date(a.clock_in as string).getTime() -
        new Date(b.clock_in as string).getTime()
    );
  const pauses = entries.filter((e) => e.clock_in && isPause(e));

  let workMs = 0;
  let running = false;
  work.forEach((e) => {
    if (!e.clock_out) running = true;
    workMs += entryMs(e, nowMs);
  });

  let gapMs = 0;
  for (let i = 1; i < work.length; i++) {
    const prev = work[i - 1];
    if (prev.clock_out) {
      const gap =
        new Date(work[i].clock_in as string).getTime() -
        new Date(prev.clock_out).getTime();
      if (gap > 0) gapMs += gap;
    }
  }

  const pauseEntryMs = pauses.reduce((a, e) => a + entryMs(e, nowMs), 0);
  const netVorAbzug = Math.max(0, workMs - pauseEntryMs);
  const erfasstePauseMs = pauseEntryMs + gapMs;
  const autoMs = autoPauseMs(netVorAbzug, erfasstePauseMs);

  return {
    workedMs: Math.max(0, netVorAbzug - autoMs),
    pauseMs: erfasstePauseMs + autoMs,
    erfasstePauseMs,
    autoPauseMs: autoMs,
    running,
    komm: work.length ? work[0].clock_in : null,
    geht: work.length ? work[work.length - 1].clock_out : null,
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
