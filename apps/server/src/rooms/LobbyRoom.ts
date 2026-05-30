// Lobby room — a directory of live tables.
//
// Phase 2's walk-around floor was rolled back; the social energy lives at
// the table. This room exists only to surface live table status (seats taken,
// in-hand, heat) so the lobby card grid can update in real time.

import { Room, Client } from '@colyseus/core';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { ROOMS } from '@shuffle/shared';
import { lobbyBus, allStatuses, type TableStatus } from '../lobbyRegistry.js';

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

const SEED_TABLES = [
  { tableId: 'sunset-lounge', name: 'Sunset Lounge', game: 'blackjack', minBet: 25, maxBet: 500 },
];

export class LobbyRoom extends Room<LobbyState> {
  private onRegistryChange = (s: TableStatus) => this.applyStatus(s);

  override onCreate() {
    this.setState(new LobbyState());
    for (const t of SEED_TABLES) {
      const row = new LobbyTableSchema();
      Object.assign(row, t);
      this.state.tables.set(t.tableId, row);
    }
    this.setPatchRate(100);
    for (const s of allStatuses()) this.applyStatus(s);
    lobbyBus.on('change', this.onRegistryChange);
  }

  override onDispose() {
    lobbyBus.off('change', this.onRegistryChange);
  }

  override onJoin(_client: Client, _opts?: unknown) {
    this.state.playersOnline = this.clients.length;
  }

  override onLeave(_client: Client) {
    this.state.playersOnline = this.clients.length;
  }

  private applyStatus(s: TableStatus) {
    const row = this.state.tables.get(s.tableId);
    if (!row) return;
    row.seatsTaken = s.seatsTaken;
    row.inHand = s.inHand;
    row.heat = s.heat;
    row.heatState = s.heatState;
  }
}

// Silence "ROOMS" import dead-code lint — keep the wire constant in scope.
void ROOMS;
