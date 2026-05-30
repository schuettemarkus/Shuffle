// Colyseus schema mirrors the TableView shape and syncs to clients each tick.

import { Schema, type, ArraySchema } from '@colyseus/schema';

export class CardSchema extends Schema {
  @type('string') rank = '';
  @type('string') suit = '';
  @type('boolean') hidden = false;
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
}

export class DealerSchema extends Schema {
  @type({ array: CardSchema }) hand = new ArraySchema<CardSchema>();
  @type('number') handValue = 0;
  @type('boolean') isSoft = false;
}

export class BlackjackState extends Schema {
  @type('string') tableId = '';
  @type('string') name = 'Sunset Lounge';
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
}
