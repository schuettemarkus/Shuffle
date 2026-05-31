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
  // Split hand (when player splits a pair). Empty + bet 0 when not split.
  splitHand: Card[];
  splitHandValue: number;
  splitIsSoft: boolean;
  splitBet: number;
  splitPhase: SeatPhase;
  splitActive: boolean;     // currently acting on the split (rather than the main) hand
  // Royal Match side bet — wagered during the betting window, resolved
  // immediately after the initial deal. Pays 25:1 on K+Q same suit (royal),
  // 2.5:1 on any same-suit pair (easy).
  royalMatchBet: number;
  royalMatchOutcome: RoyalMatchOutcome;
  royalMatchPayout: number; // chips returned (0 on lose). Cleared each round.
  // Per-player vibe (server-computed, refreshed after each settle).
  vibe: SeatVibe;
}

// A live "how is this player doing?" read. Recomputed on the server after
// every settle from per-seat stats — never trust the client. The label/icon/
// tint are part of the payload so the client doesn't have to keep a mapping
// in sync; the server is the single source of truth.
export interface SeatVibe {
  key: VibeKey;             // semantic key for analytics + targeted styling
  label: string;            // short, friendly title shown under the name
  icon: string;              // emoji (1–2 chars)
  tint: 'sunset' | 'amber' | 'teal' | 'ice' | 'rose' | 'violet' | 'mute';
  streak: number;           // current win or loss streak length (signed: +N wins, -N losses)
}

export type VibeKey =
  | 'rookie'        // first hand at the felt
  | 'cruising'     // steady, no notable streak
  | 'lucky21'      // just hit a blackjack
  | 'on_heater'    // 3+ wins in a row
  | 'red_hot'      // 5+ wins in a row
  | 'stone_cold'   // wins, no losses on the session so far (3+ hands)
  | 'comeback_kid' // was down 40%+, now back to even or ahead
  | 'down_bad'     // 50%+ below their peak stack
  | 'iceberg'      // 3+ losses in a row
  | 'frozen'       // 5+ losses in a row
  | 'whale'        // stack ≥ ~3× next biggest at the table
  | 'high_roller'  // average bet ≥ 70% of max
  | 'tip_toe'      // average bet ≤ 120% of min over 3+ hands
  | 'push_artist'  // pushed last 2+ hands in a row
  | 'survivor';    // came back from a bust streak with a win

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
  // Seat index that holds the dealer button this round. Rotates each hand
  // among non-empty seats; -1 when nobody is seated.
  dealerButtonSeat: number;
}

// Player-issued actions to the table room. The server validates every one.
export type TableAction =
  | { type: 'sit'; seatIndex: number; buyIn: number }
  | { type: 'stand' }
  | { type: 'leave' }                                  // alias of stand (controller B)
  | { type: 'bet'; amount: number }                    // place bet during betting phase
  | { type: 'royalMatch'; amount: number }             // Royal Match side bet (0 to disable)
  | { type: 'hit' }
  | { type: 'hitStand' }                               // controller A — context-sensitive
  | { type: 'standHand' }                              // explicit stand on hand
  | { type: 'double' }
  | { type: 'split' }
  | { type: 'surrender' }
  | { type: 'ready' }                                  // ready up to start dealing
  | { type: 'topUp'; amount: number }                  // buy back into the seat with N more chips (unlimited)
  | { type: 'reaction'; emote: Emote }
  | { type: 'tossChip' };

// Royal Match side-bet outcome. Resolved immediately after the initial deal.
// • 'none'  — bet was 0 or the seat didn't get two cards.
// • 'lose'  — the two initial cards were not the same suit.
// • 'easy'  — same suit, not K+Q.
// • 'royal' — K + Q of the same suit (the namesake).
export type RoyalMatchOutcome = 'none' | 'lose' | 'easy' | 'royal';

// Multiplier returned per outcome (player gets bet × multiplier back; 0 = lose).
//   royal: 26  (25:1 plus original)
//   easy:  3.5 (2.5:1 plus original)
//   lose:  0
export function royalMatchMultiplier(o: RoyalMatchOutcome): number {
  switch (o) {
    case 'royal': return 26;
    case 'easy':  return 3.5;
    case 'lose':  return 0;
    case 'none':  return 1; // returns the unwagered amount; effectively a no-op
  }
}

export type Emote = 'cheers' | 'facepalm' | 'clap' | 'taunt';
