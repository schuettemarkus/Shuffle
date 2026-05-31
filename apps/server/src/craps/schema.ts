// Colyseus schema for the Craps room.

import { Schema, type, ArraySchema } from '@colyseus/schema';

export class DiceRollSchema extends Schema {
  @type('number') a = 0;
  @type('number') b = 0;
  @type('number') total = 0;
  @type('boolean') isHard = false;
  @type('boolean') isCraps = false;
  @type('boolean') isNatural = false;
  @type('string') commitHash = '';
  @type('string') seed = '';
  @type('number') rollNumber = 0;
  // Wall-clock ms when this roll resolved — clients use it to drive the
  // bounce animation rather than relying on patch timing.
  @type('number') ts = 0;
}

export class CrapsBetSchema extends Schema {
  @type('string') id = '';
  @type('number') seatIndex = 0;
  @type('string') kind = '';
  @type('number') amount = 0;
  @type('number') point = 0;   // 0 when not yet acquired
}

export class CrapsSeatSchema extends Schema {
  @type('number') index = 0;
  @type('string') playerId = '';
  @type('string') identityId = '';
  @type('string') displayName = 'Open seat';
  @type('number') stack = 0;
  @type('number') buyIn = 0;
  @type('boolean') connected = true;
  @type('number') graceMs = 0;
  @type('boolean') isShooter = false;
  @type('boolean') muted = false;
  // Public stats.
  @type('number') handsRolled = 0;
  @type('number') netProfit = 0;
  @type('number') longestRoll = 0;
}

export class CrapsState extends Schema {
  @type('string') tableId = '';
  @type('string') name = 'Skoville Craps';
  @type('number') minBet = 5;
  @type('number') maxBet = 500;
  @type('number') maxSeats = 8;
  @type('string') phase = 'between';
  @type('number') phaseClockMs = 0;
  @type('number') point = 0;
  @type('number') shooterSeat = -1;
  @type('number') rollsThisShooter = 0;
  @type(DiceRollSchema) lastRoll = new DiceRollSchema();
  @type('string') commitHash = '';
  @type('string') revealedSeed = '';
  @type('string') hostId = '';
  @type({ array: CrapsSeatSchema }) seats = new ArraySchema<CrapsSeatSchema>();
  @type({ array: CrapsBetSchema }) bets = new ArraySchema<CrapsBetSchema>();
}
