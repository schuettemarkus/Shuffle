// Shuffle server — Colyseus + Express.
// Lobby room holds the floor directory; one Blackjack room per active table.

import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { BlackjackRoom } from './rooms/BlackjackRoom.js';
import { ROOMS } from '@shuffle/shared';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'shuffle-server' });
});

app.use('/colyseus', monitor());

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOMS.lobby, LobbyRoom);
gameServer.define(ROOMS.blackjack, BlackjackRoom);

await gameServer.listen(PORT);

console.log(`\n  🎴  Shuffle server listening on ws://localhost:${PORT}`);
console.log(`     • monitor:   http://localhost:${PORT}/colyseus`);
console.log(`     • health:    http://localhost:${PORT}/health\n`);
