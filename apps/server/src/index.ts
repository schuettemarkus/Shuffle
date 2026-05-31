// Shuffle server — Colyseus + Express.
// Lobby room holds the floor directory; one Blackjack room per active table.

import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { BlackjackRoom } from './rooms/BlackjackRoom.js';
import { CrapsRoom } from './rooms/CrapsRoom.js';
import { ROOMS } from '@shuffle/shared';
import { getLiveKitConfig, mintToken, VENUE_ROOM } from './livekit.js';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'shuffle-server' });
});

// LiveKit token vending — clients hit this to join the venue room.
app.post('/livekit/token', async (req, res) => {
  const cfg = getLiveKitConfig();
  if (!cfg.enabled) {
    res.status(503).json({ error: 'LiveKit not configured' });
    return;
  }
  const { identityId, displayName } = (req.body ?? {}) as {
    identityId?: string;
    displayName?: string;
  };
  if (!identityId) {
    res.status(400).json({ error: 'identityId required' });
    return;
  }
  try {
    const token = await mintToken({
      identityId,
      displayName: displayName ?? 'Guest',
    });
    res.json({ token, url: cfg.url, room: VENUE_ROOM });
  } catch (err) {
    console.error('[livekit] token error', err);
    res.status(500).json({ error: 'token-mint failed' });
  }
});

app.use('/colyseus', monitor());

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Every room is multi-instance and matched by `lobbyId`, so friend groups
// get their own lobby + Blackjack + Craps instance per invite link.
gameServer.define(ROOMS.lobby, LobbyRoom).filterBy(['lobbyId']);
gameServer.define(ROOMS.blackjack, BlackjackRoom).filterBy(['lobbyId']);
gameServer.define(ROOMS.craps, CrapsRoom).filterBy(['lobbyId']);

await gameServer.listen(PORT);

const lkCfg = getLiveKitConfig();
console.log(`\n  🎴  Shuffle server listening on ws://localhost:${PORT}`);
console.log(`     • monitor:   http://localhost:${PORT}/colyseus`);
console.log(`     • health:    http://localhost:${PORT}/health`);
console.log(
  `     • livekit:   ${lkCfg.enabled ? lkCfg.url : 'DISABLED (set LIVEKIT_URL/KEY/SECRET)'}\n`,
);
