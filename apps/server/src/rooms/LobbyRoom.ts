// Lobby room — keeps a directory of active tables and offers a join handshake.
// Phase 2 will add floor-position presence + spatial audio routing.

import { Room, Client } from '@colyseus/core';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { ROOMS, S2C, type LobbyTable } from '@shuffle/shared';

class LobbyTableSchema extends Schema {
  @type('string') tableId = '';
  @type('string') name = '';
  @type('string') game = 'blackjack';
  @type('number') minBet = 25;
  @type('number') maxBet = 500;
  @type('number') maxSeats = 6;
  @type('number') seatsTaken = 0;
  @type('boolean') inHand = false;
  @type('number') heat = 18;
  @type('string') heatState = 'cold';
}

class LobbyState extends Schema {
  @type({ map: LobbyTableSchema }) tables = new MapSchema<LobbyTableSchema>();
  @type('number') playersOnline = 0;
}

// Phase 1 ships a single house Blackjack table that every lobby surfaces.
const SEED_TABLES: LobbyTable[] = [
  {
    tableId: 'sunset-lounge',
    name: 'Sunset Lounge',
    game: 'blackjack',
    minBet: 25,
    maxBet: 500,
    maxSeats: 6,
    seatsTaken: 0,
    inHand: false,
    heat: 22,
    heatState: 'cold',
  },
];

export class LobbyRoom extends Room<LobbyState> {
  override onCreate() {
    this.setState(new LobbyState());
    for (const t of SEED_TABLES) {
      const row = new LobbyTableSchema();
      Object.assign(row, t);
      this.state.tables.set(t.tableId, row);
    }
    this.setPatchRate(50);
  }

  override onJoin(_client: Client, _options?: unknown) {
    this.state.playersOnline = this.clients.length;
  }

  override onLeave(_client: Client) {
    this.state.playersOnline = this.clients.length;
  }

  // Allow external callers (the Blackjack rooms) to push live status.
  updateTable(tableId: string, patch: Partial<LobbyTable>) {
    const t = this.state.tables.get(tableId);
    if (!t) return;
    Object.assign(t, patch);
    this.broadcast(S2C.toast, { kind: 'info', text: '' }, { afterNextPatch: true });
  }
}
