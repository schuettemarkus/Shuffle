// Craps types — shared by client and server.
//
// The server owns the dice. The client only ever requests bet placements
// and dice-roll triggers from the shooter; the room runs a finite state
// machine with commit-reveal seeds per roll for fairness.

export type Pip = 1 | 2 | 3 | 4 | 5 | 6;

export interface DiceRoll {
  a: Pip;
  b: Pip;
  total: number;          // 2..12
  isHard: boolean;        // both dice show the same pip (and total is 4/6/8/10)
  isCraps: boolean;       // total === 2 || 3 || 12
  isNatural: boolean;     // total === 7 || 11
  // Commit-reveal scaffolding so any player can verify the roll.
  commitHash: string | null;
  seed: string | null;
  rollNumber: number;     // monotonic within the current shooter's roll session
}

// All bet kinds we support. We support the canonical "core craps" set: line
// bets (pass/don't pass), come bets (come/don't come — single instance per
// player), field, place bets (4/5/6/8/9/10), hardways (4/6/8/10), and a small
// prop-bet selection (any 7, any craps, yo, snake eyes, box cars, ace deuce).
//
// Place bets implicitly hold a "point" — the number that has to roll before a
// 7 for the bet to pay. Same for come/don't-come once they have a number.
export type BetKind =
  | 'pass'
  | 'dontPass'
  | 'come'
  | 'dontCome'
  | 'field'
  | 'place4'
  | 'place5'
  | 'place6'
  | 'place8'
  | 'place9'
  | 'place10'
  | 'hard4'
  | 'hard6'
  | 'hard8'
  | 'hard10'
  | 'any7'
  | 'anyCraps'
  | 'yo'
  | 'snakeEyes'
  | 'boxCars'
  | 'aceDeuce';

// Public view of a single bet on the felt. Includes the "working" number once
// a come/come-against bet has resolved its first roll.
export interface CrapsBet {
  id: string;
  seatIndex: number;
  kind: BetKind;
  amount: number;
  // For come / dontCome: the number this bet "travelled to" after its
  // come-out roll. Null until the bet acquires a number.
  point: number | null;
}

// Round phase.
//   'between'  — between hands, players can place line bets.
//   'comeOut'  — shooter is about to roll the come-out (no point yet).
//   'point'    — a point is set; rolling until point or 7.
//   'paused'   — host paused the table.
export type CrapsPhase = 'between' | 'comeOut' | 'point' | 'paused';

export interface CrapsSeatView {
  index: number;
  playerId: string | null;
  identityId: string;
  displayName: string;
  stack: number;
  connected: boolean;
  graceMs: number;
  isShooter: boolean;
  // Public per-session stats so the table reads transparent.
  handsRolled: number;
  netProfit: number;
  longestRoll: number;     // longest sequence of non-seven rolls as shooter
}

export interface CrapsTableView {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: CrapsPhase;
  // The point number, 0 when no point is set.
  point: number;
  // Index of the seat currently holding the dice. -1 when no shooter.
  shooterSeat: number;
  // Last roll (null when no roll has happened yet this session).
  lastRoll: DiceRoll | null;
  // Roll number within the current shooter's session.
  rollsThisShooter: number;
  // Phase clock — ms remaining on the current phase window.
  phaseClockMs: number;
  // Provably-fair scaffolding for the *next* roll.
  commitHash: string | null;
  revealedSeed: string | null;
  hostId: string;
  seats: CrapsSeatView[];
  // All live bets (across all seats). Client filters by seatIndex for the
  // "your bets" pile.
  bets: CrapsBet[];
}

// Player-issued actions. Server validates everything.
export type CrapsAction =
  | { type: 'sit'; seatIndex: number; buyIn: number }
  | { type: 'leave' }
  | { type: 'placeBet'; kind: BetKind; amount: number }
  | { type: 'removeBet'; betId: string }
  | { type: 'roll' }                                  // shooter only
  | { type: 'passShooter' }                           // shooter declines, hand to next
  | { type: 'reaction'; emote: 'cheers' | 'facepalm' | 'clap' | 'taunt' }
  | { type: 'tossChip' };

// Result event broadcast after each roll.
export interface RollResult {
  rollNumber: number;
  roll: DiceRoll;
  // Net deltas applied to each seat this roll (after settling any bets that
  // resolved). The client uses these to drive chip-flight animations + flash.
  perSeat: Array<{
    seatIndex: number;
    delta: number;
  }>;
  // Bets that paid or lost. The kind is included so the client can render a
  // "Pass +50, Hard 8 +135" style breakdown.
  resolved: Array<{
    betId: string;
    seatIndex: number;
    kind: BetKind;
    amount: number;
    delta: number;       // chip change (+payout - wager); 0 if the bet
                         // simply traveled (came / dontCame to a number)
    fate: 'win' | 'lose' | 'travel' | 'push';
  }>;
  // Did the shooter "seven-out"? Used by the client to play the appropriate
  // ambience cue and rotate the dealer-puck transition.
  sevenOut: boolean;
  // Did the shooter make their point? Round of cheers if yes.
  pointMade: boolean;
}

export const CRAPS_TURN_CLOCK_MS = 30_000;
export const CRAPS_BETWEEN_MS = 6_000;

// Pay table — multipliers are total returned (bet × multiplier), so 1 = push,
// 2 = even money, etc.
export const PAY = {
  pass: 2,                // 1:1 (return bet × 2)
  dontPass: 2,            // 1:1
  come: 2,
  dontCome: 2,
  field: 2,               // 1:1 default; 2/12 pay 3 (2:1) via fieldBonus
  fieldBonus: 3,
  // Place pays differ by number.
  place4: 1 + 9 / 5,      // 9:5 → 2.8
  place5: 1 + 7 / 5,      // 7:5 → 2.4
  place6: 1 + 7 / 6,      // 7:6 → ~2.166
  place8: 1 + 7 / 6,
  place9: 1 + 7 / 5,
  place10: 1 + 9 / 5,
  hard4: 8,               // 7:1
  hard6: 10,              // 9:1
  hard8: 10,
  hard10: 8,
  any7: 5,                // 4:1
  anyCraps: 8,            // 7:1
  yo: 16,                 // 15:1
  snakeEyes: 31,          // 30:1
  boxCars: 31,
  aceDeuce: 16,           // 15:1
} as const;
