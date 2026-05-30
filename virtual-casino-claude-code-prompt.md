# Claude Code Build Prompt — "Shuffle": A Browser Multiplayer Virtual Casino

## Mission

Build a browser-based virtual casino that a group of friends can join from a single share URL — no installs. Players appear via webcam, walk around a casino floor, sit down at tables, and play real, fully-functional casino games together using a Bluetooth game controller (with on-screen fallback). The interface should feel as clean and confident as Google Meet, not like a cluttered gambling site. It is play-money / social only.

**Experience bar:** It should feel like dropping into a room with friends, not loading a website. Joining is instant, presence is felt (you hear the table you're standing near), and the games are real enough that someone could genuinely get good at them.

## Product principles (use these to break ties)

1. **Trust first.** All chips, shuffles, and outcomes are computed and validated server-side. The client is never authoritative about anything that affects money or game state.
2. **Presence over realism.** Social presence (spatial audio, instant reactions, seeing faces) matters more than photoreal graphics. Do not let rendering ambition delay the social core.
3. **Inclusive input.** Controller-first, but the app is fully playable with on-screen controls and on a laptop with no controller. A controller is an enhancement, never a requirement.
4. **Meet-grade restraint, sunset-lounge warmth.** Minimal chrome, generous spacing, one clear primary action at a time, smooth transitions — wrapped in a warm, dim, atmospheric "place" rather than a sterile dashboard. See the Design language section.

## Design language ("sunset lounge")

The brand is **Shuffle**: a warm, social place to hang out and play, not a glamorous high-stakes casino. The look is a **dark dusk floor lit by a sunset glow**, with vibrant matte orange as the hero accent and a deep teal felt as its complement. (A visual brand board accompanies this spec — match it.)

- **Hero color:** Sunset `#FF6A3D` — reserved for the single most important action on screen and for hero moments; never spread thin.
- **Sunset ramp** (hero moments, wordmark, Heat Index): Amber `#FFB14E` → Sunset `#FF6A3D` → Rose `#FF5C7A` → Dusk Violet `#7A4FA3`.
- **Surfaces (dark-first):** Dusk Floor `#14101A` (base) · Surface `#211A2B` · Elevated `#352A45`, with low-alpha warm-white borders.
- **Felt:** Teal `#0E5C57` → deep `#093F3C` with a soft inner glow.
- **Text:** Warm ink `#FBF3EB` (primary), muted `#9A8FA3` (secondary).
- **Typography:** Display = **Bricolage Grotesque** (wordmark, headings). UI/body = **Hanken Grotesk**. Avoid generic system fonts.
- **Heat Index hues:** Fire orange-red, Buzzing amber, Cruising teal, Cold icy-blue, Graveyard grey, Rollercoaster magenta, Whale Watch blue, Heater gold.
- **Feel:** atmospheric sunset glow behind the floor, subtle grain, premium soft shadows; the felt and warm faces carry the warmth while the UI chrome stays quiet and dark.

## Recommended tech stack

Use these unless you find a strong, specific reason to deviate — and if you do, propose the swap before making it.

- **Frontend:** React + TypeScript + Vite. Zustand for client state. Tailwind with a small, custom design-token system (don't ship default-looking Tailwind). Start the casino floor as a **stylized 2.5D canvas/DOM scene**; React Three Fiber is the upgrade path for 3D later, not the Phase 1 commitment.
- **Real-time video/audio:** LiveKit (SFU) with spatial/positional audio. Each player publishes a *processed* video track. Use LiveKit Cloud for dev to move fast; keep self-host as an option.
- **Background segmentation:** MediaPipe Selfie Segmentation (or tasks-vision Image Segmenter) running client-side. Composite the segmented head onto the table's themed background on a canvas, then publish that canvas as the video track to LiveKit.
- **Authoritative game/state server:** Colyseus on Node + TypeScript. Model a single **Lobby room** (floor presence, player positions, live table statuses) and one **Table room per active table** (authoritative game state machine, seat management, betting).
- **Persistence:** Postgres + Prisma for guest accounts, chip wallets, and hand history. Redis optional for pub/sub and scale-out.
- **Input:** A `Gamepad API` abstraction layer that normalizes button/stick events, with an on-screen control surface as fallback and haptic (rumble) output.
- **Hosting targets:** Web on Vercel; Colyseus + API on Fly.io / Railway / Render; managed Postgres; LiveKit Cloud or self-host.

## Architecture overview

- **Lobby room:** holds every connected player's position on the floor and a live directory of tables (game type, stakes, seats taken/open, in-hand status).
- **Table rooms:** each is an authoritative finite state machine for one game. Owns the deck, the pot, seat assignments, turn order, betting timers, and chip movements. Validates every action.
- **Spatial layer:** map player floor positions to LiveKit positional audio so volume falls off with distance; "sitting" at a table snaps you into that table's audio zone.
- **Wallet service:** chips are debited on buy-in and credited on cash-out. Every bet is validated against the server-held balance. Clients only ever *request* actions.

## The 10 must-have features

Implement these across the phases below. Each has acceptance criteria.

1. **Server-authoritative game engine + provably-fair RNG.** All card/chip/outcome logic on the server. Shuffles use a commit-reveal scheme (server commits a hashed seed before the hand, reveals after) so players can verify nothing was rigged. *Done when:* a tampered client cannot alter an outcome, and a hand's fairness can be verified from the reveal.

2. **Spatial audio + floor presence.** As you move around the floor, you hear nearby players/tables louder and distant ones faint. Sitting at a table puts you in that table's clear audio zone. *Done when:* two players at different tables can't hear each other clearly, but tablemates can.

3. **Persistent chip wallet + cashier/buy-in system.** Per-player chip balances persist across sessions. Host sets buy-in amounts, rebuys, and per-table limits; a "cage"/cashier handles converting balance ↔ table stack. *Done when:* a player can buy in, leave a table with their stack, and rejoin later with the right balance.

4. **Host & dealer controls (room governance).** The URL creator is host: set/lock stakes, open/close tables, mute, remove a player, pause a table. Mirrors Google Meet's host model. *Done when:* host actions take effect for everyone in real time.

5. **Graceful reconnection + seat persistence.** Network drops, tab closes, or controller disconnects don't forfeit your seat or chips within a grace window; sit-out timers auto-fold/skip if you're gone too long. *Done when:* a mid-hand disconnect-and-rejoin keeps the seat and stack intact and resumes cleanly.

6. **Universal input layer (controller + on-screen + haptics).** Gamepad API mapping (e.g. stick = move/aim bet, A = call/check, B = fold, triggers = raise) with an always-available on-screen control surface and rumble feedback on your turn / on a win. *Done when:* the full game is playable with a controller, with a mouse, and on a phone.

7. **Real table UX (seats, turn clock, dealer button, bet slider, animated chips).** Clear seat slots, an obvious "it's your turn" state with a countdown, rotating dealer button, a satisfying bet/raise control, animated chip movement and pot collection, side-pot handling. *Done when:* a stranger can sit down and understand whose turn it is and what to do without instructions.

8. **Themed-background voting + live segmentation.** A gallery of table themes (e.g. Vegas high-roller, speakeasy, beach club, neon cyber). Tablemates vote; the winning backdrop becomes the composited background behind every seated player's segmented head. *Done when:* a vote resolves live and all seated players' backgrounds update together.

9. **Lobby map / table browser with live status.** A clean overview of the floor: what's running, stakes, open seats, who's seated. Walk over or teleport to a table; spectate before sitting. *Done when:* a new joiner can find and join an open seat in under ~15 seconds.

10. **Social layer (reactions, chip-toss emotes, table chat, hand history).** Controller-mapped emotes and a "toss a chip" gesture, quick table chat, and a replayable hand history for bragging rights and dispute resolution. *Done when:* players can react in real time and review the last hand.

11. **The Heat Index — a live "vibe meter" on every table.** A custom 0–100 score (spec below) that reads each table's energy and renders it as an animated, glanceable badge on the floor and in the table browser, plus a "Hottest tables" sort and a floor-wide pulse pointing to where the action is. *Done when:* a player can tell from the lobby which table is on fire vs. dead, and the score visibly moves as hands play out.

## The Heat Index algorithm (feature 11, in detail)

Every active table gets a live **Heat Index from 0–100**, recomputed each tick (~1–2s) over a rolling window (~the last 6 minutes) with **exponential time decay** so recent events dominate and heat naturally cools when action stalls. Each event/measurement is weighted by `e^(−Δt/τ)` with `τ ≈ 90s`.

It is computed from six components, each normalized to 0–1, then combined with weights that sum to 1:

| Component | Symbol | What it measures | How to derive it | Weight |
|---|---|---|---|---|
| Action Intensity | A | How much is being risked | Total wagered per minute, expressed in big-blinds/min, squashed (e.g. `tanh`) so it caps | 0.22 |
| Pot Drama | P | Size and tension of pots | Avg pot ÷ stakes, boosted by all-ins and showdowns in the window | 0.20 |
| Volatility | V | How fast fortunes change | Variance of per-player stack deltas over the window | 0.18 |
| Occupancy & Flow | O | Is the table alive? | Seats filled ratio × recency-of-last-action (staleness kills it) | 0.18 |
| Social Energy | S | Table buzz | Emotes + chip-tosses + chat + reactions per minute (voice-activity optional/opt-in) | 0.12 |
| Streak Narrative | K | Is someone on a heater? | Bonus that grows with the longest current win streak at the table | 0.10 |

`Heat = 100 × (0.22·A + 0.20·P + 0.18·V + 0.18·O + 0.12·S + 0.10·K)`

On top of the scalar score, run a few **overlay detectors** that produce a named vibe state and special badges (these are orthogonal flags, not just bands of the score):

- 🔥 **On Fire** — Heat ≥ 75. Flickering flame badge, warm glow on the table.
- ⚡ **Buzzing** — Heat 55–74. Full, fast, social.
- 😎 **Cruising** — Heat 35–54. Steady, balanced play.
- 🧊 **Cold** — Heat 15–34. Quiet, slow, frosted badge.
- 💀 **Graveyard** — occupancy below threshold **or** no action for N minutes → forces cold regardless of other signals.
- 🎢 **Rollercoaster** — V above a high threshold even at moderate Heat (wild swings).
- 🐳 **Whale Watch** — one stack ≥ ~3× the next biggest; flags a big fish at the table.
- 🍀 **Heater** — a player has won ≥3 hands in a row; surfaces their name as a story hook.

Implementation notes: compute it **server-side** in the Lobby room from table-derived game events only (no surveillance of faces/audio content; voice activity, if used, is a simple opt-in volume gate). Broadcast each table's `{ heat, state, badges }` to the lobby so the floor and browser update live. Keep all weights/thresholds in one config object so they're easy to tune — these are starting values, not gospel. Consider a tiny bit of smoothing on the displayed number so the badge doesn't jitter every tick.

## Mobile — condensed but complete

Build responsive from day one; do not bolt mobile on at the end. The phone layout shows everything the desktop does, just denser and reflowed for a thumb.

- **Layout.** On phone, the table is the hero: dealer/board and the player's own hand and chips are always visible, with other players as a **swipeable/scrollable filmstrip of small video tiles** above or beside the felt. A tap on any tile expands it. Active-player and "it's your turn" states get a clear, large highlight so you never lose the thread on a small screen. Landscape gives more felt; portrait works for lobby browsing and quick play.
- **Input.** On mobile, the **on-screen control surface is the primary input** — large, thumb-reachable tap targets for check/call/fold/raise, a draggable bet slider, and a long-press for chip-toss/emotes. Bluetooth controllers still work on mobile via the Gamepad API as an enhancement. Use the Vibration API for haptics (your turn, win, chip toss).
- **Navigation.** Replace analog "walking" with **tap-to-travel**: the lobby/table browser is the main floor view on mobile, and tapping a table walks you there (with an optional simplified joystick for players who want to roam). The Heat Index badges make this browser genuinely useful on a small screen.
- **Performance & bandwidth.** Segmentation and many video tiles are expensive on phones. Run **lower-resolution segmentation at a capped frame rate**, let users turn the background effect off, use LiveKit **simulcast/adaptive layers** to pull low-res tiles on mobile, cap the number of simultaneously decoded videos (others paused as static avatars until tapped), and offer a one-tap **video-off / low-bandwidth mode**.
- **App-like polish.** Ship as an installable **PWA** (add-to-home-screen, splash, offline shell), respect safe-area insets/notches, and use bottom-sheet patterns for chips/themes/chat so the felt stays unobstructed.

## Theme gallery (feature 8, in detail)

The themed-background gallery is organized into categories so the table-vote UI can browse by mood. Ship a starter set; the system should make adding more a matter of dropping in an asset + metadata. A few backdrops should be **animated/live** (marked ✦) as a polish moment, and **Birthday/celebration themes carry an editable banner** (e.g. a name) the table can fill in.

- **Beaches & water** — Tropical Beach, Sunset Tiki Bar, Yacht Deck, Underwater Reef ✦
- **Mountains & nature** — Alpine Lodge, Forest Cabin, Desert Mesa, Northern Lights ✦
- **Cities & skylines** — Vegas Strip at Night ✦, Tokyo Neon, NYC Rooftop, Paris Café
- **Exotic / travel** — Moroccan Riad, Santorini, Safari Lodge, Bali Temple
- **Funny places** — "Definitely Working" Office Cubicle, Grandma's Living Room, Dive Bar, Blanket Pillow Fort
- **Unreal / fantasy** — Space Station, Cloud Kingdom, Neon Cyber-Grid ✦, Volcano Lair, Underwater City
- **Holidays** — Winter Wonderland, Spooky Halloween, New Year's Countdown ✦ (fireworks), Lunar New Year
- **Celebrations** — Birthday (editable name banner) ✦, Bachelor/ette, Graduation, Game Night

## Default controller mapping (feature 6, recommended)

Standard Xbox-style layout (PlayStation equivalents in parentheses). The mapping is **context-sensitive** — the same buttons mean different things on the floor vs. at a table — and the on-screen control surface mirrors it 1:1 for no-controller and mobile play. Haptics: single rumble when it becomes your turn, double-pulse on a win, short tick on chip-toss.

**On the floor / lobby**
- Left stick — move around the floor
- Right stick — look / pan camera
- A (✕) — sit / join the nearest table or open seat
- B (○) — stand / leave / back
- Y (△) — open table browser & Heat Index map
- X (□) — toggle mic
- D-pad — quick emotes
- Menu (Options) — settings / host panel

**At a table (general)**
- A (✕) — Check / Call (label shows which applies)
- B (○) — Fold
- X (□) — Bet / Raise (enters bet-sizing mode)
- LB / RB (L1 / R1) — cycle preset bet sizes: min → ½ pot → pot → 2× → all-in
- LT / RT (L2 / R2) — fine-tune bet amount down / up
- A (✕) — confirm the bet/raise while sizing
- R3 (R3) — toss a chip
- D-pad — emotes (↑ cheers, ↓ facepalm, ← clap, → taunt)
- View (Share) — show last hand / hand history
- Menu (Options) — leave table / settings

**Blackjack overrides**
- A (✕) — Hit · B (○) — Stand · X (□) — Double · Y (△) — Split · LB/RB — adjust bet before the deal

## Build in phases — ship a working vertical slice first

Do **not** attempt to build everything at once. Each phase must end in something runnable and demoable.

- **Phase 0 — Scaffold & plan.** Set up the monorepo (web / server / shared types), linting, and CI. Propose the full plan and a Phase 1 task checklist before writing feature code.
- **Phase 1 — Vertical slice (the proof).** One lobby + **one Blackjack table** (chosen first because it's the easiest game to make provably correct: player-vs-dealer, simple decision tree). Guest join via room URL; basic webcam tiles (no segmentation yet); controller + on-screen input; **server-authoritative Blackjack**; chip wallet with buy-in; graceful reconnection. **Responsive from this phase on — the slice must be playable on a phone, not just desktop.** This single slice exercises the entire stack end to end.
- **Phase 2 — Presence & polish.** Stylized 2.5D floor, walking between tables (tap-to-travel on mobile), spatial audio, Meet-grade UI pass, host controls.
- **Phase 3 — Identity & theming.** MediaPipe background segmentation (with mobile-grade low-res/capped-FPS path) + themed-background voting.
- **Phase 4 — Depth.** Add **Texas Hold'em** (the iconic friends-vs-each-other game) with side pots, the full social layer (emotes, chip toss, chat, hand history), the provably-fair commit-reveal RNG, and the **Heat Index** vibe meter across the lobby and floor.
- **Phase 5 — Hardening.** Anti-cheat audit, load test with simulated players, PWA install + low-bandwidth/video-off mode, mobile performance tuning, and an accessibility pass.

## Non-negotiables / constraints

- All money and card logic is server-side. Never trust the client for anything that changes state.
- Provably-fair shuffle via commit-reveal seed on every hand.
- Reconnection within the grace window must preserve seat and stack.
- **Mobile is a first-class platform, not a degrade.** The full experience must be playable on a phone — every game, video, chips, themes, and the Heat Index — in a condensed-but-complete layout (see the Mobile section). It must also work on machines without a controller or camera.
- **Play-money / social only.** Real-money gambling carries heavy, jurisdiction-specific licensing and legal requirements and is explicitly out of scope. Keep everything to friends and play chips, and surface a clear note in-product to that effect.

## Your first actions

1. Ask me any blocking questions first — at minimum: confirmation it's play-money only, target max players per table, and hosting preferences. (Name is locked: **Shuffle**.)
2. Propose the repo structure and a concrete Phase 1 plan with a task checklist.
3. Scaffold the monorepo and get the Phase 1 vertical slice running locally, with clear instructions to run it.

Then proceed phase by phase, keeping every phase shippable, and check in at the end of each phase before moving on.
