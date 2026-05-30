// Lobby room — the floor.
//
// Phase 2 expands the lobby from a static table directory into a living
// presence room: every connected player has a floor position, walks around,
// can tap a table to travel to it, and gets close enough to "sit." The host
// is the first player to connect and gets a small control panel (lock stakes,
// pause table, kick).
//
// Spatial audio routing (LiveKit) will plug into the same position stream in
// the deferred Phase-2 step.

import { Room, Client } from '@colyseus/core';
import { Schema, type, MapSchema } from '@colyseus/schema';
import {
  C2S,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  MOVE_SEND_HZ,
  PLAYER_SPEED,
  ROOMS,
  SIT_RADIUS,
} from '@shuffle/shared';
import {
  lobbyBus,
  allStatuses,
  setTableConfig,
  type TableStatus,
} from '../lobbyRegistry.js';

class FloorPlayerSchema extends Schema {
  @type('string') sessionId = '';
  @type('string') identityId = '';
  @type('string') displayName = '';
  @type('number') x = 50;
  @type('number') y = 50;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('number') facing = 0;            // radians, for avatar orientation
  @type('boolean') host = false;
  @type('boolean') connected = true;
  // Movement input from the client (normalized −1..1). Server integrates.
  @type('number') inX = 0;
  @type('number') inY = 0;
  // Tap-to-travel target — when set, server steers the avatar toward it.
  @type('number') targetX = 0;
  @type('number') targetY = 0;
  @type('boolean') hasTarget = false;
  // Walk-and-sit intent — when within SIT_RADIUS of this table, auto-sit.
  @type('string') walkingTo = '';
  // Internal: last time we received a `move` from this client (ms epoch).
  // Not synced; used to zero stale input after a packet drop.
  lastMoveAt = 0;
}

class FloorTableSchema extends Schema {
  @type('string') tableId = '';
  @type('string') name = '';
  @type('string') game = 'blackjack';
  @type('number') x = 50;
  @type('number') y = 50;
  @type('number') minBet = 25;
  @type('number') maxBet = 500;
  @type('number') maxSeats = 6;
  @type('number') seatsTaken = 0;
  @type('boolean') inHand = false;
  @type('number') heat = 18;
  @type('string') heatState = 'cold';
  @type('boolean') stakesLocked = false;
  @type('boolean') paused = false;
}

class LobbyState extends Schema {
  @type({ map: FloorPlayerSchema }) players = new MapSchema<FloorPlayerSchema>();
  @type({ map: FloorTableSchema }) tables = new MapSchema<FloorTableSchema>();
  @type('string') hostId = '';
  @type('number') playersOnline = 0;
}

// Floor layout — Phase 2 seeds one table; Phase 4 will spawn more dynamically
// as host opens them.
const SEED_TABLES: Array<{
  tableId: string;
  name: string;
  x: number;
  y: number;
  minBet: number;
  maxBet: number;
}> = [
  { tableId: 'sunset-lounge', name: 'Sunset Lounge', x: 50, y: 32, minBet: 25, maxBet: 500 },
];

const TICK_MS = 50;

export class LobbyRoom extends Room<LobbyState> {
  private onRegistryChange = (s: TableStatus) => this.applyStatus(s);
  private tick?: NodeJS.Timeout;

  override onCreate() {
    this.setState(new LobbyState());
    for (const t of SEED_TABLES) {
      const row = new FloorTableSchema();
      Object.assign(row, t);
      this.state.tables.set(t.tableId, row);
    }
    this.setPatchRate(50);

    // Seed status from any blackjack rooms that started before us.
    for (const s of allStatuses()) this.applyStatus(s);
    lobbyBus.on('change', this.onRegistryChange);

    this.onMessage(C2S.move, (client, msg: { dx: number; dy: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.inX = clamp(msg?.dx ?? 0, -1, 1);
      p.inY = clamp(msg?.dy ?? 0, -1, 1);
      p.lastMoveAt = Date.now();
      // Any manual input cancels tap-to-travel.
      if (p.inX !== 0 || p.inY !== 0) {
        p.hasTarget = false;
        p.walkingTo = '';
      }
    });

    this.onMessage(C2S.travelTo, (client, msg: { x: number; y: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.targetX = clamp(msg?.x ?? p.x, 0, FLOOR_WIDTH);
      p.targetY = clamp(msg?.y ?? p.y, 0, FLOOR_HEIGHT);
      p.hasTarget = true;
      p.walkingTo = '';
    });

    this.onMessage(C2S.walkToTable, (client, msg: { tableId: string }) => {
      const p = this.state.players.get(client.sessionId);
      const t = this.state.tables.get(msg?.tableId);
      if (!p || !t) return;
      p.targetX = t.x;
      p.targetY = t.y;
      p.hasTarget = true;
      p.walkingTo = t.tableId;
    });

    this.onMessage(
      C2S.hostLockStakes,
      (client, msg: { tableId: string; locked: boolean }) => {
        if (!this.isHost(client)) return;
        const t = this.state.tables.get(msg?.tableId);
        if (!t) return;
        t.stakesLocked = !!msg.locked;
        this.publishConfig(t);
      },
    );

    this.onMessage(
      C2S.hostSetStakes,
      (client, msg: { tableId: string; minBet: number; maxBet: number }) => {
        if (!this.isHost(client)) return;
        const t = this.state.tables.get(msg?.tableId);
        if (!t || t.stakesLocked) return;
        const min = Math.max(5, Math.floor(msg.minBet));
        const max = Math.max(min, Math.floor(msg.maxBet));
        t.minBet = min;
        t.maxBet = max;
        this.publishConfig(t);
      },
    );

    this.onMessage(
      C2S.hostPauseTable,
      (client, msg: { tableId: string; paused: boolean }) => {
        if (!this.isHost(client)) return;
        const t = this.state.tables.get(msg?.tableId);
        if (!t) return;
        t.paused = !!msg.paused;
        this.publishConfig(t);
      },
    );

    this.onMessage(C2S.hostKick, (client, msg: { sessionId: string }) => {
      if (!this.isHost(client)) return;
      if (!msg?.sessionId || msg.sessionId === client.sessionId) return;
      const target = this.clients.find((c) => c.sessionId === msg.sessionId);
      target?.leave(4000, 'Removed by host');
    });

    this.tick = setInterval(() => this.onTick(), TICK_MS);
  }

  override onJoin(client: Client, opts: { identityId?: string; displayName?: string } = {}) {
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    const isHost = this.state.hostId === client.sessionId;
    const p = new FloorPlayerSchema();
    p.sessionId = client.sessionId;
    p.identityId = opts?.identityId ?? client.sessionId;
    p.displayName = (opts?.displayName ?? 'Guest').slice(0, 24);
    p.host = isHost;
    // Spawn near the entry — bottom-center, randomized a touch to avoid stacking.
    p.x = clamp(50 + (Math.random() - 0.5) * 16, 6, FLOOR_WIDTH - 6);
    p.y = clamp(FLOOR_HEIGHT - 8 + (Math.random() - 0.5) * 4, 4, FLOOR_HEIGHT - 4);
    this.state.players.set(client.sessionId, p);
    this.state.playersOnline = this.clients.length;
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.state.playersOnline = this.clients.length;
    // Host migration — if the host drops, the next-connected player inherits.
    if (this.state.hostId === client.sessionId) {
      const next = this.clients[0];
      this.state.hostId = next?.sessionId ?? '';
      if (next) {
        const p = this.state.players.get(next.sessionId);
        if (p) p.host = true;
      }
    }
  }

  override onDispose() {
    lobbyBus.off('change', this.onRegistryChange);
    if (this.tick) clearInterval(this.tick);
  }

  // ---------- internals ----------

  private isHost(client: Client) {
    return client.sessionId === this.state.hostId;
  }

  private publishConfig(t: FloorTableSchema) {
    setTableConfig({
      tableId: t.tableId,
      minBet: t.minBet,
      maxBet: t.maxBet,
      paused: t.paused,
      stakesLocked: t.stakesLocked,
    });
  }

  private applyStatus(s: TableStatus) {
    const row = this.state.tables.get(s.tableId);
    if (!row) return;
    row.seatsTaken = s.seatsTaken;
    row.inHand = s.inHand;
    row.heat = s.heat;
    row.heatState = s.heatState;
  }

  private onTick() {
    const dt = TICK_MS / 1000;
    const now = Date.now();
    for (const p of this.state.players.values()) {
      // Zero stale input after ~150ms idle — defends against packet drops
      // and against test clients that stop pumping.
      if (now - p.lastMoveAt > 150) {
        p.inX = 0;
        p.inY = 0;
      }
      let dx = p.inX;
      let dy = p.inY;
      // Steer toward tap-to-travel target when no manual input.
      if (p.hasTarget && dx === 0 && dy === 0) {
        const tx = p.targetX - p.x;
        const ty = p.targetY - p.y;
        const dist = Math.hypot(tx, ty);
        if (dist < 0.5) {
          p.hasTarget = false;
          dx = 0;
          dy = 0;
        } else {
          dx = tx / dist;
          dy = ty / dist;
        }
      }
      // Normalize joystick magnitude (so diagonals aren't sqrt(2)× faster).
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      const vx = dx * PLAYER_SPEED;
      const vy = dy * PLAYER_SPEED;
      p.vx = vx;
      p.vy = vy;
      p.x = clamp(p.x + vx * dt, 2, FLOOR_WIDTH - 2);
      p.y = clamp(p.y + vy * dt, 2, FLOOR_HEIGHT - 2);
      if (vx !== 0 || vy !== 0) p.facing = Math.atan2(vy, vx);
    }
  }
}

function clamp(n: number, lo: number, hi: number) {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// Keep the move-send rate constant exported so the client picks the same rate.
export const _moveRate = MOVE_SEND_HZ;
