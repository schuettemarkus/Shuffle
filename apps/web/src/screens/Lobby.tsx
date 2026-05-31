// Lobby — a calm, inviting "front door" to the floor.
//
// Hero first (Shuffle wordmark + lobby name + Invite Friends CTA), then the
// game tiles. The lobby is the named friend-group container; tables inside
// are generic ("Blackjack", "Craps") and inherit the social context from the
// lobby they live in.

import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S } from '@shuffle/shared';
import { useStore } from '../lib/store';
import { joinLobby, joinBlackjack, joinCraps } from '../lib/colyseus';
import { ShareInvitePanel } from '../components/ShareInvitePanel';

interface LobbyTableRow {
  tableId: string;
  name: string;
  game: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatsTaken: number;
  inHand: boolean;
  heat: number;
  heatState: string;
}

export function Lobby() {
  const myDisplayName = useStore((s) => s.myDisplayName);
  const myIdentityId = useStore((s) => s.myIdentityId);
  const setLobbyRoom = useStore((s) => s.setLobbyRoom);
  const setTableRoom = useStore((s) => s.setTableRoom);
  const setCrapsRoom = useStore((s) => s.setCrapsRoom);
  const setView = useStore((s) => s.setView);
  const pushToast = useStore((s) => s.pushToast);
  const currentLobbyId = useStore((s) => s.currentLobbyId);
  const lobbyName = useStore((s) => s.lobbyName);
  const lobbyHostId = useStore((s) => s.lobbyHostId);
  const setLobbyName = useStore((s) => s.setLobbyName);
  const setLobbyHostId = useStore((s) => s.setLobbyHostId);
  const [tables, setTables] = useState<LobbyTableRow[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [playersOnline, setPlayersOnline] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const tablesRef = useRef<HTMLDivElement>(null);
  // The connected lobby room — kept in a ref so the rename handler can send
  // a server message without re-subscribing on every render.
  const lobbyRoomRef = useRef<Room | null>(null);
  // The sessionId we hold in *this* lobby — used to know whether we're host.
  const [mySession, setMySession] = useState<string | null>(null);

  useEffect(() => {
    if (!currentLobbyId) return;
    let room: Room | null = null;
    let cancelled = false;
    (async () => {
      try {
        room = await joinLobby({
          lobbyId: currentLobbyId,
          identityId: myIdentityId,
          displayName: myDisplayName || 'Guest',
        });
        if (cancelled) {
          room.leave();
          return;
        }
        lobbyRoomRef.current = room;
        setLobbyRoom(room);
        setMySession(room.sessionId);
        const sync = () => {
          const t = room!.state as unknown as {
            tables: Map<string, LobbyTableRow>;
            playersOnline?: number;
            name?: string;
            hostId?: string;
          };
          setTables(Array.from(t.tables.values()).map((r) => ({ ...r })));
          setPlayersOnline(t.playersOnline ?? 0);
          if (t.name) setLobbyName(t.name);
          if (t.hostId !== undefined) setLobbyHostId(t.hostId);
        };
        room.onStateChange(sync);
        sync();
      } catch (err) {
        pushToast({ kind: 'error', text: 'Could not reach the lobby.' });
        console.warn(err);
      }
    })();
    return () => {
      cancelled = true;
      if (room) {
        room.leave();
        setLobbyRoom(null);
      }
      lobbyRoomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLobbyId]);

  const isHost = !!mySession && mySession === lobbyHostId;

  const renameLobby = (name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    lobbyRoomRef.current?.send(C2S.lobbySetName, { name: trimmed });
  };

  const enterTable = async (row: LobbyTableRow) => {
    if (joining) return;
    setJoining(row.tableId);
    try {
      if (row.game === 'craps') {
        const r = await joinCraps({
          lobbyId: currentLobbyId,
          identityId: myIdentityId,
          displayName: myDisplayName || 'Guest',
        });
        setCrapsRoom(r, r.sessionId);
        setView('craps');
        return;
      }
      const r = await joinBlackjack({
        lobbyId: currentLobbyId,
        identityId: myIdentityId,
        displayName: myDisplayName || 'Guest',
      });
      setTableRoom(r, r.sessionId);
      setView('table');
    } catch (e) {
      pushToast({ kind: 'error', text: 'Could not join that table.' });
      console.warn(e);
    } finally {
      setJoining(null);
    }
  };

  const scrollToTables = () => {
    tablesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pb-32 pt-6 sm:pt-10">
      <Hero
        name={myDisplayName || 'friend'}
        playersOnline={playersOnline}
        lobbyName={lobbyName}
        isHost={isHost}
        onInvite={() => setShareOpen(true)}
        onRename={renameLobby}
        onScroll={scrollToTables}
      />

      <div
        ref={tablesRef}
        className="mt-12 flex items-end justify-between sm:mt-16"
      >
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          Pick a game
        </h2>
        <p className="hidden text-right text-xs text-ink-mute sm:block">
          play-money chips on the house · {tables.length} {tables.length === 1 ? 'game' : 'games'} ready
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <TableCard
            key={t.tableId}
            t={t}
            onJoin={() => enterTable(t)}
            joining={joining === t.tableId}
          />
        ))}
        <ComingSoonCard kind="holdem" />
      </div>

      <footer className="mt-12 text-center text-[10px] uppercase tracking-[0.32em] text-ink-mute/70">
        play-money · social only
      </footer>

      {shareOpen && (
        <ShareInvitePanel
          lobbyName={lobbyName}
          lobbyId={currentLobbyId}
          seatsOpen={tables.reduce((sum, t) => sum + (t.maxSeats - t.seatsTaken), 0)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

function Hero({
  name,
  playersOnline,
  lobbyName,
  isHost,
  onInvite,
  onRename,
  onScroll,
}: {
  name: string;
  playersOnline: number;
  lobbyName: string;
  isHost: boolean;
  onInvite: () => void;
  onRename: (n: string) => void;
  onScroll: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#1A1422] via-[#211A2B] to-[#0F0915] px-6 py-10 shadow-brand sm:px-12 sm:py-14">
      {/* Sunset wash behind the wordmark. */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[120%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,106,61,.45),rgba(255,92,122,.25)_45%,transparent_75%)] blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 right-[-10%] h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(43,184,158,.35),transparent)] blur-2xl" />

      <div className="relative flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-sunset">
            Welcome back, {name}
          </p>
          <h1 className="wordmark mt-2 text-[clamp(56px,10vw,108px)] leading-[.9]">
            shuffle<span className="wordmark-dot">.</span>
          </h1>
          <LobbyNameBar name={lobbyName} isHost={isHost} onRename={onRename} onScroll={onScroll} />
          <p className="mt-3 max-w-2xl text-lg text-ink-soft sm:text-xl">
            It's <span className="text-amber">golden hour</span> somewhere — pull
            up a chair, deal a hand, and stay a while with the people you
            actually like.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={onInvite}
              className="rounded-full bg-gradient-to-br from-sunset-bright to-sunset px-5 py-3 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5"
            >
              Invite friends →
            </button>
            <span className="inline-flex items-center gap-2 rounded-full border border-border-hi bg-black/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-win shadow-[0_0_8px_#3FBE93]" />
              {playersOnline} in {lobbyName || 'this lobby'}
            </span>
          </div>
        </div>

        <HeroArtwork />
      </div>
    </section>
  );
}

// Lobby name + (host-only) rename affordance. Plain text for guests; tap to
// rename for the host with a tiny inline input.
function LobbyNameBar({
  name,
  isHost,
  onRename,
  onScroll,
}: {
  name: string;
  isHost: boolean;
  onRename: (n: string) => void;
  onScroll: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(draft);
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          maxLength={40}
          placeholder="Name this lobby"
          className="w-full max-w-sm rounded-xl border border-amber/45 bg-bg-2 px-3 py-1.5 font-display text-xl font-bold text-ink outline-none ring-amber/40 focus:ring-2 sm:text-2xl"
        />
        <button
          onClick={() => {
            onRename(draft);
            setEditing(false);
          }}
          className="rounded-lg bg-gradient-to-br from-sunset-bright to-sunset px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sunset"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-2">
      <button
        onClick={onScroll}
        className="rounded-lg text-left font-display text-2xl font-bold tracking-tight text-ink hover:text-sunset sm:text-3xl"
      >
        {name || 'Untitled lobby'}
      </button>
      {isHost ? (
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-full border border-amber/45 bg-amber/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber transition hover:bg-amber/20"
          title="Rename this lobby"
        >
          ✎ Rename
        </button>
      ) : (
        <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
          Lobby
        </span>
      )}
    </div>
  );
}

// Hero artwork: a hand-stacked SVG illustration. Three cards fanned over a
// sunset glow + a soft chip stack. Lives inline so we don't ship asset files
// (and so it scales perfectly on retina). Animations are CSS keyframes
// defined in styles.css.
function HeroArtwork() {
  return (
    <div className="relative hidden h-44 w-72 shrink-0 sm:block">
      <div className="absolute inset-0 grid place-items-center">
        {/* glow */}
        <div className="absolute h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgba(255,177,78,.45),transparent_70%)] blur-xl" />
        {/* cards fan */}
        <CardSilhouette
          rank="A"
          suit="♠"
          tone="dark"
          className="absolute -rotate-[18deg] -translate-x-12 -translate-y-2 hero-card-1"
        />
        <CardSilhouette
          rank="K"
          suit="♥"
          tone="red"
          className="absolute rotate-[6deg] hero-card-2"
        />
        <CardSilhouette
          rank="Q"
          suit="♦"
          tone="red"
          className="absolute rotate-[24deg] translate-x-12 -translate-y-1 hero-card-3"
        />
        {/* chip stack */}
        <div className="absolute bottom-1 right-2 flex flex-col items-center">
          <span className="block h-2.5 w-12 rounded-full bg-gradient-to-r from-amber via-sunset to-rose shadow-[0_4px_10px_rgba(255,106,61,.6)]" />
          <span className="-mt-1.5 block h-2.5 w-12 rounded-full bg-gradient-to-r from-sunset via-rose to-dusk-violet shadow-[0_4px_10px_rgba(255,92,122,.5)]" />
          <span className="-mt-1.5 block h-2.5 w-12 rounded-full bg-gradient-to-r from-dusk-violet to-indigo shadow-[0_4px_10px_rgba(122,79,163,.5)]" />
        </div>
      </div>
    </div>
  );
}

function CardSilhouette({
  rank,
  suit,
  tone,
  className = '',
}: {
  rank: string;
  suit: string;
  tone: 'dark' | 'red';
  className?: string;
}) {
  return (
    <div
      className={
        'flex h-32 w-22 select-none flex-col rounded-[12px] bg-gradient-to-br from-[#FBF3EB] to-[#E9DBCB] p-2 shadow-[0_18px_36px_-12px_rgba(0,0,0,.85)] ring-1 ring-black/10 ' +
        className
      }
      style={{ width: 88 }}
    >
      <span
        className="font-display text-lg font-bold leading-none"
        style={{ color: tone === 'red' ? '#E0556B' : '#14101A' }}
      >
        {rank}
      </span>
      <span
        className="font-display text-2xl leading-none"
        style={{ color: tone === 'red' ? '#E0556B' : '#14101A' }}
      >
        {suit}
      </span>
      <span
        className="ml-auto mt-auto rotate-180 font-display text-lg font-bold leading-none"
        style={{ color: tone === 'red' ? '#E0556B' : '#14101A' }}
      >
        {rank}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Game tiles
// ----------------------------------------------------------------------------

function TableCard({
  t,
  onJoin,
  joining,
}: {
  t: LobbyTableRow;
  onJoin: () => void;
  joining: boolean;
}) {
  const isCraps = t.game === 'craps';
  // Game name lives in the artwork banner now — the tile body just carries
  // the secondary signal (stakes + open / mid-hand state) and the CTA.
  const isBlackjack = !isCraps;
  return (
    <button
      onClick={onJoin}
      disabled={joining}
      className="group relative flex flex-col overflow-hidden rounded-[24px] border border-white/8 bg-surface text-left shadow-brand transition hover:-translate-y-1 hover:border-sunset/40 hover:shadow-[0_30px_60px_-20px_rgba(255,106,61,.45)] disabled:opacity-60"
    >
      {isCraps ? <CrapsHero /> : <BlackjackHero />}
      <span className="absolute right-4 top-4 z-10 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur">
        {t.seatsTaken} / {t.maxSeats} seats
      </span>

      <div className="relative flex flex-col gap-3 p-5">
        <p className="text-xs text-ink-mute">
          {t.minBet}–{t.maxBet} chips · {t.inHand ? 'mid-hand' : 'open'}
          {isBlackjack && (
            <>
              {' · '}
              <span className="text-amber">single deck · counting allowed</span>
            </>
          )}
        </p>
        <div className="mt-1 inline-flex w-full items-center justify-between rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3 text-sm font-bold text-white shadow-sunset transition group-hover:translate-x-1">
          <span>{joining ? 'Walking over…' : 'Sit down'}</span>
          <span>→</span>
        </div>
      </div>
    </button>
  );
}

// Logo-style hero illustrations — premium thumbnails that read like real
// casino branding. We borrow the reference's composition (cards + chip +
// gold ribbon) but tune everything to the Shuffle palette: deep dusk
// background, sunset glow, multi-stop gold gradient on a beveled banner,
// and a halo of light rays + sparkles to give the artwork depth.

interface HeroVariant {
  // Background tint: sunset (Blackjack) vs teal (Craps).
  bgGlow: 'sunset' | 'teal';
  // Color of the chip behind the cards/dice.
  chipFill: string;
  chipRim: string;
  // Spade or no spade in the banner.
  decoration: 'spade' | 'dice';
  // Title text — large, gold, all caps.
  title: string;
  // Foreground figures: rendered between the chip and the banner.
  foreground: React.ReactNode;
}

function HeroFrame({ ariaLabel, variant }: { ariaLabel: string; variant: HeroVariant }) {
  return (
    <div className="relative h-44 w-full overflow-hidden">
      <svg
        viewBox="0 0 480 200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          {/* Background gradients */}
          <radialGradient id="heroBg" cx="50%" cy="35%" r="110%">
            <stop offset="0%" stopColor="#352A45" />
            <stop offset="55%" stopColor="#1A1422" />
            <stop offset="100%" stopColor="#070310" />
          </radialGradient>
          <radialGradient id="heroGlowSunset" cx="50%" cy="22%" r="65%">
            <stop offset="0%" stopColor="rgba(255,106,61,.55)" />
            <stop offset="55%" stopColor="rgba(255,92,122,.22)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <radialGradient id="heroGlowTeal" cx="50%" cy="22%" r="65%">
            <stop offset="0%" stopColor="rgba(43,184,158,.55)" />
            <stop offset="55%" stopColor="rgba(255,177,78,.18)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>

          {/* Light-ray spotlight from upper center */}
          <radialGradient id="heroSpot" cx="50%" cy="0%" r="55%">
            <stop offset="0%" stopColor="rgba(255,236,200,.35)" />
            <stop offset="80%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>

          {/* Gold banner — multi-stop bevel with two highlight stripes for a
              luxe casino-logo feel. */}
          <linearGradient id="bannerGold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFF3C8" />
            <stop offset="18%" stopColor="#FFE08A" />
            <stop offset="48%" stopColor="#FFB14E" />
            <stop offset="78%" stopColor="#A36818" />
            <stop offset="100%" stopColor="#5A3A0E" />
          </linearGradient>
          <linearGradient id="bannerFold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#A06B1F" />
            <stop offset="100%" stopColor="#3A2410" />
          </linearGradient>
          <linearGradient id="bannerText" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFF8DC" />
            <stop offset="42%" stopColor="#FFD37A" />
            <stop offset="78%" stopColor="#8C5919" />
            <stop offset="100%" stopColor="#3A2410" />
          </linearGradient>

          {/* Chip face inner ring + center wash */}
          <radialGradient id="chipFace" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="60%" stopColor="#F7E9D9" />
            <stop offset="100%" stopColor="#D6B89E" />
          </radialGradient>
          <radialGradient id="chipShade" cx="50%" cy="35%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,.55)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          <filter id="softDrop" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodOpacity=".55" />
          </filter>
          <filter id="cardDrop" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity=".65" />
          </filter>
        </defs>

        {/* Dusk background + colored glow + spotlight */}
        <rect width="480" height="200" fill="url(#heroBg)" />
        <rect
          width="480"
          height="200"
          fill={variant.bgGlow === 'sunset' ? 'url(#heroGlowSunset)' : 'url(#heroGlowTeal)'}
        />
        <rect width="480" height="200" fill="url(#heroSpot)" />

        {/* Sweeping light rays from top-center */}
        <g opacity="0.18">
          {[-32, -18, 0, 18, 32].map((deg) => (
            <path
              key={deg}
              d="M 240 0 L 200 240 L 280 240 Z"
              fill="rgba(255,236,200,.55)"
              transform={`rotate(${deg} 240 0)`}
            />
          ))}
        </g>

        {/* Chip behind the foreground figures */}
        <g transform="translate(240 100)" filter="url(#softDrop)">
          <circle r="62" fill={variant.chipFill} stroke={variant.chipRim} strokeWidth="2" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect
              key={deg}
              x="-9"
              y="-65"
              width="18"
              height="16"
              rx="2"
              fill="#FBF3EB"
              transform={`rotate(${deg})`}
            />
          ))}
          <circle r="50" fill="url(#chipFace)" />
          <circle r="42" fill="none" stroke={variant.chipFill} strokeWidth="2" strokeDasharray="2 4" />
          <circle r="32" fill="none" stroke={variant.chipRim} strokeWidth="1" opacity="0.45" />
          <circle r="62" fill="url(#chipShade)" />
        </g>

        {/* Foreground figures (cards or dice) — variant-specific */}
        {variant.foreground}

        {/* Sparkles scattered around */}
        {[
          { x: 64, y: 38, r: 4 },
          { x: 416, y: 48, r: 5 },
          { x: 32, y: 96, r: 3 },
          { x: 448, y: 122, r: 3 },
          { x: 130, y: 22, r: 3 },
          { x: 358, y: 28, r: 4 },
        ].map(({ x, y, r }, i) => (
          <Sparkle key={i} x={x} y={y} r={r} />
        ))}

        {/* Gold banner with the title */}
        <g filter="url(#softDrop)">
          <path d="M 6 134 L 60 114 L 76 140 L 22 160 Z" fill="url(#bannerFold)" />
          <path d="M 474 134 L 420 114 L 404 140 L 458 160 Z" fill="url(#bannerFold)" />
          <path
            d="M 30 118 Q 240 92 450 118 L 450 158 Q 240 132 30 158 Z"
            fill="url(#bannerGold)"
            stroke="#3a2412"
            strokeWidth="2"
          />
          {/* Inner highlight stripes */}
          <path
            d="M 50 124 Q 240 102 430 124"
            stroke="#FFF8DC"
            strokeWidth="1.2"
            fill="none"
            opacity="0.85"
          />
          <path
            d="M 50 154 Q 240 132 430 154"
            stroke="#3A2410"
            strokeWidth="0.8"
            fill="none"
            opacity="0.55"
          />
          {/* Embossed title text — two passes: dark "shadow" behind a gold
              fill so the letters look raised. */}
          <text
            x="241"
            y="153"
            fontFamily="Bricolage Grotesque, sans-serif"
            fontWeight="900"
            fontSize="34"
            textAnchor="middle"
            fill="#2C1A08"
            opacity="0.55"
            letterSpacing="2"
          >
            {variant.title}
          </text>
          <text
            x="240"
            y="151"
            fontFamily="Bricolage Grotesque, sans-serif"
            fontWeight="900"
            fontSize="34"
            textAnchor="middle"
            fill="url(#bannerText)"
            stroke="#3a2412"
            strokeWidth="0.8"
            letterSpacing="2"
          >
            {variant.title}
          </text>
          {/* Decorative spade in the middle (Blackjack only) */}
          {variant.decoration === 'spade' && (
            <g transform="translate(240 152)">
              <circle r="9" fill="#E0556B" stroke="#3a2412" strokeWidth="1" />
              <text
                x="0"
                y="3.5"
                fontFamily="Bricolage Grotesque, sans-serif"
                fontWeight="900"
                fontSize="11"
                textAnchor="middle"
                fill="#FBF3EB"
              >
                ♠
              </text>
            </g>
          )}
        </g>

        {/* Atmosphere accents */}
        <circle cx="0" cy="0" r="120" fill={variant.bgGlow === 'sunset' ? 'rgba(255,177,78,.16)' : 'rgba(43,184,158,.18)'} />
        <circle cx="480" cy="200" r="140" fill={variant.bgGlow === 'sunset' ? 'rgba(122,79,163,.2)' : 'rgba(255,106,61,.18)'} />
      </svg>
            {/* Bottom fade so the artwork blends into the tile body */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-surface" />
    </div>
  );
}

function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity="0.85">
      <path
        d={`M 0 -${r * 3} L ${r * 0.7} -${r * 0.7} L ${r * 3} 0 L ${r * 0.7} ${r * 0.7} L 0 ${r * 3} L -${r * 0.7} ${r * 0.7} L -${r * 3} 0 L -${r * 0.7} -${r * 0.7} Z`}
        fill="rgba(255,236,200,.85)"
      />
      <circle r={r * 0.4} fill="#FBF3EB" />
    </g>
  );
}

function BlackjackHero() {
  return (
    <HeroFrame
      ariaLabel="Blackjack"
      variant={{
        bgGlow: 'sunset',
        chipFill: '#E0556B',
        chipRim: '#7A2B12',
        decoration: 'spade',
        title: 'BLACKJACK',
        foreground: (
          <g filter="url(#cardDrop)">
            {/* J of clubs */}
            <g transform="translate(184 28) rotate(-13)">
              <rect width="72" height="100" rx="9" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="66" height="94" rx="6" fill="none" stroke="rgba(0,0,0,.06)" />
              <text x="9" y="26" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A">
                J
              </text>
              <text x="9" y="46" fontFamily="Bricolage Grotesque" fontSize="22" fill="#14101A">
                ♣
              </text>
              <text x="36" y="62" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="38" textAnchor="middle" fill="#14101A">
                ♣
              </text>
              <text x="63" y="94" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A" textAnchor="end" transform="rotate(180 63 86)">
                J
              </text>
            </g>
            {/* A of spades */}
            <g transform="translate(238 22) rotate(11)">
              <rect width="72" height="100" rx="9" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="66" height="94" rx="6" fill="none" stroke="rgba(0,0,0,.06)" />
              <text x="9" y="26" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A">
                A
              </text>
              <text x="9" y="46" fontFamily="Bricolage Grotesque" fontSize="22" fill="#14101A">
                ♠
              </text>
              <text x="36" y="64" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="38" textAnchor="middle" fill="#14101A">
                ♠
              </text>
              <text x="63" y="94" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A" textAnchor="end" transform="rotate(180 63 86)">
                A
              </text>
            </g>
          </g>
        ),
      }}
    />
  );
}

function CrapsHero() {
  return (
    <HeroFrame
      ariaLabel="Craps"
      variant={{
        bgGlow: 'teal',
        chipFill: '#0E5C57',
        chipRim: '#03302C',
        decoration: 'dice',
        title: 'CRAPS',
        foreground: (
          <g filter="url(#cardDrop)">
            {/* Die one — black pips */}
            <g transform="translate(188 30) rotate(-10)">
              <rect width="74" height="74" rx="14" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="68" height="68" rx="11" fill="none" stroke="rgba(0,0,0,.06)" />
              <circle cx="20" cy="20" r="6" fill="#14101A" />
              <circle cx="54" cy="54" r="6" fill="#14101A" />
              <circle cx="37" cy="37" r="6" fill="#14101A" />
            </g>
            {/* Die two — rose pips */}
            <g transform="translate(248 24) rotate(13)">
              <rect width="74" height="74" rx="14" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="68" height="68" rx="11" fill="none" stroke="rgba(0,0,0,.06)" />
              <circle cx="18" cy="18" r="6" fill="#E0556B" />
              <circle cx="56" cy="18" r="6" fill="#E0556B" />
              <circle cx="18" cy="56" r="6" fill="#E0556B" />
              <circle cx="56" cy="56" r="6" fill="#E0556B" />
              <circle cx="37" cy="37" r="6" fill="#E0556B" />
            </g>
          </g>
        ),
      }}
    />
  );
}

function ComingSoonCard({ kind }: { kind: 'holdem' | 'roulette' }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-[24px] border border-white/8 bg-surface/70 text-left opacity-90 shadow-brand">
      <span className="absolute left-4 top-4 z-10 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-soft backdrop-blur">
        Soon
      </span>
      {kind === 'holdem' ? <HoldemHero /> : <RouletteHero />}
      <div className="relative flex flex-col gap-3 p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink-mute">
            {kind === 'holdem' ? "Texas Hold'em" : 'European Roulette'}
          </p>
          <p className="mt-0.5 font-display text-2xl font-bold leading-none tracking-tight">
            {kind === 'holdem' ? 'Friday Night Felt' : 'Velvet Wheel'}
          </p>
          <p className="mt-1.5 text-xs text-ink-mute">
            {kind === 'holdem'
              ? 'Side pots, the social layer, and the Heat Index land in Phase 4.'
              : 'Coming after the table polish pass.'}
          </p>
        </div>
        <div className="inline-flex w-full items-center justify-between rounded-xl border border-white/10 bg-bg-2/60 px-4 py-3 text-sm font-bold text-ink-soft">
          <span>Notify me</span>
          <span>✶</span>
        </div>
      </div>
    </div>
  );
}

function HoldemHero() {
  return (
    <div className="relative h-44 w-full overflow-hidden">
      <svg viewBox="0 0 480 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="holdFelt" cx="50%" cy="0%" r="120%">
            <stop offset="0%" stopColor="#7A4FA3" />
            <stop offset="60%" stopColor="#2C2552" />
            <stop offset="100%" stopColor="#14101A" />
          </radialGradient>
        </defs>
        <rect width="480" height="200" fill="url(#holdFelt)" />
        <ellipse cx="240" cy="120" rx="240" ry="55" fill="rgba(255,255,255,.05)" />
        {/* community cards */}
        {[120, 170, 220, 270, 320].map((x, i) => (
          <g key={i} transform={`translate(${x} 80)`}>
            <rect width="40" height="58" rx="6" fill="#FBF3EB" opacity={i < 3 ? 1 : 0.35} />
          </g>
        ))}
        <text x="240" y="180" textAnchor="middle" fontFamily="Bricolage Grotesque" fontSize="14" fill="rgba(255,228,210,.35)" letterSpacing="6">
          THE TURN
        </text>
      </svg>
    </div>
  );
}

function RouletteHero() {
  return (
    <div className="relative h-44 w-full overflow-hidden">
      <svg viewBox="0 0 480 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="rouFelt" cx="50%" cy="50%" r="80%">
            <stop offset="0%" stopColor="#FF6A3D" />
            <stop offset="60%" stopColor="#7A4FA3" />
            <stop offset="100%" stopColor="#14101A" />
          </radialGradient>
        </defs>
        <rect width="480" height="200" fill="url(#rouFelt)" />
        <g transform="translate(240 100)">
          <circle r="74" fill="#1A1422" stroke="rgba(255,228,210,.2)" strokeWidth="2" />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            const x = Math.cos(a) * 56;
            const y = Math.sin(a) * 56;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={6}
                fill={i % 2 === 0 ? '#FF6A3D' : '#211A2B'}
              />
            );
          })}
          <circle r={10} fill="#FFB14E" />
        </g>
      </svg>
    </div>
  );
}

