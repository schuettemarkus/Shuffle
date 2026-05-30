// Blackjack types — shared by client and server.
// The server is authoritative for everything here; the client mirrors via
// Colyseus state sync and uses these types for rendering.

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
  // Face-down cards (the dealer hole card) have hidden = true. The server
  // refuses to send rank/suit for hidden cards; the client renders a card back.
  hidden?: boolean;
}

export type SeatPhase =
  | 'empty'        // no player
  | 'waiting'      // seated but hasn't bet this hand
  | 'betting'      // placing bet during betting window
  | 'playing'      // has a live hand
  | 'standing'     // chose stand
  | 'busted'       // > 21
  | 'blackjack'    // natural 21
  | 'surrendered'  // forfeited half bet
  | 'settled';     // hand done, awaiting next round

export interface SeatView {
  index: number;            // 0..5
  playerId: string | null;  // sessionId of the seated player
  displayName: string;
  stack: number;            // chips at the table
  bet: number;              // chips wagered this hand
  hand: Card[];
  handValue: number;        // best legal total (Aces counted soft when useful)
  isSoft: boolean;          // is the current total a "soft" 17 etc.?
  phase: SeatPhase;
  isTurn: boolean;
  // milliseconds remaining on the per-action turn clock
  turnClockMs: number;
  // connection state
  connected: boolean;
  graceMs: number;          // ms remaining before auto-stand/fold on disconnect
}

export type TablePhase =
  | 'waiting'   // not enough players to deal
  | 'betting'   // collecting bets, countdown to deal
  | 'dealing'   // initial deal animation
  | 'playing'   // players acting in seat order
  | 'dealer'    // dealer reveals + draws
  | 'settling'  // payouts
  | 'paused';   // host paused

export interface TableView {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;          // 6
  phase: TablePhase;
  // For betting/dealing phases — countdown in ms.
  phaseClockMs: number;
  seats: SeatView[];
  dealer: {
    hand: Card[];
    handValue: number;
    isSoft: boolean;
  };
  // Commit-reveal fairness scaffolding (Phase 4 hardens this).
  commitHash: string | null;  // sha256 of shuffle seed, committed pre-deal
  revealedSeed: string | null; // seed revealed after the hand
  // host of the room (mirrors Meet)
  hostId: string;
  // round id — monotonic per hand at the table
  round: number;
}

// Player-issued actions to the table room. The server validates every one.
export type TableAction =
  | { type: 'sit'; seatIndex: number; buyIn: number }
  | { type: 'stand' }
  | { type: 'leave' }                                  // alias of stand (controller B)
  | { type: 'bet'; amount: number }                    // place bet during betting phase
  | { type: 'hit' }
  | { type: 'hitStand' }                               // controller A — context-sensitive
  | { type: 'standHand' }                              // explicit stand on hand
  | { type: 'double' }
  | { type: 'split' }                                  // reserved
  | { type: 'surrender' }
  | { type: 'ready' }                                  // ready up to start dealing
  | { type: 'reaction'; emote: Emote }
  | { type: 'tossChip' };

export type Emote = 'cheers' | 'facepalm' | 'clap' | 'taunt';
