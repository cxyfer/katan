export function openingMetrics(pipsBySeat: readonly (readonly number[])[]): { openExpected: number | null; openRank: number | null }[] {
  const totals = pipsBySeat.map((pips) => pips.length === 2 ? pips[0]! + pips[1]! : null);
  const complete = totals.every((total) => total !== null);
  return totals.map((total) => total === null
    ? { openExpected: null, openRank: null }
    : { openExpected: total / 36, openRank: complete ? 1 + totals.filter((other) => other !== null && other > total).length : null });
}

/** timeline[0] 是開局完成，timeline[N] 是下一輪開始；終局另外多記一筆。 */
export function checkpointVp(timeline: readonly (readonly number[])[], round: number, seat: number, terminal: boolean): number | null {
  return round < timeline.length - Number(terminal) ? (timeline[round]?.[seat] ?? null) : null;
}
