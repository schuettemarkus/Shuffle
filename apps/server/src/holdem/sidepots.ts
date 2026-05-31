// Side-pot calculation for Hold'em.
//
// Given each seat's total chips committed to the hand and whether they folded,
// produce an ordered list of pots: the main pot plus one side pot per distinct
// all-in level. Each pot tracks (amount, eligibleSeats).
//
// Folded seats still contribute their committed chips to the pots, but are
// never eligible to win.

export interface Contribution {
  seatIndex: number;
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  cap: number;            // per-player contribution cap that produced this pot
  eligibleSeats: number[];
}

export function buildSidePots(contributions: Contribution[]): Pot[] {
  // Distinct contribution levels among players who are still LIVE (the only
  // ones whose stack size can cap a pot). Folded players still pay into the
  // pots up to their committed amount.
  const remaining = contributions.map((c) => ({ ...c }));
  const liveCommittedLevels = Array.from(
    new Set(remaining.filter((c) => !c.folded && c.committed > 0).map((c) => c.committed)),
  ).sort((a, b) => a - b);

  // If everyone folded except one, all committed chips just go to that one
  // player as a single pot. (Handled by the caller usually, but defend.)
  const liveSeats = remaining.filter((c) => !c.folded && c.committed > 0);
  if (liveSeats.length <= 1) {
    const amount = remaining.reduce((sum, c) => sum + c.committed, 0);
    if (amount === 0) return [];
    return [
      {
        amount,
        cap: liveSeats[0]?.committed ?? 0,
        eligibleSeats: liveSeats.map((c) => c.seatIndex),
      },
    ];
  }

  const pots: Pot[] = [];
  let prevLevel = 0;
  for (const level of liveCommittedLevels) {
    const slice = level - prevLevel;
    if (slice <= 0) continue;
    let amount = 0;
    const eligible: number[] = [];
    for (const c of remaining) {
      const take = Math.min(slice, Math.max(0, c.committed - prevLevel));
      amount += take;
      if (take > 0 && !c.folded && c.committed >= level) eligible.push(c.seatIndex);
    }
    if (amount > 0) pots.push({ amount, cap: level, eligibleSeats: eligible });
    prevLevel = level;
  }

  // Any chips committed ABOVE the highest live level (i.e. a live player who
  // matched but no one else covered them) are uncontested — return to that
  // player. This can happen if all opponents fold to an over-bet; the caller
  // handles refunds before invoking buildSidePots.
  return pots;
}
