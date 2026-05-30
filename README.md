# Shuffle

A browser multiplayer virtual casino. Drop a URL in a group chat, friends pull
up chairs around a felt, and you play real, fully-functional casino games
together — controller or thumbs, webcam or not, laptop or phone.

> **Play-money / social only.** Shuffle ships with virtual chips. No real-money
> wagering, no cash-out, no crypto. Friends + chips + a hand of cards.

## Phase 1 vertical slice (what's in this repo today)

- **One Blackjack table**, end-to-end, server-authoritative.
- **Guest join via room URL** — paste the link, pick a name, sit down.
- **Universal input** — Bluetooth Xbox/PS controller via the Gamepad API, with
  a 1:1 on-screen control surface for laptops and phones.
- **Chip wallet** — persistent per-guest balance, buy-in / cash-out at the cage.
- **Graceful reconnection** — disconnect mid-hand, rejoin within the grace
  window, keep your seat and your stack.
- **Webcam tiles** with a quiet, opt-in fallback when no camera is granted.
- **Responsive from day one** — desktop and mobile both first-class.
- **Sunset-lounge brand** — Bricolage Grotesque + Hanken Grotesk, sunset
  gradient hero, deep teal felt, warm dusk surfaces. Matches `shuffle-brand-board.html`.

Later phases (presence + spatial audio, segmentation, Texas Hold'em, the Heat
Index) are scoped in the spec at `virtual-casino-claude-code-prompt.md` and
will land phase by phase.

## Stack

- **Monorepo** — pnpm workspaces.
- **Web** — React + TypeScript + Vite, Tailwind with custom design tokens,
  Zustand for client state.
- **Server** — Colyseus on Node + TypeScript. Authoritative finite-state
  machine per table. In-memory wallet for Phase 1 (Postgres + Prisma lands in
  Phase 3 alongside guest accounts).
- **Shared** — `@shuffle/shared` exports the wire protocol, brand tokens, and
  game-state types both sides import.

## Run it locally

```bash
pnpm install
pnpm dev
```

That boots two processes:

- `apps/server` on `ws://localhost:2567` (Colyseus + monitor at `/colyseus`)
- `apps/web` on `http://localhost:5173`

Open the web URL in two browsers / two devices on your network. Both land in
the lobby, both can sit down at the table, both deal.

### LiveKit (audio + video at the table)

The table experience uses LiveKit for real-time audio and video. Without
credentials the app still runs — you'll see avatar tiles and play normally —
but voice + camera tiles across players require a LiveKit project.

1. Sign up at https://cloud.livekit.io (free tier is plenty).
2. Create a project and copy the API key, secret, and websocket URL.
3. Create `apps/server/.env` based on `apps/server/.env.example`:
   ```
   LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   PORT=2567
   ```
4. Restart the server. The boot log shows whether LiveKit is enabled.

The server mints short-lived JWT tokens at `POST /livekit/token`; the client
fetches one and joins a single venue room. Spatial audio per table is the
next step — the seat-position stream is already wired into the audio
context's `PannerNode` graph.

## Repo layout

```
apps/
  web/        React + Vite client
  server/     Colyseus game server
packages/
  shared/     Wire protocol, game types, brand tokens
```

## Non-negotiables (from the spec)

1. All money and card logic is server-side. The client *requests* actions; the
   server is the single source of truth.
2. Provably-fair shuffle via commit-reveal seed every hand (Phase 4 hardens
   this; Phase 1 ships the commit-reveal scaffolding for Blackjack).
3. Reconnection within the grace window preserves seat and stack.
4. Mobile is first-class, not a degrade.
5. Play-money only — surfaced clearly in product.

## Brand reference

See `shuffle-brand-board.html` (open it in a browser) for the canonical sunset
palette, typography, components, Heat Index hues, and lobby card direction.
The web client's design tokens are sourced directly from it.
