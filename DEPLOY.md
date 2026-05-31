# Deploying Shuffle

This walks you from a fresh laptop to a live, share-with-friends URL in about
20 minutes. Cost target: **$0 for the first ~2 months** of casual testing.

## What you'll end up with

- **Web client** on Vercel — `https://shuffle-<you>.vercel.app`
- **Game server** on Fly.io — `https://shuffle-server.fly.dev`
- **Voice / video** via LiveKit Cloud — free tier, 50 GB/mo bandwidth

---

## 1. LiveKit Cloud (free)

1. Sign up at [cloud.livekit.io](https://cloud.livekit.io) (no credit card).
2. Create a project. Note the **server URL** (looks like
   `wss://my-project-xyz.livekit.cloud`).
3. **Settings → Keys → Add Key**. Copy the **API Key** and **Secret**.

Keep these three values handy — you'll paste them into Fly secrets in step 3.

---

## 2. Deploy the game server to Fly.io

Fly.io's $5 trial credit covers ~2 months of running a `shared-cpu-1x@256MB`
machine always-on. After that it's roughly $2/mo, or flip
`auto_stop_machines = "stop"` in `fly.toml` for $0-when-idle (cold-start cuts
in-progress hands, so only do that for solo testing).

```bash
# Install once, from the repo root:
brew install flyctl
fly auth signup    # or `fly auth login` if you already have an account

# From the repo root (this is important — the Dockerfile copies from here):
fly launch --no-deploy --name shuffle-server --copy-config
```

The launcher will see the existing `fly.toml` and use it. Confirm the region
and skip the Postgres / Redis prompts.

Now create the persistent volume (the leaderboard JSON lives here):

```bash
fly volumes create shuffle_data --size 1 --region iad
```

Set your secrets:

```bash
fly secrets set \
  LIVEKIT_URL=wss://your-project.livekit.cloud \
  LIVEKIT_API_KEY=APIxxxxxxxxxx \
  LIVEKIT_API_SECRET=secretxxxxxxxxxx \
  CORS_ORIGINS=https://YOUR_VERCEL_DOMAIN.vercel.app
```

(You don't know the Vercel domain yet — leave `CORS_ORIGINS` for now, the dev
fallback accepts anything from a `*.vercel.app` URL temporarily because the
regex matches IP/localhost only. Set it after step 3.)

Deploy:

```bash
fly deploy
```

When it's up, hit `https://shuffle-server.fly.dev/health` — you should see
`{"ok":true,"name":"shuffle-server"}`. The WebSocket endpoint is
`wss://shuffle-server.fly.dev`.

---

## 3. Deploy the web client to Vercel

```bash
# From the repo root
npm i -g vercel
vercel link
```

Pick "Other" as the framework when prompted, then **edit the project's
Root Directory to `apps/web`** in the Vercel dashboard (or pass `--cwd apps/web`).
The `apps/web/vercel.json` already wires the monorepo install + build.

Set the server URL as an environment variable in Vercel:

- **Project Settings → Environment Variables**
- `VITE_SERVER_URL` = `wss://shuffle-server.fly.dev`
- Scope: Production + Preview + Development

Then deploy:

```bash
cd apps/web && vercel --prod
```

Copy the resulting URL.

---

## 4. Lock the server's CORS to your Vercel domain

Back in the repo root:

```bash
fly secrets set CORS_ORIGINS=https://shuffle-<you>.vercel.app
```

Fly will restart the machine. Re-test the live URL — open it in two browsers
on different networks and confirm video + chat + a Blackjack hand all work.

---

## 5. Share

The Vercel URL is your invite-able link. Hit "+ New lobby" to mint a fresh
lobbyId; the URL with `?lobby=…` is what you share with friends.

---

## Troubleshooting

- **"CORS blocked for origin …"** in Fly logs → your Vercel domain isn't in
  `CORS_ORIGINS`. Update the secret and `fly deploy` to restart.
- **LiveKit "token fetch failed"** → check the three `LIVEKIT_*` secrets are
  set on Fly. `fly logs` will show `[livekit] DISABLED` if any are missing.
- **Game freezes after a few minutes** → Fly machine auto-stopped. Confirm
  `auto_stop_machines = "off"` and `min_machines_running = 1` in `fly.toml`.
- **Cold start on first connect** → expected on `auto_stop = "stop"` mode.
  Flip to `"off"` for testing with friends.

---

## Alternative free hosts

If you exhaust the Fly trial and don't want to pay:

- **Koyeb** (free tier, 1 web service, 512MB) — supports WebSocket, sleeps
  after ~1h idle. Dockerfile is reusable.
- **Railway** ($5/mo trial credit, then paid) — easiest UX, same Dockerfile.
- **Self-host on Oracle Cloud Always Free** — 4 ARM cores / 24 GB RAM truly
  free forever, but you'll need to set up Caddy/Nginx + TLS yourself.

Render's free tier sleeps after **15 minutes** of inactivity, which kills
in-progress hands. Don't use it for Shuffle.
