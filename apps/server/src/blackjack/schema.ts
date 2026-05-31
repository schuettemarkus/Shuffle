// Colyseus schema mirrors the TableView shape and syncs to clients each tick.

import { Schema, type, ArraySchema } from '@colyseus/schema';

export class CardSchema extends Schema {
  @type('string') rank = '';
  @type('string') suit = '';
  @type('boolean') hidden = false;
}

// Per-seat vibe. The server recomputes this after every settle from
// SeatStats (in BlackjackRoom) — the client is purely consumer.
export class VibeSchema extends Schema {
  @type('string') key = 'rookie';
  @type('string') label = 'New at the felt';
  @type('string') icon = '🌅';
  @type('string') tint = 'mute';
  @type('number') streak = 0;
}

export class SeatSchema extends Schema {
  @type('number') index = 0;
  @type('string') playerId = '';
  @type('string') identityId = '';
  @type('string') displayName = 'Open seat';
  @type('number') stack = 0;
  @type('number') bet = 0;
  @type({ array: CardSchema }) hand = new ArraySchema<CardSchema>();
  @type('number') handValue = 0;
  @type('boolean') isSoft = false;
  @type('string') phase: string = 'empty';
  @type('boolean') isTurn = false;
  @type('number') turnClockMs = 0;
  @type('boolean') connected = true;
  @type('number') graceMs = 0;
  @type('boolean') wantReady = false;
  @type('boolean') muted = false;
  // Split-hand state. Mirrors the main-hand fields; only populated when the
  // player has split a pair this hand.
  @type({ array: CardSchema }) splitHand = new ArraySchema<CardSchema>();
  @type('number') splitHandValue = 0;
  @type('boolean') splitIsSoft = false;
  @type('number') splitBet = 0;
  @type('string') splitPhase = 'empty';
  @type('boolean') splitActive = false;
  // Royal Match side bet. `bet` is what the player wagered; outcome + payout
  // are filled in immediately after the initial deal so the seat can flash
  // a result without waiting for the dealer phase.
  @type('number') royalMatchBet = 0;
  @type('string') royalMatchOutcome = 'none';
  @type('number') royalMatchPayout = 0;
  // Vibe: live "how is this player doing" read.
  @type(VibeSchema) vibe = new VibeSchema();
  // Public per-session stats. Recomputed after every settle so the table
  // reads as transparent — anyone can see how a seat has been doing.
  @type('number') handsPlayed = 0;
  @type('number') handsWon = 0;
  @type('number') handsLost = 0;
  @type('number') handsPushed = 0;
  @type('number') blackjacks = 0;
  @type('number') netProfit = 0;        // stack now − stack bought in with
  @type('number') biggestWin = 0;       // largest single-hand profit
  @type('number') biggestLoss = 0;      // largest single-hand loss (negative)
  @type('number') buyIn = 0;            // record of original buy-in
}

export class DealerSchema extends Schema {
  @type({ array: CardSchema }) hand = new ArraySchema<CardSchema>();
  @type('number') handValue = 0;
  @type('boolean') isSoft = false;
}

export class BlackjackState extends Schema {
  @type('string') tableId = '';
  @type('string') name = 'Skoville';
  @type('number') minBet = 25;
  @type('number') maxBet = 500;
  @type('number') maxSeats = 6;
  @type('string') phase = 'waiting';
  @type('number') phaseClockMs = 0;
  @type({ array: SeatSchema }) seats = new ArraySchema<SeatSchema>();
  @type(DealerSchema) dealer = new DealerSchema();
  @type('string') commitHash = '';
  @type('string') revealedSeed = '';
  @type('string') hostId = '';
  @type('number') round = 0;
  @type('boolean') stakesLocked = false;
  // Index of the seat holding the dealer button this round. Rotates every
  // hand to the next non-empty seat; -1 when nobody is seated.
  @type('number') dealerButtonSeat = -1;
  // Single-deck blackjack with public Hi-Lo card counting. Players see the
  // running count + cards dealt, and can compute the true count themselves.
  @type('number') deckCount = 1;
  @type('number') cardsDealt = 0;
  @type('number') runningCount = 0;
}
