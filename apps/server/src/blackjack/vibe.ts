// Per-seat "vibe" computation. Runs server-side after every settle so the
// client never invents a status. The stats are session-scoped (reset when a
// seat is released) and intentionally lossy — we only need enough signal to
// pick a friendly nickname.

import type { Outcome } from './engine.js';

export interface SeatStats {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
  blackjacks: number;
  busts: number;
  // Signed streak: +N = N consecutive wins (or blackjacks), -N = N losses,
  // 0 = a push or fresh seat.
  streak: number;
  // Largest stack we've ever seen for this seat — used to detect drawdowns
  // and comeback narratives.
  peakStack: number;
  startingStack: number;
  // Last-hand bet, used to score "high roller" vs "tip toe" alongside total
  // bet sum.
  totalBet: number;
  lastOutcome: Outcome | 'none';
}

export function emptyStats(startingStack: number): SeatStats {
  return {
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    busts: 0,
    streak: 0,
    peakStack: startingStack,
    startingStack,
    totalBet: 0,
    lastOutcome: 'none',
  };
}

export function recordHand(
  stats: SeatStats,
  outcome: Outcome,
  bet: number,
  stackAfter: number,
): SeatStats {
  const next: SeatStats = { ...stats };
  next.handsPlayed += 1;
  next.totalBet += bet;
  next.peakStack = Math.max(next.peakStack, stackAfter);
  next.lastOutcome = outcome;
  switch (outcome) {
    case 'win':
      next.handsWon += 1;
      next.streak = stats.streak >= 0 ? stats.streak + 1 : 1;
      break;
    case 'blackjack':
      next.handsWon += 1;
      next.blackjacks += 1;
      next.streak = stats.streak >= 0 ? stats.streak + 1 : 1;
      break;
    case 'lose':
      next.handsLost += 1;
      next.streak = stats.streak <= 0 ? stats.streak - 1 : -1;
      break;
    case 'bust':
      next.handsLost += 1;
      next.busts += 1;
      next.streak = stats.streak <= 0 ? stats.streak - 1 : -1;
      break;
    case 'surrender':
      next.handsLost += 1;
      next.streak = stats.streak <= 0 ? stats.streak - 1 : -1;
      break;
    case 'push':
      next.handsPushed += 1;
      next.streak = 0;
      break;
  }
  return next;
}

export interface VibeSnapshot {
  key: string;
  label: string;
  icon: string;
  tint: 'sunset' | 'amber' | 'teal' | 'ice' | 'rose' | 'violet' | 'mute';
  streak: number;
}

// Pull a usable first name out of "displayName". Falls back to a fun
// generic so the labels keep their bite even for anonymous joins.
function firstName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Stranger';
  const first = trimmed.split(/\s+/)[0]!;
  // Possessive-safe: chop trailing non-letters so "Maya," / "Maya!" → Maya.
  return first.replace(/[^\p{L}\p{N}]+$/u, '') || 'Stranger';
}

// Random pick that's stable for the same (key, hash) so a player doesn't see
// the label flicker between two equivalent options each tick.
function pick<T>(arr: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = (h >>> 0) % arr.length;
  return arr[idx]!;
}

export function computeVibe(
  stats: SeatStats,
  ctx: {
    stack: number;
    minBet: number;
    maxBet: number;
    biggestRivalStack: number;
    displayName?: string;
  },
): VibeSnapshot {
  const name = firstName(ctx.displayName);
  // Use the player's name + the streak as a seed so picks feel chosen-for-them
  // but don't flicker mid-streak.
  const seed = `${name}|${stats.handsPlayed}|${Math.sign(stats.streak)}|${stats.peakStack}`;

  // Brand-new seat — no history yet.
  if (stats.handsPlayed === 0) {
    return {
      key: 'rookie',
      label: pick(
        [
          `${name}, fresh off the bus`,
          'Brand-new toy',
          `${name} bought the ticket`,
          'Wide-eyed and dangerous',
        ],
        seed,
      ),
      icon: '🌅',
      tint: 'mute',
      streak: 0,
    };
  }

  // Most recent hand specials win — strongest narrative.
  if (stats.lastOutcome === 'blackjack' && stats.streak >= 1) {
    return {
      key: 'lucky21',
      label: pick(
        [
          `${name} kissed the dealer`,
          `${name} just printed money`,
          `21 with ${name}'s name on it`,
          'Blackjack, baby',
        ],
        seed,
      ),
      icon: '✨',
      tint: 'amber',
      streak: stats.streak,
    };
  }

  // Whale: dominant stack at the table.
  if (
    ctx.biggestRivalStack > 0 &&
    ctx.stack >= ctx.biggestRivalStack * 3 &&
    stats.handsPlayed >= 2
  ) {
    return {
      key: 'whale',
      label: pick(
        [
          `${name}'s wallet says hi`,
          `${name} owns the table now`,
          `Whale alert: ${name}`,
          'Big stack energy',
        ],
        seed,
      ),
      icon: '🐳',
      tint: 'violet',
      streak: stats.streak,
    };
  }

  // Winning streaks.
  if (stats.streak >= 5) {
    return {
      key: 'red_hot',
      label: pick(
        [
          `${name} is volcanic`,
          `Get ${name} a glass of water`,
          'Five in a row, smug as hell',
          `${name} is cooking with gas`,
        ],
        seed,
      ),
      icon: '🔥',
      tint: 'sunset',
      streak: stats.streak,
    };
  }
  if (stats.streak >= 3) {
    if (stats.handsLost === 0) {
      return {
        key: 'stone_cold',
        label: pick(
          [
            `${name} hasn't broken a sweat`,
            'Built different',
            `Untouched, ${name} smirks`,
            'Spotless run',
          ],
          seed,
        ),
        icon: '🥶',
        tint: 'teal',
        streak: stats.streak,
      };
    }
    return {
      key: 'on_heater',
      label: pick(
        [
          `${name} is on a tear`,
          `Hot hand, ${name}`,
          `${name} is cooking`,
          'Three deep, eyes wide',
        ],
        seed,
      ),
      icon: '🚀',
      tint: 'sunset',
      streak: stats.streak,
    };
  }

  // Losing streaks.
  if (stats.streak <= -5) {
    return {
      key: 'frozen',
      label: pick(
        [
          `${name} is a popsicle`,
          'Glacier-grade losses',
          `${name} should call a friend`,
          'Frozen solid, send help',
        ],
        seed,
      ),
      icon: '🧊',
      tint: 'ice',
      streak: stats.streak,
    };
  }
  if (stats.streak <= -3) {
    return {
      key: 'iceberg',
      label: pick(
        [
          `${name}'s in time-out`,
          'Felt is winning',
          `${name} is donating`,
          'Three Ls deep, vibes off',
        ],
        seed,
      ),
      icon: '🧊',
      tint: 'ice',
      streak: stats.streak,
    };
  }

  // Comeback / drawdown narratives.
  const drawdown =
    stats.peakStack > 0 ? 1 - ctx.stack / stats.peakStack : 0;
  if (
    drawdown >= 0.4 &&
    ctx.stack >= stats.startingStack &&
    stats.lastOutcome !== 'lose' &&
    stats.lastOutcome !== 'bust'
  ) {
    return {
      key: 'comeback_kid',
      label: pick(
        [
          `Lazarus, but it's ${name}`,
          `${name} clawed back`,
          'Back from the dead',
          `${name} refuses to die quietly`,
        ],
        seed,
      ),
      icon: '🪂',
      tint: 'amber',
      streak: stats.streak,
    };
  }
  if (drawdown >= 0.5) {
    return {
      key: 'down_bad',
      label: pick(
        [
          `${name} is bleeding chips`,
          `Down bad, ${name}`,
          `${name}'s rent is in danger`,
          'Hemorrhage in progress',
        ],
        seed,
      ),
      icon: '📉',
      tint: 'rose',
      streak: stats.streak,
    };
  }

  // Bet-size personality (needs a few hands of evidence).
  if (stats.handsPlayed >= 3) {
    const avgBet = stats.totalBet / stats.handsPlayed;
    if (ctx.maxBet > ctx.minBet) {
      const ratio = (avgBet - ctx.minBet) / (ctx.maxBet - ctx.minBet);
      if (ratio >= 0.7) {
        return {
          key: 'high_roller',
          label: pick(
            [
              `${name} doesn't ask the price`,
              `Big swings, ${name}`,
              'High-roller energy',
              `${name} flexes loudly`,
            ],
            seed,
          ),
          icon: '💎',
          tint: 'amber',
          streak: stats.streak,
        };
      }
      if (avgBet <= ctx.minBet * 1.2) {
        return {
          key: 'tip_toe',
          label: pick(
            [
              `${name} bets like Grandma`,
              `Featherweight, ${name}`,
              `${name} keeps it humble`,
              'Tip-toeing in slippers',
            ],
            seed,
          ),
          icon: '🐭',
          tint: 'mute',
          streak: stats.streak,
        };
      }
    }
  }

  // Survivor — just clawed a win out after a bust streak.
  if (
    (stats.lastOutcome === 'win' || stats.lastOutcome === 'blackjack') &&
    stats.busts >= 2 &&
    stats.streak >= 1
  ) {
    return {
      key: 'survivor',
      label: pick(
        [
          `Cockroach mode, ${name}`,
          `${name} refuses to die`,
          'Survivor energy',
          `${name} laughs at variance`,
        ],
        seed,
      ),
      icon: '🛟',
      tint: 'teal',
      streak: stats.streak,
    };
  }

  // Push-fest.
  if (stats.lastOutcome === 'push' && stats.handsPushed >= 2) {
    return {
      key: 'push_artist',
      label: pick(
        [
          `${name} can't pick a side`,
          'Pure Switzerland',
          `${name} is going nowhere fast`,
          'Push push push',
        ],
        seed,
      ),
      icon: '🤝',
      tint: 'mute',
      streak: 0,
    };
  }

  // Quiet default.
  return {
    key: 'cruising',
    label: pick(
      [
        `${name} is cruising`,
        'Sunglasses on',
        `${name} doesn't sweat it`,
        'Cool as the felt',
      ],
      seed,
    ),
    icon: '😎',
    tint: 'teal',
    streak: stats.streak,
  };
}
