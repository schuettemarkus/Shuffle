// Server-authoritative Craps engine — pure helpers. The CrapsRoom wraps it.

import { createHash, randomBytes } from 'node:crypto';
import type { BetKind, DiceRoll, Pip } from '@shuffle/shared';
import { PAY } from '@shuffle/shared';

export function newDiceSeed(): { seed: string; commitHash: string } {
  const seed = randomBytes(32).toString('hex');
  const commitHash = createHash('sha256').update(seed).digest('hex');
  return { seed, commitHash };
}

// Derive two pips from a seed. We split the seed into two 16-byte halves and
// hash each into a 32-bit unsigned int, then `mod 6 + 1`. The bias from %6 on
// 2^32 is < 10^-9 — negligible at play-money stakes.
export function rollFromSeed(seed: string, rollNumber: number): { a: Pip; b: Pip } {
  const h = createHash('sha256')
    .update(seed)
    .update(String(rollNumber))
    .digest();
  const aRaw = h.readUInt32BE(0);
  const bRaw = h.readUInt32BE(4);
  const a = ((aRaw % 6) + 1) as Pip;
  const b = ((bRaw % 6) + 1) as Pip;
  return { a, b };
}

export function buildRoll(seed: string, commitHash: string, rollNumber: number): DiceRoll {
  const { a, b } = rollFromSeed(seed, rollNumber);
  const total = a + b;
  const isHard = a === b && (total === 4 || total === 6 || total === 8 || total === 10);
  const isCraps = total === 2 || total === 3 || total === 12;
  const isNatural = total === 7 || total === 11;
  return {
    a,
    b,
    total,
    isHard,
    isCraps,
    isNatural,
    commitHash,
    seed,
    rollNumber,
  };
}

// Returns a multiplier for a bet given a settled roll + current point.
// Returned shape:
//   { fate: 'win', mult } → player gets `amount × mult` back.
//   { fate: 'lose' }      → player loses the bet entirely.
//   { fate: 'travel', to }→ bet moves to a number (come / dontCome); stays on
//                          the felt with new point = to.
//   { fate: 'push' }      → bet stays as-is (no resolution this roll).
export type BetResolution =
  | { fate: 'win'; mult: number }
  | { fate: 'lose' }
  | { fate: 'travel'; to: number }
  | { fate: 'push' };

interface ResolveCtx {
  total: number;
  a: Pip;
  b: Pip;
  point: number;
  bet: { kind: BetKind; amount: number; point: number | null };
}

export function resolveBet(ctx: ResolveCtx): BetResolution {
  const { total, a, b, point, bet } = ctx;
  switch (bet.kind) {
    case 'pass': {
      if (point === 0) {
        if (total === 7 || total === 11) return { fate: 'win', mult: PAY.pass };
        if (total === 2 || total === 3 || total === 12) return { fate: 'lose' };
        return { fate: 'push' };
      }
      // With point established
      if (total === point) return { fate: 'win', mult: PAY.pass };
      if (total === 7) return { fate: 'lose' };
      return { fate: 'push' };
    }
    case 'dontPass': {
      if (point === 0) {
        if (total === 2 || total === 3) return { fate: 'win', mult: PAY.dontPass };
        if (total === 12) return { fate: 'push' }; // bar 12 — push (Vegas)
        if (total === 7 || total === 11) return { fate: 'lose' };
        return { fate: 'push' };
      }
      if (total === 7) return { fate: 'win', mult: PAY.dontPass };
      if (total === point) return { fate: 'lose' };
      return { fate: 'push' };
    }
    case 'come': {
      if (bet.point == null) {
        if (total === 7 || total === 11) return { fate: 'win', mult: PAY.come };
        if (total === 2 || total === 3 || total === 12) return { fate: 'lose' };
        if (total === 4 || total === 5 || total === 6 || total === 8 || total === 9 || total === 10) {
          return { fate: 'travel', to: total };
        }
        return { fate: 'push' };
      }
      if (total === bet.point) return { fate: 'win', mult: PAY.come };
      if (total === 7) return { fate: 'lose' };
      return { fate: 'push' };
    }
    case 'dontCome': {
      if (bet.point == null) {
        if (total === 2 || total === 3) return { fate: 'win', mult: PAY.dontCome };
        if (total === 12) return { fate: 'push' };
        if (total === 7 || total === 11) return { fate: 'lose' };
        if (total === 4 || total === 5 || total === 6 || total === 8 || total === 9 || total === 10) {
          return { fate: 'travel', to: total };
        }
        return { fate: 'push' };
      }
      if (total === 7) return { fate: 'win', mult: PAY.dontCome };
      if (total === bet.point) return { fate: 'lose' };
      return { fate: 'push' };
    }
    case 'field': {
      if (total === 2 || total === 12) return { fate: 'win', mult: PAY.fieldBonus };
      if (total === 3 || total === 4 || total === 9 || total === 10 || total === 11) {
        return { fate: 'win', mult: PAY.field };
      }
      return { fate: 'lose' };
    }
    case 'place4':
    case 'place5':
    case 'place6':
    case 'place8':
    case 'place9':
    case 'place10': {
      // Place bets are OFF on the come-out by default. (Most casinos.)
      if (point === 0) return { fate: 'push' };
      if (total === 7) return { fate: 'lose' };
      const num = parseInt(bet.kind.replace('place', ''), 10);
      if (total === num) return { fate: 'win', mult: PAY[bet.kind] };
      return { fate: 'push' };
    }
    case 'hard4':
    case 'hard6':
    case 'hard8':
    case 'hard10': {
      const num = parseInt(bet.kind.replace('hard', ''), 10);
      if (total === 7) return { fate: 'lose' };
      if (total === num) {
        if (a === b) return { fate: 'win', mult: PAY[bet.kind] };
        return { fate: 'lose' }; // easy way kills the hard way
      }
      return { fate: 'push' };
    }
    case 'any7':
      return total === 7 ? { fate: 'win', mult: PAY.any7 } : { fate: 'lose' };
    case 'anyCraps':
      return total === 2 || total === 3 || total === 12
        ? { fate: 'win', mult: PAY.anyCraps }
        : { fate: 'lose' };
    case 'yo':
      return total === 11 ? { fate: 'win', mult: PAY.yo } : { fate: 'lose' };
    case 'snakeEyes':
      return total === 2 ? { fate: 'win', mult: PAY.snakeEyes } : { fate: 'lose' };
    case 'boxCars':
      return total === 12 ? { fate: 'win', mult: PAY.boxCars } : { fate: 'lose' };
    case 'aceDeuce':
      return total === 3 ? { fate: 'win', mult: PAY.aceDeuce } : { fate: 'lose' };
  }
}

// Bets that may only be placed during the come-out roll, when bets travel to
// a number / line bets sit on the line.
export function isComeOutOnlyBet(kind: BetKind): boolean {
  return kind === 'pass' || kind === 'dontPass';
}

// Bets that may be placed once a point is established.
export function isPointPhaseBet(kind: BetKind): boolean {
  return kind === 'come' || kind === 'dontCome';
}
