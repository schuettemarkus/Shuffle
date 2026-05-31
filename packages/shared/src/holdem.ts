// No-Limit Texas Hold'em — wire protocol + game types. 6 seats, fixed blinds,
// commit-reveal shuffle each hand. Mirrors the shape of `blackjack.ts` so the
// client can reuse the seat/video/chat infrastructure.

import type { Card } from './blackjack.js';

export const HOLDEM_MAX_SEATS = 6;
export const HOLDEM_TURN_CLOCK_MS = 20_000;
export const HOLDEM_SHOWDOWN_MS = 4_500;
export const HOLDEM_BETWEEN_MS = 3_000;
export const HOLDEM_SMALL_BLIND = 5;
export const HOLDEM_BIG_BLIND = 10;

// Per-street phases of a Hold'em hand.
//   waiting   — not enough players to start.
//   between   — hand just finished; short pause before the next deal.
//   preflop   — hole cards dealt, betting round 1.
//   flop      — three community cards revealed, betting round 2.
//   turn      — fourth community card, betting round 3.
//   river     — fifth community card, betting round 4.
//   showdown  — comparing hands, awarding pots.
//   paused    — host paused.
export type HoldemPhase =
  | 'waiting'
  | 'between'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'paused';

// Per-seat status within a hand.
export type HoldemSeatPhase =
  | 'empty'
  | 'sitting'    // seated but not in this hand (joined late / sat out)
  | 'inHand'    // dealt cards, still live
  | 'folded'
  | 'allIn'
  | 'showdown';

export interface HoldemSeatView {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  // Chips committed in the *current* betting round.
  committed: number;
  // Chips committed across the whole hand (used to compute side pots).
  totalCommitted: number;
  // Hole cards. Only sent face-up to that seat's owner unless at showdown,
  // where every still-live seat's hole cards are visible to all.
  hole: Card[];
  phase: HoldemSeatPhase;
  isTurn: boolean;
  turnClockMs: number;
  connected: boolean;
  graceMs: number;
  // Public per-session stats.
  handsPlayed: number;
  handsWon: number;
  netProfit: number;
  buyIn: number;
}

export interface HoldemPotView {
  // For side pots; the "main" pot is the first entry. `cap` is the per-player
  // contribution cap that produced this pot (e.g. an all-in stack size).
  amount: number;
  cap: number;
  // Seat indices eligible to win this pot.
  eligibleSeats: number[];
}

export interface HoldemTableView {
  tableId: string;
  lobbyId: string;
  name: string;
  hostId: string;
  phase: HoldemPhase;
  phaseClockMs: number;
  round: number;
  seats: HoldemSeatView[];
  // Dealer button + the two blinds for the current hand.
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  // Live betting state.
  community: Card[];
  pots: HoldemPotView[];
  currentBet: number;   // amount each live seat must match this round
  minRaise: number;     // smallest legal raise increment on top of currentBet
  smallBlind: number;
  bigBlind: number;
  // Provably-fair scaffolding (matches Blackjack + Craps).
  commitHash: string;
  revealedSeed: string;
}

// Client -> server actions on a Hold'em room.
export type HoldemAction =
  | { type: 'sit'; seatIndex: number; buyIn: number }
  | { type: 'leave' }
  | { type: 'topUp'; amount: number }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'fold' }
  | { type: 'bet'; amount: number }   // open the betting round at `amount`
  | { type: 'raise'; amount: number } // raise the current bet TO `amount`
  | { type: 'allIn' };

// Result of a single hand — sent on every showdown / folded-around victory.
export interface HoldemHandResult {
  round: number;
  community: { rank: string; suit: string }[];
  perPot: Array<{
    amount: number;
    winners: Array<{ seatIndex: number; playerId: string; share: number; handLabel?: string }>;
  }>;
  perSeat: Array<{
    seatIndex: number;
    playerId: string;
    delta: number;            // net stack change vs hand-start
    hole?: { rank: string; suit: string }[]; // present only for live-to-showdown seats
    handLabel?: string;       // e.g. "Two pair, Aces over Kings"
  }>;
}

// Append-only hand history record for the table-scope log.
export interface HoldemHandRecord {
  round: number;
  endedAt: number;
  community: { rank: string; suit: string }[];
  perSeat: Array<{
    seatIndex: number;
    name: string;
    hole?: { rank: string; suit: string }[];
    contributed: number;      // total chips committed during the hand
    delta: number;
    folded: boolean;
    handLabel?: string;
  }>;
  pots: Array<{ amount: number; winners: number[] }>;
  seed: string;
  commitHash: string;
}

// Hand rank — strictly ordered.
export enum HoldemRank {
  HighCard = 1,
  Pair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10,
}
