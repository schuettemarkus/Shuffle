// 5-of-7 hand evaluator for Texas Hold'em. Plain TypeScript, no external
// libraries — at 6 players the worst case is 6 × C(7,5) = 6 × 21 = 126
// comparisons per showdown, well within latency budget.
//
// Returns a comparable score so the higher numeric score always beats the
// lower, plus a human-readable label for the result ribbon.

import type { Card, Rank } from '@shuffle/shared';
import { HoldemRank } from '@shuffle/shared';

const RANK_ORDER: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};

const RANK_NAME: Record<number, string> = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens',
  8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings',
  14: 'Aces',
};

const RANK_NAME_SINGULAR: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
  8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King',
  14: 'Ace',
};

export interface HandScore {
  rank: HoldemRank;
  // Tie-break tuple, packed into a single comparable number for fast compares.
  // Layout (high → low bits): rank(4) tb0(4) tb1(4) tb2(4) tb3(4) tb4(4).
  score: number;
  // The five cards that make up the hand, in canonical order (high → low).
  cards: Card[];
  label: string;
}

// Compute the best 5-card hand score across all C(7,5)=21 subsets.
export function evaluateBest(seven: Card[]): HandScore {
  let best: HandScore | null = null;
  const indices = [0, 1, 2, 3, 4, 5, 6];
  // Pick the 5 cards to KEEP from the 7 by iterating combinations.
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five: Card[] = [];
      for (const k of indices) {
        if (k !== i && k !== j) five.push(seven[k]!);
      }
      const score = scoreFive(five);
      if (!best || score.score > best.score) best = score;
    }
  }
  return best!;
}

// Score exactly five cards. Returns the canonical { rank, score, cards, label }.
function scoreFive(five: Card[]): HandScore {
  // Sort cards by rank descending so straights / kicker logic is uniform.
  const cards = [...five].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank]);
  const ranks = cards.map((c) => RANK_ORDER[c.rank]);

  // --- Flush / straight detection. ---
  const suit = cards[0]!.suit;
  const flush = cards.every((c) => c.suit === suit);

  // Straight detection — handle wheel (A-2-3-4-5) specially. With sorted
  // descending ranks, a straight is consecutive when ranks[i]-ranks[i+1]===1
  // for all i. Wheel: ranks would be [14,5,4,3,2] — special-case it.
  let straightHigh = 0;
  const isWheel =
    ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2;
  if (isWheel) {
    straightHigh = 5; // Ace-low straight tops at 5.
  } else {
    let consec = true;
    for (let i = 0; i < 4; i++) {
      if (ranks[i]! - ranks[i + 1]! !== 1) {
        consec = false;
        break;
      }
    }
    if (consec) straightHigh = ranks[0]!;
  }

  if (flush && straightHigh) {
    if (straightHigh === 14) {
      return mk(HoldemRank.RoyalFlush, [14], cards, 'Royal flush');
    }
    return mk(
      HoldemRank.StraightFlush,
      [straightHigh],
      // For the wheel, reorder so the 5 is first.
      isWheel ? [...cards.slice(1), cards[0]!] : cards,
      `Straight flush, ${RANK_NAME_SINGULAR[straightHigh]}-high`,
    );
  }

  // --- Rank multiplicities. ---
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Sort groups by (count desc, rank desc) — natural priority for FullHouse,
  // FourOfAKind, etc.
  const groups: Array<[number, number]> = [...counts.entries()]
    .map<[number, number]>(([rank, count]) => [rank, count])
    .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

  // Four of a kind.
  if (groups[0]![1] === 4) {
    const quad = groups[0]![0];
    const kicker = groups[1]![0];
    const arranged = arrange(cards, [quad, quad, quad, quad, kicker]);
    return mk(
      HoldemRank.FourOfAKind,
      [quad, kicker],
      arranged,
      `Four of a kind, ${RANK_NAME[quad]}`,
    );
  }

  // Full house.
  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    const trips = groups[0]![0];
    const pair = groups[1]![0];
    const arranged = arrange(cards, [trips, trips, trips, pair, pair]);
    return mk(
      HoldemRank.FullHouse,
      [trips, pair],
      arranged,
      `Full house, ${RANK_NAME[trips]} over ${RANK_NAME[pair]}`,
    );
  }

  if (flush) {
    return mk(
      HoldemRank.Flush,
      ranks.slice(0, 5),
      cards,
      `Flush, ${RANK_NAME_SINGULAR[ranks[0]!]}-high`,
    );
  }

  if (straightHigh) {
    return mk(
      HoldemRank.Straight,
      [straightHigh],
      isWheel ? [...cards.slice(1), cards[0]!] : cards,
      `Straight, ${RANK_NAME_SINGULAR[straightHigh]}-high`,
    );
  }

  // Three of a kind.
  if (groups[0]![1] === 3) {
    const trips = groups[0]![0];
    const k1 = groups[1]![0];
    const k2 = groups[2]![0];
    const arranged = arrange(cards, [trips, trips, trips, k1, k2]);
    return mk(
      HoldemRank.ThreeOfAKind,
      [trips, k1, k2],
      arranged,
      `Three of a kind, ${RANK_NAME[trips]}`,
    );
  }

  // Two pair.
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const p1 = groups[0]![0];
    const p2 = groups[1]![0];
    const kicker = groups[2]![0];
    const arranged = arrange(cards, [p1, p1, p2, p2, kicker]);
    return mk(
      HoldemRank.TwoPair,
      [p1, p2, kicker],
      arranged,
      `Two pair, ${RANK_NAME[p1]} and ${RANK_NAME[p2]}`,
    );
  }

  // One pair.
  if (groups[0]![1] === 2) {
    const p = groups[0]![0];
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a);
    const arranged = arrange(cards, [p, p, ...kickers.slice(0, 3)]);
    return mk(
      HoldemRank.Pair,
      [p, ...kickers.slice(0, 3)],
      arranged,
      `Pair of ${RANK_NAME[p]}`,
    );
  }

  // High card.
  return mk(
    HoldemRank.HighCard,
    ranks.slice(0, 5),
    cards,
    `${RANK_NAME_SINGULAR[ranks[0]!]}-high`,
  );
}

// Pack (rank, tieBreakers[]) into a single comparable number. Each tier of
// tiebreak is a 4-bit slot — max value 15, and our ranks max at 14 (Ace),
// which fits cleanly. Rank itself sits in the top 4 bits.
function mk(rank: HoldemRank, tieBreakers: number[], cards: Card[], label: string): HandScore {
  let score = rank;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (tieBreakers[i] ?? 0);
  }
  return { rank, score, cards, label };
}

// Reorder `cards` so the ranks match the supplied template ordering.
function arrange(cards: Card[], template: number[]): Card[] {
  const out: Card[] = [];
  const used = new Set<number>();
  for (const t of template) {
    for (let i = 0; i < cards.length; i++) {
      if (used.has(i)) continue;
      if (RANK_ORDER[cards[i]!.rank] === t) {
        out.push(cards[i]!);
        used.add(i);
        break;
      }
    }
  }
  return out;
}
