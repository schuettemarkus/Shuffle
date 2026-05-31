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
import { HoldemRoom } from './rooms/HoldemRoom.js';
import { ROOMS } from '@shuffle/shared';
import { getLiveKitConfig, mintToken, VENUE_ROOM } from './livekit.js';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
// Lock CORS to a known list. Set CORS_ORIGINS=https://shuffle.example.com,…
// in prod; falls back to localhost / LAN dev origins so phones can still join
// over the dev network.
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // server-to-server / curl
      if (allowedOrigins.length && allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      // Dev fallback: localhost / LAN-IP origins on the Vite dev port.
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS blocked for origin ${origin}`));
    },
  }),
);
app.use(express.json({ limit: '8kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'shuffle-server' });
});

// Dynamic invite preview — rasterizable SVG with the lobby name baked into
// the gold ribbon plus initials chips for the most-active players. Used by
// the ShareInvitePanel preview card and (eventually) per-lobby OG images.
app.get('/og.svg', (req, res) => {
  const lobbyId = (req.query.lobby as string | undefined)?.toString() ?? '';
  // Lazy-load to avoid a circular import at module init.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  import('./leaderboard.js').then(({ allFor }) => {
    const entries = allFor(lobbyId)
      .sort((a, b) => b.chipDelta - a.chipDelta)
      .slice(0, 6);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(renderInviteSvg({ lobbyId, lobbyName: lobbyId, players: entries }));
  }).catch(() => res.status(500).end());
});

interface InvitePlayer {
  displayName: string;
}

function renderInviteSvg({
  lobbyName,
  players,
}: {
  lobbyId: string;
  lobbyName: string;
  players: InvitePlayer[];
}): string {
  const title = (lobbyName || 'Shuffle').toUpperCase();
  const longTitle = title.length >= 8;
  const size = longTitle ? 80 : 96;
  // Avatar circle initials for up to 6 recent players, laid out across the top.
  const avatars = players.slice(0, 6).map((p, i) => {
    const initials = p.displayName
      .trim()
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '·';
    const x = 240 + (i - (players.length - 1) / 2) * 120;
    const hue = (i * 53 + 18) % 360;
    return `
      <g transform="translate(${x} 220)">
        <circle r="44" fill="hsl(${hue} 60% 30%)" stroke="#FBF3EB" stroke-width="3"/>
        <text x="0" y="14" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif"
              font-weight="900" font-size="34" fill="#FBF3EB">${escapeXml(initials)}</text>
      </g>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="120%">
      <stop offset="0%" stop-color="#352A45"/>
      <stop offset="55%" stop-color="#1A1422"/>
      <stop offset="100%" stop-color="#070310"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="22%" r="60%">
      <stop offset="0%" stop-color="rgba(255,106,61,.55)"/>
      <stop offset="60%" stop-color="rgba(255,92,122,.2)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="ribbon" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFF3C8"/>
      <stop offset="18%" stop-color="#FFE08A"/>
      <stop offset="48%" stop-color="#FFB14E"/>
      <stop offset="78%" stop-color="#A36818"/>
      <stop offset="100%" stop-color="#5A3A0E"/>
    </linearGradient>
    <linearGradient id="ribbonFold" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#A06B1F"/>
      <stop offset="100%" stop-color="#3A2410"/>
    </linearGradient>
    <linearGradient id="wordmark" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFB14E"/>
      <stop offset="40%" stop-color="#FF6A3D"/>
      <stop offset="80%" stop-color="#FF5C7A"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-opacity=".55"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <text x="600" y="120" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif"
        font-weight="800" font-size="80" letter-spacing="-3" fill="url(#wordmark)">shuffle<tspan fill="#FF6A3D">.</tspan></text>
  ${avatars}
  <g filter="url(#softShadow)">
    <path d="M 60 410 L 165 370 L 195 440 L 90 480 Z" fill="url(#ribbonFold)"/>
    <path d="M 1140 410 L 1035 370 L 1005 440 L 1110 480 Z" fill="url(#ribbonFold)"/>
    <path d="M 100 380 Q 600 315 1100 380 L 1100 480 Q 600 415 100 480 Z" fill="url(#ribbon)" stroke="#3a2412" stroke-width="3"/>
    <text x="600" y="452" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif"
          font-weight="900" font-size="${size}" letter-spacing="6" fill="#14101A">${escapeXml(title)}</text>
  </g>
  <text x="600" y="560" text-anchor="middle" font-family="Hanken Grotesk, sans-serif"
        font-weight="600" font-size="22" letter-spacing="4" fill="rgba(255,228,210,.85)">
    ${players.length === 0 ? 'PULL UP A CHAIR' : `${players.length} ${players.length === 1 ? 'PLAYER' : 'PLAYERS'} INSIDE`}
  </text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => (
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '&' ? '&amp;' :
    c === "'" ? '&apos;' :
    '&quot;'
  ));
}

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
gameServer.define(ROOMS.holdem, HoldemRoom).filterBy(['lobbyId']);

await gameServer.listen(PORT);

const lkCfg = getLiveKitConfig();
console.log(`\n  🎴  Shuffle server listening on ws://localhost:${PORT}`);
console.log(`     • monitor:   http://localhost:${PORT}/colyseus`);
console.log(`     • health:    http://localhost:${PORT}/health`);
console.log(
  `     • livekit:   ${lkCfg.enabled ? lkCfg.url : 'DISABLED (set LIVEKIT_URL/KEY/SECRET)'}\n`,
);
