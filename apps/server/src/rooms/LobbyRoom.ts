// Lobby room — a directory of live tables, scoped per friend-group.
//
// Each LobbyRoom instance is keyed by `lobbyId` so a group of friends gets
// their own named room with their own pair of game tables (one Blackjack,
// one Craps). The lobby host (the first player in) can rename the lobby;
// the name is broadcast to everyone in the same lobby.

import { Room, Client } from '@colyseus/core';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { ROOMS, C2S } from '@shuffle/shared';
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
  @type('string') lobbyId = '';
  @type('string') name = 'Shuffle';
  @type('string') hostId = '';
  @type({ map: LobbyTableSchema }) tables = new MapSchema<LobbyTableSchema>();
  @type('number') playersOnline = 0;
}

interface LobbyJoinOptions {
  lobbyId?: string;
  lobbyName?: string;
  identityId?: string;
  displayName?: string;
}

export class LobbyRoom extends Room<LobbyState> {
  private onRegistryChange = (s: TableStatus) => this.applyStatus(s);

  override onCreate(options: LobbyJoinOptions = {}) {
    this.setState(new LobbyState());
    const lobbyId = options.lobbyId || `lobby-${Date.now().toString(36)}`;
    this.state.lobbyId = lobbyId;
    if (options.lobbyName) {
      this.state.name = String(options.lobbyName).slice(0, 40);
    } else if (options.displayName) {
      // Default the lobby name to the creating user's first name so the hero
      // copy reads personally ("3 in Maya's table") before the host renames
      // it (e.g. "3 in Skoville"). Strip trailing punctuation on the first
      // word so "Maya," / "Maya!" both produce "Maya".
      const first = String(options.displayName)
        .trim()
        .split(/\s+/)[0]
        ?.replace(/[^\p{L}\p{N}]+$/u, '');
      if (first) this.state.name = `${first}'s table`.slice(0, 40);
    }

    // Seed the standard pair of tables for this lobby. The tableIds are
    // namespaced by lobbyId so two lobbies never collide in the registry.
    const seeds: Array<{ game: 'blackjack' | 'craps'; minBet: number; maxBet: number; maxSeats: number }> = [
      { game: 'blackjack', minBet: 25, maxBet: 500, maxSeats: 6 },
      { game: 'craps', minBet: 5, maxBet: 500, maxSeats: 8 },
    ];
    for (const s of seeds) {
      const row = new LobbyTableSchema();
      row.tableId = `${lobbyId}:${s.game}`;
      row.name = s.game === 'craps' ? 'Craps' : 'Blackjack';
      row.game = s.game;
      row.minBet = s.minBet;
      row.maxBet = s.maxBet;
      row.maxSeats = s.maxSeats;
      this.state.tables.set(row.tableId, row);
    }

    this.setPatchRate(100);
    for (const status of allStatuses()) this.applyStatus(status);
    lobbyBus.on('change', this.onRegistryChange);

    // Only the lobby host can rename the lobby. Names are clamped to a
    // reasonable length and trimmed of obvious whitespace.
    this.onMessage(C2S.lobbySetName, (client, payload: { name?: string }) => {
      if (client.sessionId !== this.state.hostId) return;
      const cleaned = (payload?.name ?? '').toString().trim().slice(0, 40);
      if (!cleaned) return;
      this.state.name = cleaned;
    });
  }

  override onDispose() {
    lobbyBus.off('change', this.onRegistryChange);
  }

  override onJoin(client: Client, _opts?: LobbyJoinOptions) {
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.state.playersOnline = this.clients.length;
  }

  override onLeave(client: Client) {
    if (this.state.hostId === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.hostId = next?.sessionId ?? '';
    }
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
