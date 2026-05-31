// Lobby room — a directory of live tables, scoped per friend-group.
//
// Each LobbyRoom instance is keyed by `lobbyId` so a group of friends gets
// their own named room with their own pair of game tables (one Blackjack,
// one Craps). The lobby host (the first player in) can rename the lobby;
// the name is broadcast to everyone in the same lobby.

import { Room, Client } from '@colyseus/core';
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { ROOMS, C2S, S2C, type ChatMessage } from '@shuffle/shared';
import { nanoid } from 'nanoid';
import { lobbyBus, allStatuses, type TableStatus } from '../lobbyRegistry.js';
import { chatBus, getChatHistory, postChat, type ChatEvent } from '../chatBus.js';
import { allow } from '../throttle.js';
import { leaderboardBus, top as leaderboardTop } from '../leaderboard.js';

const SYSTEM_SENDER = '__system__';

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

class LeaderboardSchema extends Schema {
  @type('string') identityId = '';
  @type('string') displayName = '';
  @type('number') chipDelta = 0;
  @type('number') handsPlayed = 0;
  @type('number') biggestWin = 0;
  @type('number') biggestLoss = 0;
}

class LobbyState extends Schema {
  @type('string') lobbyId = '';
  @type('string') name = '';
  @type('string') hostId = '';
  @type({ map: LobbyTableSchema }) tables = new MapSchema<LobbyTableSchema>();
  @type('number') playersOnline = 0;
  // Top 5 lifetime chip earners in this lobby, sorted desc.
  @type({ array: LeaderboardSchema }) leaderboard = new ArraySchema<LeaderboardSchema>();
}

interface LobbyJoinOptions {
  lobbyId?: string;
  lobbyName?: string;
  identityId?: string;
  displayName?: string;
}

export class LobbyRoom extends Room<LobbyState> {
  private onRegistryChange = (s: TableStatus) => this.applyStatus(s);
  private lobbyId = 'default';
  private onChat = (e: ChatEvent) => {
    if (e.lobbyId !== this.lobbyId) return;
    this.broadcast(S2C.chat, e.msg);
  };
  private onLeaderboardChange = (e: { lobbyId: string }) => {
    if (e.lobbyId !== this.lobbyId) return;
    this.refreshLeaderboard();
  };

  override onCreate(options: LobbyJoinOptions = {}) {
    this.setState(new LobbyState());
    const lobbyId = options.lobbyId || `lobby-${Date.now().toString(36)}`;
    this.lobbyId = lobbyId;
    this.state.lobbyId = lobbyId;
    if (options.lobbyName) {
      this.state.name = String(options.lobbyName).slice(0, 40);
    }
    // Otherwise leave the lobby unnamed — the first user in (the host) is
    // prompted to name it before they see the rest of the floor.

    // Seed the standard pair of tables for this lobby. The tableIds are
    // namespaced by lobbyId so two lobbies never collide in the registry.
    const seeds: Array<{ game: 'blackjack' | 'craps' | 'holdem'; minBet: number; maxBet: number; maxSeats: number; name: string }> = [
      { game: 'blackjack', minBet: 25, maxBet: 500, maxSeats: 6, name: 'Blackjack' },
      { game: 'craps', minBet: 5, maxBet: 500, maxSeats: 8, name: 'Craps' },
      { game: 'holdem', minBet: 5, maxBet: 10, maxSeats: 6, name: "Hold'em" },
    ];
    for (const s of seeds) {
      const row = new LobbyTableSchema();
      row.tableId = `${lobbyId}:${s.game}`;
      row.name = s.name;
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

    // Shared chat — the same stream the game rooms publish to. Joining the
    // lobby keeps you in the conversation with friends already at a table.
    this.onMessage(C2S.chat, (client, payload: { text?: string }) => {
      const text = (payload?.text ?? '').toString().trim().slice(0, 280);
      if (!text) return;
      if (!allow('chat', client.sessionId, 500)) return; // 2 msgs/sec cap
      const opts = (client.userData ?? {}) as LobbyJoinOptions;
      const name = (opts.displayName || 'Guest').slice(0, 24);
      const msg: ChatMessage = {
        id: nanoid(8),
        from: client.sessionId,
        name,
        text,
        ts: Date.now(),
      };
      postChat(this.lobbyId, msg);
    });
    chatBus.on('message', this.onChat);
    leaderboardBus.on('change', this.onLeaderboardChange);
    this.refreshLeaderboard();
  }

  override onDispose() {
    lobbyBus.off('change', this.onRegistryChange);
    chatBus.off('message', this.onChat);
    leaderboardBus.off('change', this.onLeaderboardChange);
  }

  private refreshLeaderboard() {
    const next = leaderboardTop(this.lobbyId, 5);
    this.state.leaderboard.clear();
    for (const e of next) {
      const row = new LeaderboardSchema();
      row.identityId = e.identityId;
      row.displayName = e.displayName;
      row.chipDelta = e.chipDelta;
      row.handsPlayed = e.handsPlayed;
      row.biggestWin = e.biggestWin;
      row.biggestLoss = e.biggestLoss;
      this.state.leaderboard.push(row);
    }
  }

  override onJoin(client: Client, opts: LobbyJoinOptions = {}) {
    const identityId = opts.identityId ?? client.sessionId;
    const displayName = (opts.displayName ?? 'Guest').slice(0, 24);
    client.userData = { identityId, displayName };
    const isFirst = !this.state.hostId;
    if (isFirst) this.state.hostId = client.sessionId;
    this.state.playersOnline = this.clients.length;
    // Replay backlog to the new client first so they don't miss earlier
    // history, then announce them so everyone (incl. them) sees the
    // "Maya joined" line as the latest message.
    for (const msg of getChatHistory(this.lobbyId)) client.send(S2C.chat, msg);
    // Skip the announcement for the very first joiner (no one to notify yet)
    // and for identityIds we've already announced this session (handles
    // tab refreshes within the lobby's lifetime).
    if (!isFirst && !this.announcedIdentities.has(identityId)) {
      this.announcedIdentities.add(identityId);
      const msg: ChatMessage = {
        id: nanoid(8),
        from: SYSTEM_SENDER,
        name: 'System',
        text: `${displayName} joined the lobby`,
        ts: Date.now(),
      };
      postChat(this.lobbyId, msg);
    }
  }

  override onLeave(client: Client) {
    if (this.state.hostId === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.hostId = next?.sessionId ?? '';
    }
    this.state.playersOnline = this.clients.length;
  }

  private announcedIdentities = new Set<string>();

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
