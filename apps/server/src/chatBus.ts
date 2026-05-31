// Lobby-scoped chat fan-out.
//
// Every Colyseus room (LobbyRoom + the game rooms) shares a single chat
// stream per `lobbyId`, so a friend group sees the same conversation whether
// they're at Blackjack, Craps, Hold'em, or still picking a game. Rooms write
// to `postChat(lobbyId, msg)` and subscribe to the bus to receive every other
// room's messages.
//
// Phase 1 keeps the buffer in-memory (per server process). Phase 5 will swap
// this for Redis pub/sub so chat survives multi-node deploys + restarts.

import { EventEmitter } from 'node:events';
import type { ChatMessage } from '@shuffle/shared';

const HISTORY_CAP = 200;

const histories = new Map<string, ChatMessage[]>();
export const chatBus = new EventEmitter();

export interface ChatEvent {
  lobbyId: string;
  msg: ChatMessage;
}

export function postChat(lobbyId: string, msg: ChatMessage) {
  let hist = histories.get(lobbyId);
  if (!hist) {
    hist = [];
    histories.set(lobbyId, hist);
  }
  // Dedupe by id in case the same message is posted twice during a relay.
  if (hist.some((m) => m.id === msg.id)) return;
  hist.push(msg);
  while (hist.length > HISTORY_CAP) hist.shift();
  chatBus.emit('message', { lobbyId, msg } as ChatEvent);
}

export function getChatHistory(lobbyId: string): ChatMessage[] {
  return histories.get(lobbyId) ?? [];
}
