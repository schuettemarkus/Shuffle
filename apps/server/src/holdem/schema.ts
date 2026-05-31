import { Schema, type, ArraySchema } from '@colyseus/schema';

export class HoldemCardSchema extends Schema {
  @type('string') rank = '';
  @type('string') suit = '';
}

export class HoldemSeatSchema extends Schema {
  @type('number') index = 0;
  @type('string') playerId = '';
  @type('string') identityId = '';
  @type('string') displayName = 'Open seat';
  @type('number') stack = 0;
  @type('number') buyIn = 0;
  // Chips committed this betting round (resets each street).
  @type('number') committed = 0;
  // Chips committed this entire hand (used for side pots).
  @type('number') totalCommitted = 0;
  // Hole cards — sent to all clients but blanked except for the owner or at
  // showdown. We blank by setting rank+suit to empty strings on the wire.
  @type({ array: HoldemCardSchema }) hole = new ArraySchema<HoldemCardSchema>();
  @type('string') phase = 'empty'; // HoldemSeatPhase
  @type('boolean') isTurn = false;
  @type('number') turnClockMs = 0;
  @type('boolean') connected = true;
  @type('number') graceMs = 0;
  // Public per-session stats.
  @type('number') handsPlayed = 0;
  @type('number') handsWon = 0;
  @type('number') netProfit = 0;
  // Last-hand hand label ("Pair of Aces") for the in-tile note at showdown.
  @type('string') handLabel = '';
  // Wants out of the next hand (sit-out toggle).
  @type('boolean') sittingOut = false;
}

export class HoldemPotSchema extends Schema {
  @type('number') amount = 0;
  @type('number') cap = 0;
  @type({ array: 'number' }) eligibleSeats = new ArraySchema<number>();
}

export class HoldemState extends Schema {
  @type('string') tableId = '';
  @type('string') lobbyId = '';
  @type('string') name = 'Skoville Hold\'em';
  @type('number') smallBlind = 5;
  @type('number') bigBlind = 10;
  @type('number') maxSeats = 6;
  @type('string') phase = 'waiting';
  @type('number') phaseClockMs = 0;
  @type('number') round = 0;
  @type('number') buttonSeat = -1;
  @type('number') smallBlindSeat = -1;
  @type('number') bigBlindSeat = -1;
  @type('number') currentBet = 0;
  @type('number') minRaise = 10;
  @type('string') hostId = '';
  @type('string') commitHash = '';
  @type('string') revealedSeed = '';
  @type({ array: HoldemSeatSchema }) seats = new ArraySchema<HoldemSeatSchema>();
  @type({ array: HoldemCardSchema }) community = new ArraySchema<HoldemCardSchema>();
  @type({ array: HoldemPotSchema }) pots = new ArraySchema<HoldemPotSchema>();
}
