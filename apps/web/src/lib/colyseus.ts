// Wraps the Colyseus client. The web client only talks to the server through
// this module so all network plumbing lives in one place.

import { Client, Room } from 'colyseus.js';
import { ROOMS } from '@shuffle/shared';

const url = (() => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const explicit = env?.VITE_SERVER_URL;
  if (explicit) return explicit;
  // Default: same host as the web, port 2567. Works on LAN (phones included).
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:2567`;
})();

let client: Client | null = null;

export function getClient(): Client {
  if (!client) client = new Client(url);
  return client;
}

// HTTP base for hitting non-WebSocket Express routes (OG image, health, etc.).
// `url` is a ws[s]:// URL; flip the scheme so an <img src=…> can fetch it.
export function getHttpBase(): string {
  return url.replace(/^wss/, 'https').replace(/^ws/, 'http');
}

// Each room is matched by `lobbyId` server-side via filterBy, so friend
// groups get their own lobby + Blackjack + Craps instances per invite link.
export async function joinLobby(opts: {
  lobbyId: string;
  lobbyName?: string;
  identityId: string;
  displayName: string;
}) {
  return getClient().joinOrCreate(ROOMS.lobby, opts);
}

export async function joinBlackjack(opts: {
  lobbyId: string;
  identityId: string;
  displayName: string;
}): Promise<Room> {
  return getClient().joinOrCreate(ROOMS.blackjack, opts);
}

export async function joinCraps(opts: {
  lobbyId: string;
  identityId: string;
  displayName: string;
}): Promise<Room> {
  return getClient().joinOrCreate(ROOMS.craps, opts);
}

export async function joinHoldem(opts: {
  lobbyId: string;
  identityId: string;
  displayName: string;
}): Promise<Room> {
  return getClient().joinOrCreate(ROOMS.holdem, opts);
}
