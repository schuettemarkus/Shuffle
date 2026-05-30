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

export async function joinLobby() {
  return getClient().joinOrCreate(ROOMS.lobby);
}

export async function joinBlackjack(opts: {
  identityId: string;
  displayName: string;
}): Promise<Room> {
  return getClient().joinOrCreate(ROOMS.blackjack, opts);
}
