// Gemeinsame Zeit-Berechnung. Buchungen mit kind === "pause" reduzieren die
// Nettoarbeitszeit; alle anderen (kind "work" oder ohne kind) zählen als Arbeit.

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

// Netto-Arbeitszeit (ms) eines Tages: Summe Arbeit − Summe Pausen.
export function netWorkedMs(entries: WorkEntry[], nowMs: number) {
  let ms = 0;
  for (const e of entries) ms += (isPause(e) ? -1 : 1) * entryMs(e, nowMs);
  return Math.max(0, ms);
}

// Kennzahlen eines Tages inkl. Pausen (explizite Pausen + Lücken zwischen Arbeit).
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
  const netWorked = Math.max(0, workMs - pauseEntryMs);

  return {
    workedMs: netWorked,
    pauseMs: gapMs + pauseEntryMs,
    running,
    komm: work.length ? work[0].clock_in : null,
    geht: work.length ? work[work.length - 1].clock_out : null,
  };
}
