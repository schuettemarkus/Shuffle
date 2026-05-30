// Server-authoritative Blackjack engine.
//
// Decision tree is small enough to make provably correct, which is why the
// spec picks Blackjack as the Phase 1 vertical slice. The engine itself is
// pure: shuffle, deal, value, and the small state-machine helpers. The
// Colyseus room wraps it and ticks clocks.

import { createHash, randomBytes } from 'node:crypto';
import type { Card, Rank, Suit } from '@shuffle/shared';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function buildShoe(deckCount = 4): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < deckCount; d++) {
    for (const s of SUITS) for (const r of RANKS) shoe.push({ rank: r, suit: s });
  }
  return shoe;
}

// Commit-reveal: server generates a seed, commits sha256(seed) before the
// hand, reveals seed after. A deterministic Fisher-Yates seeded from the
// raw seed bytes makes the shuffle replayable from (seed, initialShoe).
export function newSeed(): { seed: string; commitHash: string } {
  const seed = randomBytes(32).toString('hex');
  const commitHash = createHash('sha256').update(seed).digest('hex');
  return { seed, commitHash };
}

// Mulberry32 PRNG seeded from the first 4 bytes of the seed (cheap, good
// enough for shuffle fairness given we use the full seed via commit-reveal).
function prngFromSeed(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(shoe: Card[], seed: string): Card[] {
  const arr = shoe.slice();
  const rnd = prngFromSeed(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// Card numeric value. Aces are 1 here; soft accounting happens in handValue.
export function rawValue(card: Card): number {
  switch (card.rank) {
    case 'A': return 1;
    case 'J': case 'Q': case 'K': case '10': return 10;
    default: return Number(card.rank);
  }
}

// Best legal total — promote one Ace from 1 -> 11 if it doesn't bust.
export function handValue(hand: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    total += rawValue(c);
    if (c.rank === 'A') aces++;
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
}

export function isBlackjack(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const { total } = handValue(hand);
  return total === 21;
}

export function shouldDealerHit(hand: Card[]): boolean {
  const { total, soft } = handValue(hand);
  if (total < 17) return true;
  // Standard Vegas: dealer hits soft 17.
  if (total === 17 && soft) return true;
  return false;
}

export interface DealResult {
  shoe: Card[];
  hands: Card[][];
  dealer: Card[]; // [upCard, holeCard(hidden)]
}

// Burn one + deal two to each seat then dealer, alternating per real BJ rules.
export function dealInitial(shoe: Card[], seatCount: number): DealResult {
  const work = shoe.slice();
  const hands: Card[][] = Array.from({ length: seatCount }, () => []);
  const dealer: Card[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < seatCount; s++) {
      hands[s]!.push(work.shift()!);
    }
    const card = work.shift()!;
    dealer.push(pass === 1 ? { ...card, hidden: true } : card);
  }
  return { shoe: work, hands, dealer };
}

export function drawOne(shoe: Card[]): { card: Card; shoe: Card[] } {
  const work = shoe.slice();
  const card = work.shift()!;
  return { card, shoe: work };
}

export function revealHole(dealer: Card[]): Card[] {
  return dealer.map((c) => ({ ...c, hidden: false }));
}

export type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender';

export function settle(player: Card[], dealer: Card[], opts: { surrendered?: boolean } = {}): Outcome {
  if (opts.surrendered) return 'surrender';
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  const pBJ = isBlackjack(player);
  const dBJ = isBlackjack(dealer);
  if (p > 21) return 'bust';
  if (pBJ && !dBJ) return 'blackjack';
  if (pBJ && dBJ) return 'push';
  if (d > 21) return 'win';
  if (p > d) return 'win';
  if (p < d) return 'lose';
  return 'push';
}

// Payout multipliers vs. the original bet (return = bet * multiplier).
// 0 means lose, 1 means push (bet returned), 2 means win (1:1), 2.5 means BJ (3:2).
export function payoutMultiplier(outcome: Outcome): number {
  switch (outcome) {
    case 'win': return 2;
    case 'blackjack': return 2.5;
    case 'push': return 1;
    case 'lose':
    case 'bust': return 0;
    case 'surrender': return 0.5;
  }
}
