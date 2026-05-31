// Persistent per-identity wallet + lifetime stats. Lives in localStorage so a
// tab refresh / cross-session visit keeps the same chip count and stat line
// without ever needing a profile or login. The server is still authoritative
// during a live session — this module just remembers the last-seen totals
// across reloads and seeds the next session.

import { getIdentityId } from './identity';

const PREFIX = 'shuffle:wallet-v2:';
const DEFAULT_CHIPS = 1000;

export interface LifetimeStats {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
  blackjacks: number;
  biggestWin: number;
  biggestLoss: number;
  netProfit: number;
}

interface WalletRecord {
  chips: number;
  stats: LifetimeStats;
}

function key(id?: string): string {
  return PREFIX + (id || getIdentityId());
}

function emptyStats(): LifetimeStats {
  return {
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    biggestWin: 0,
    biggestLoss: 0,
    netProfit: 0,
  };
}

function read(id?: string): WalletRecord {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return { chips: DEFAULT_CHIPS, stats: emptyStats() };
    const parsed = JSON.parse(raw) as Partial<WalletRecord>;
    return {
      chips: typeof parsed.chips === 'number' ? parsed.chips : DEFAULT_CHIPS,
      stats: { ...emptyStats(), ...(parsed.stats ?? {}) },
    };
  } catch {
    return { chips: DEFAULT_CHIPS, stats: emptyStats() };
  }
}

function write(rec: WalletRecord, id?: string) {
  try {
    localStorage.setItem(key(id), JSON.stringify(rec));
  } catch {
    // ignore quota / private mode
  }
}

export function getChips(id?: string): number {
  return Math.max(0, Math.floor(read(id).chips));
}

export function setChips(chips: number, id?: string) {
  const cur = read(id);
  cur.chips = Math.max(0, Math.floor(chips));
  write(cur, id);
}

export function addChips(delta: number, id?: string) {
  const cur = read(id);
  cur.chips = Math.max(0, Math.floor(cur.chips + delta));
  write(cur, id);
}

export function getStats(id?: string): LifetimeStats {
  return read(id).stats;
}

// Merge in a per-session delta from the server. We track *lifetime* totals so
// stats accumulate across sessions even when seats reset between joins.
export function recordHand(
  delta: {
    won: boolean;
    lost: boolean;
    pushed: boolean;
    blackjack: boolean;
    profit: number; // signed chip delta from this hand
  },
  id?: string,
) {
  const cur = read(id);
  const s = cur.stats;
  s.handsPlayed += 1;
  if (delta.won) s.handsWon += 1;
  if (delta.lost) s.handsLost += 1;
  if (delta.pushed) s.handsPushed += 1;
  if (delta.blackjack) s.blackjacks += 1;
  s.netProfit += delta.profit;
  if (delta.profit > s.biggestWin) s.biggestWin = delta.profit;
  if (delta.profit < s.biggestLoss) s.biggestLoss = delta.profit;
  write(cur, id);
}

// Game-agnostic record path for Craps + Hold'em. Mirrors recordHand but
// without the blackjack-specific counters — just bumps the running net,
// the win/loss tally, and tracks the biggest single swing.
export function recordSwing(
  delta: { profit: number; won?: boolean; lost?: boolean },
  id?: string,
) {
  if (delta.profit === 0) return; // skip no-ops (pushes / dust rolls)
  const cur = read(id);
  const s = cur.stats;
  s.handsPlayed += 1;
  if (delta.won ?? delta.profit > 0) s.handsWon += 1;
  if (delta.lost ?? delta.profit < 0) s.handsLost += 1;
  s.netProfit += delta.profit;
  if (delta.profit > s.biggestWin) s.biggestWin = delta.profit;
  if (delta.profit < s.biggestLoss) s.biggestLoss = delta.profit;
  write(cur, id);
}

export function resetWallet(id?: string) {
  write({ chips: DEFAULT_CHIPS, stats: emptyStats() }, id);
}
