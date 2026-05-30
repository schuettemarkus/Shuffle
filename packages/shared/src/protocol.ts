// Wire protocol — message names and payloads between web client and server.
// The Colyseus state schema is authoritative; these are the discrete RPCs.

export const ROOMS = {
  lobby: 'lobby',
  blackjack: 'blackjack',
} as const;

export type RoomName = (typeof ROOMS)[keyof typeof ROOMS];

// Client -> server
export const C2S = {
  // Lobby
  joinTable: 'joinTable',          // payload: { tableId }
  setDisplayName: 'setDisplayName',// payload: { name }

  // Table (mirrors TableAction.type but stays a string literal)
  action: 'action',                // payload: TableAction

  // Reactions broadcast to the table channel.
  reaction: 'reaction',            // payload: { emote }
  chipToss: 'chipToss',            // payload: {}
} as const;

// Server -> client (broadcast notifications; state is synced via schema)
export const S2C = {
  toast: 'toast',                  // payload: { kind, text }
  reaction: 'reaction',            // payload: { from, emote }
  chipToss: 'chipToss',            // payload: { from }
  shuffleReveal: 'shuffleReveal',  // payload: { round, seed, commitHash }
  handResult: 'handResult',        // payload: HandResult
} as const;

export type ToastKind = 'info' | 'win' | 'lose' | 'error';

export interface HandResult {
  round: number;
  perSeat: Array<{
    seatIndex: number;
    playerId: string;
    delta: number;          // chip change (+payout - bet)
    outcome: 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender';
  }>;
  dealerValue: number;
}

// Lobby — table directory entry.
export interface LobbyTable {
  tableId: string;
  name: string;
  game: 'blackjack';
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatsTaken: number;
  inHand: boolean;
  // Heat Index (Phase 4) — included as a stub now so the lobby card can show it.
  heat: number;
  heatState: HeatState;
}

export type HeatState =
  | 'on_fire'
  | 'buzzing'
  | 'cruising'
  | 'cold'
  | 'graveyard'
  | 'rollercoaster'
  | 'whale_watch'
  | 'heater';

export const TURN_CLOCK_MS = 20_000;
export const BET_WINDOW_MS = 12_000;
export const SETTLE_MS = 4_000;
export const RECONNECT_GRACE_MS = 30_000;
export const DEFAULT_BUY_IN = 1000;
export const STARTING_BALANCE = 5000;
