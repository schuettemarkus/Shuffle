// Per-lobby leaderboard with disk persistence.
//
// Tracks lifetime stats for every (lobbyId, identityId) pair across all
// games in that lobby. Game rooms call `record()` on every hand result;
// LobbyRoom reads `top()` to populate its broadcast schema, and the file
// is rewritten on a debounced timer so a server restart doesn't lose
// the running tally.

import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DATA_FILE =
  process.env.LEADERBOARD_FILE || './data/leaderboard.json';
const FLUSH_INTERVAL_MS = 4_000;

export interface LeaderboardEntry {
  identityId: string;
  displayName: string;
  // Net chip swing across all games (positive = up, negative = down).
  chipDelta: number;
  handsPlayed: number;
  // Distinct games engaged with this lobby.
  blackjackHands: number;
  holdemHands: number;
  crapsRolls: number;
  // Biggest single-hand swing (signed).
  biggestWin: number;
  biggestLoss: number;
  // Wall-clock ms of the most recent activity.
  lastSeenAt: number;
}

export type Game = 'blackjack' | 'holdem' | 'craps';

interface LobbyState {
  entries: Map<string, LeaderboardEntry>;
}

export const leaderboardBus = new EventEmitter();

const lobbies = new Map<string, LobbyState>();
let dirty = false;
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw) as Record<string, LeaderboardEntry[]>;
    for (const [lobbyId, entries] of Object.entries(data)) {
      const map = new Map<string, LeaderboardEntry>();
      for (const e of entries) map.set(e.identityId, e);
      lobbies.set(lobbyId, { entries: map });
    }
  } catch (err) {
    // Missing file on first boot is expected — just start fresh.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[leaderboard] load failed', err);
    }
  }
}

async function flush() {
  if (!dirty) return;
  dirty = false;
  const snapshot: Record<string, LeaderboardEntry[]> = {};
  for (const [lobbyId, state] of lobbies.entries()) {
    snapshot[lobbyId] = Array.from(state.entries.values());
  }
  try {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.warn('[leaderboard] flush failed', err);
    dirty = true; // try again next interval
  }
}

setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS).unref();
void load();

function getOrInit(lobbyId: string, identityId: string, displayName: string): LeaderboardEntry {
  let state = lobbies.get(lobbyId);
  if (!state) {
    state = { entries: new Map() };
    lobbies.set(lobbyId, state);
  }
  let entry = state.entries.get(identityId);
  if (!entry) {
    entry = {
      identityId,
      displayName,
      chipDelta: 0,
      handsPlayed: 0,
      blackjackHands: 0,
      holdemHands: 0,
      crapsRolls: 0,
      biggestWin: 0,
      biggestLoss: 0,
      lastSeenAt: Date.now(),
    };
    state.entries.set(identityId, entry);
  }
  if (displayName && entry.displayName !== displayName) entry.displayName = displayName;
  return entry;
}

// Record a hand result. `profit` is the signed chip swing for this hand.
export function record(
  lobbyId: string,
  identityId: string,
  displayName: string,
  game: Game,
  profit: number,
) {
  if (!identityId) return;
  void load();
  const entry = getOrInit(lobbyId, identityId, displayName);
  entry.chipDelta += profit;
  entry.handsPlayed += 1;
  if (game === 'blackjack') entry.blackjackHands += 1;
  else if (game === 'holdem') entry.holdemHands += 1;
  else if (game === 'craps') entry.crapsRolls += 1;
  if (profit > entry.biggestWin) entry.biggestWin = profit;
  if (profit < entry.biggestLoss) entry.biggestLoss = profit;
  entry.lastSeenAt = Date.now();
  dirty = true;
  leaderboardBus.emit('change', { lobbyId });
}

// Top N entries for a lobby, sorted by chipDelta desc.
export function top(lobbyId: string, limit = 5): LeaderboardEntry[] {
  void load();
  const state = lobbies.get(lobbyId);
  if (!state) return [];
  return Array.from(state.entries.values())
    .sort((a, b) => b.chipDelta - a.chipDelta)
    .slice(0, limit);
}

// Read every entry for a lobby (used for the dynamic OG image / avatars).
export function allFor(lobbyId: string): LeaderboardEntry[] {
  void load();
  const state = lobbies.get(lobbyId);
  if (!state) return [];
  return Array.from(state.entries.values());
}
