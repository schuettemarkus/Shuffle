// Cross-room registry: BlackjackRoom writes its live status here on every
// material change, and LobbyRoom reads it on a tick. Both rooms run in the
// same Node process so an in-memory store is sufficient for Phase 1; Phase 5
// hardening will swap this for Redis pub/sub.

import { EventEmitter } from 'node:events';

export interface TableStatus {
  tableId: string;
  seatsTaken: number;
  maxSeats: number;
  inHand: boolean;
  heat: number;
  heatState: string;
}

const statuses = new Map<string, TableStatus>();
export const lobbyBus = new EventEmitter();

export function publishStatus(s: TableStatus) {
  const prev = statuses.get(s.tableId);
  if (
    prev &&
    prev.seatsTaken === s.seatsTaken &&
    prev.inHand === s.inHand &&
    prev.heat === s.heat &&
    prev.heatState === s.heatState
  ) {
    return;
  }
  statuses.set(s.tableId, s);
  lobbyBus.emit('change', s);
}

export function getStatus(tableId: string): TableStatus | undefined {
  return statuses.get(tableId);
}

export function allStatuses(): TableStatus[] {
  return Array.from(statuses.values());
}

// ---------- table config (host-controlled stakes, pause, lock) ----------

export interface TableConfig {
  tableId: string;
  minBet: number;
  maxBet: number;
  paused: boolean;
  stakesLocked: boolean;
}

const configs = new Map<string, TableConfig>();
export const configBus = new EventEmitter();

export function setTableConfig(c: TableConfig) {
  const prev = configs.get(c.tableId);
  if (
    prev &&
    prev.minBet === c.minBet &&
    prev.maxBet === c.maxBet &&
    prev.paused === c.paused &&
    prev.stakesLocked === c.stakesLocked
  ) {
    return;
  }
  configs.set(c.tableId, c);
  configBus.emit('change', c);
}

export function getTableConfig(tableId: string): TableConfig | undefined {
  return configs.get(tableId);
}
