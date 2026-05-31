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
import { joinLobby, joinBlackjack, joinCraps, joinHoldem } from '../lib/colyseus';
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

interface LeaderboardRow {
  identityId: string;
  displayName: string;
  chipDelta: number;
  handsPlayed: number;
  biggestWin: number;
  biggestLoss: number;
}

export function Lobby() {
  const myDisplayName = useStore((s) => s.myDisplayName);
  const myIdentityId = useStore((s) => s.myIdentityId);
  const setLobbyRoom = useStore((s) => s.setLobbyRoom);
  const setTableRoom = useStore((s) => s.setTableRoom);
  const setCrapsRoom = useStore((s) => s.setCrapsRoom);
  const setHoldemRoom = useStore((s) => s.setHoldemRoom);
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
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
        // Pull a previously-saved name for this lobbyId so a refresh keeps
        // "Skoville" instead of resetting to unnamed when the server room
        // had to be recreated.
        const savedName = readLobbyName(currentLobbyId);
        room = await joinLobby({
          lobbyId: currentLobbyId,
          lobbyName: savedName || undefined,
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
            leaderboard?: Iterable<LeaderboardRow>;
          };
          setTables(Array.from(t.tables.values()).map((r) => ({ ...r })));
          setPlayersOnline(t.playersOnline ?? 0);
          setLobbyName(t.name ?? '');
          // Mirror the server's authoritative name into localStorage so a
          // refresh / cold reconnect still has the name available even when
          // the server room is created fresh. Also remember this lobby in
          // the known-lobbies list so the lobby toggle menu can switch.
          if (t.name) writeLobbyName(currentLobbyId, t.name);
          rememberLobby(currentLobbyId, t.name ?? readLobbyName(currentLobbyId) ?? '');
          if (t.hostId !== undefined) setLobbyHostId(t.hostId);
          if (t.leaderboard) {
            setLeaderboard(
              Array.from(t.leaderboard).map((row) => ({
                identityId: row.identityId,
                displayName: row.displayName,
                chipDelta: row.chipDelta,
                handsPlayed: row.handsPlayed,
                biggestWin: row.biggestWin,
                biggestLoss: row.biggestLoss,
              })),
            );
          }
        };
        room.onStateChange(sync);
        sync();
      } catch (err) {
        if (cancelled) {
          // Effect was torn down (often React-strict-mode double-mount).
          // Silently swallow — the second mount's join will succeed.
          console.warn(err);
          return;
        }
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
    setLobbyName(trimmed);
    writeLobbyName(currentLobbyId, trimmed);
    lobbyRoomRef.current?.send(C2S.lobbySetName, { name: trimmed });
  };

  // Fork a new lobby with a fresh slug — separates this friend group from
  // any other group the user runs. Reuses identity + display name; lands
  // them in an empty unnamed lobby ready for a new invite.
  const newLobby = () => {
    const slug = newLobbySlug(myDisplayName || 'lobby');
    const url = new URL(window.location.href);
    url.searchParams.set('lobby', slug);
    window.location.href = url.toString();
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
      if (row.game === 'holdem') {
        const r = await joinHoldem({
          lobbyId: currentLobbyId,
          identityId: myIdentityId,
          displayName: myDisplayName || 'Guest',
        });
        setHoldemRoom(r, r.sessionId);
        setView('holdem');
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
        onNewLobby={newLobby}
      />

      <div
        ref={tablesRef}
        className="mt-12 flex items-end justify-between sm:mt-16"
      >
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          Pick a game
        </h2>
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
      </div>

      {leaderboard.length > 0 && (
        <Leaderboard rows={leaderboard} myIdentityId={myIdentityId} />
      )}

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
  onNewLobby,
}: {
  name: string;
  playersOnline: number;
  lobbyName: string;
  isHost: boolean;
  onInvite: () => void;
  onRename: (n: string) => void;
  onScroll: () => void;
  onNewLobby: () => void;
}) {
  void playersOnline;
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
          <LobbyNameBar
            name={lobbyName}
            isHost={isHost}
            onRename={onRename}
            onScroll={onScroll}
            playersOnline={playersOnline}
          />
          <p className="mt-3 max-w-2xl text-lg text-ink-soft sm:text-xl">
            It's <span className="text-amber">golden hour</span> somewhere —
            friends on camera, chips on the felt, bragging rights on the line.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={onInvite}
              className="rounded-full bg-gradient-to-br from-sunset-bright to-sunset px-5 py-3 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5"
            >
              {lobbyName ? `Invite friends to ${lobbyName} →` : 'Invite friends →'}
            </button>
            <LobbyMenuButton onNewLobby={onNewLobby} />
          </div>
        </div>

        <HeroArtwork />
      </div>
    </section>
  );
}

// Lobby name + (host-only) rename affordance. The host is auto-prompted to
// name the lobby the first time around (when it arrives unnamed); after that
// it's plain text for guests, "✎ Rename" for the host.
function LobbyNameBar({
  name,
  isHost,
  onRename,
  onScroll,
  playersOnline,
}: {
  name: string;
  isHost: boolean;
  onRename: (n: string) => void;
  onScroll: () => void;
  playersOnline: number;
}) {
  // Auto-open the input when the host is in an unnamed lobby. We track
  // whether we've ever seen a name to avoid snapping back into editing mode
  // after the host clears their own name mid-session.
  const seenNameRef = useRef(!!name);
  if (name) seenNameRef.current = true;
  const needsName = isHost && !name && !seenNameRef.current;
  const [editing, setEditing] = useState(needsName);
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  useEffect(() => {
    if (needsName) setEditing(true);
  }, [needsName]);
  if (editing) {
    return (
      <div className="mt-1">
        {needsName && (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber">
            Name your lobby
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onRename(draft);
                setEditing(false);
              }
              if (e.key === 'Escape' && name) setEditing(false);
            }}
            maxLength={40}
            placeholder="e.g. Skoville"
            className="w-full max-w-sm rounded-xl border border-amber/45 bg-bg-2 px-3 py-1.5 font-display text-xl font-bold text-ink outline-none ring-amber/40 focus:ring-2 sm:text-2xl"
          />
          <button
            disabled={!draft.trim()}
            onClick={() => {
              if (!draft.trim()) return;
              onRename(draft);
              setEditing(false);
            }}
            className="rounded-lg bg-gradient-to-br from-sunset-bright to-sunset px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sunset disabled:opacity-40"
          >
            Save
          </button>
          {name && (
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
            >
              Cancel
            </button>
          )}
        </div>
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
          aria-label="Rename this lobby"
          title="Rename this lobby"
          className="grid h-6 w-6 place-items-center rounded-full border border-amber/45 bg-amber/10 text-amber transition hover:bg-amber/20"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      ) : (
        <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
          Lobby
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
        <span className="h-1.5 w-1.5 rounded-full bg-win shadow-[0_0_8px_#3FBE93]" />
        {playersOnline} {playersOnline === 1 ? 'player' : 'players'}
      </span>
    </div>
  );
}

interface KnownLobby {
  id: string;
  name: string;
  lastSeen: number;
}

const KNOWN_LOBBIES_KEY = 'shuffle:known-lobbies';

function readKnownLobbies(): KnownLobby[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KNOWN_LOBBIES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as KnownLobby[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function rememberLobby(id: string, name: string) {
  if (!id || typeof window === 'undefined') return;
  try {
    const list = readKnownLobbies();
    const existing = list.find((l) => l.id === id);
    if (existing) {
      existing.name = name || existing.name;
      existing.lastSeen = Date.now();
    } else {
      list.push({ id, name: name || 'Untitled lobby', lastSeen: Date.now() });
    }
    localStorage.setItem(KNOWN_LOBBIES_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* ignore */
  }
}

// localStorage helpers for cross-refresh lobby name persistence + slug minting.
const LOBBY_NAME_KEY = 'shuffle:lobby-name:';

function readLobbyName(lobbyId: string): string {
  if (!lobbyId || typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(LOBBY_NAME_KEY + lobbyId) ?? '';
  } catch {
    return '';
  }
}

function writeLobbyName(lobbyId: string, name: string) {
  if (!lobbyId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOBBY_NAME_KEY + lobbyId, name);
  } catch {
    /* ignore */
  }
}

function newLobbySlug(displayName: string): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  const slug = first
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
  const suffix = Math.random().toString(36).slice(2, 6);
  return slug ? `${slug}-${suffix}` : `lobby-${suffix}`;
}

// Combined "+ New lobby" / lobby switcher. If the user has visited more than
// one lobby on this device, the button becomes a dropdown listing each known
// lobby with a "+ New lobby" option at the bottom.
function LobbyMenuButton({ onNewLobby }: { onNewLobby: () => void }) {
  const currentLobbyId = useStore((s) => s.currentLobbyId);
  const [open, setOpen] = useState(false);
  const [lobbies, setLobbies] = useState<KnownLobby[]>(() => readKnownLobbies());
  useEffect(() => {
    if (open) setLobbies(readKnownLobbies());
  }, [open]);
  const otherLobbies = lobbies.filter((l) => l.id !== currentLobbyId);
  const hasOthers = otherLobbies.length > 0;
  const switchTo = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lobby', id);
    window.location.href = url.toString();
  };
  if (!hasOthers) {
    return (
      <button
        onClick={onNewLobby}
        className="rounded-full border border-white/15 bg-black/30 px-4 py-3 text-sm font-bold uppercase tracking-[0.18em] text-ink-soft transition hover:border-amber/45 hover:text-amber"
      >
        + New lobby
      </button>
    );
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-white/15 bg-black/30 px-4 py-3 text-sm font-bold uppercase tracking-[0.18em] text-ink-soft transition hover:border-amber/45 hover:text-amber"
      >
        Switch lobby ▾
      </button>
      {open && (
        <>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="fixed inset-0 z-20 cursor-default bg-transparent"
          />
          <div className="absolute left-0 top-full z-30 mt-2 min-w-[220px] overflow-hidden rounded-2xl border border-border-hi bg-surface shadow-brand">
            <ul className="max-h-64 overflow-y-auto py-1">
              {otherLobbies
                .slice()
                .sort((a, b) => b.lastSeen - a.lastSeen)
                .map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => switchTo(l.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-ink hover:bg-amber/10"
                    >
                      <span className="truncate font-display font-bold">
                        {l.name || 'Untitled lobby'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-ink-mute">
                        Switch
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
            <button
              onClick={() => {
                setOpen(false);
                onNewLobby();
              }}
              className="block w-full border-t border-white/10 px-3 py-2.5 text-left text-sm font-bold text-sunset hover:bg-sunset/10"
            >
              + New lobby
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Leaderboard({
  rows,
  myIdentityId,
}: {
  rows: LeaderboardRow[];
  myIdentityId: string;
}) {
  const top = rows[0];
  const totalHands = rows.reduce((sum, r) => sum + r.handsPlayed, 0);
  const biggestEver = rows.reduce(
    (m, r) => (r.biggestWin > m.win ? { ...m, win: r.biggestWin, name: r.displayName } : m),
    { win: 0, name: '' },
  );
  const biggestBust = rows.reduce(
    (m, r) => (r.biggestLoss < m.loss ? { ...m, loss: r.biggestLoss, name: r.displayName } : m),
    { loss: 0, name: '' },
  );
  return (
    <section className="mt-10 rounded-[24px] border border-amber/35 bg-gradient-to-br from-[#1A1422]/85 to-[#211A2B]/85 px-5 py-5 shadow-brand backdrop-blur sm:mt-14 sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-amber">
            Lobby leaderboard
          </p>
          <h2 className="mt-1 font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">
            {top
              ? `${top.displayName || 'Anonymous'} is up ${top.chipDelta.toLocaleString()}`
              : 'Be the first to win a hand'}
          </h2>
        </div>
        <p className="text-[10px] uppercase tracking-wider text-ink-mute">
          Lifetime · across every game in this lobby
        </p>
      </div>

      {/* Headline stat strip across the top. */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="Hands played" value={totalHands.toLocaleString()} />
        <StatCard
          label="Biggest hand"
          value={biggestEver.win > 0 ? `+${biggestEver.win.toLocaleString()}` : '—'}
          sub={biggestEver.name || undefined}
          tone="win"
        />
        <StatCard
          label="Worst beat"
          value={biggestBust.loss < 0 ? biggestBust.loss.toLocaleString() : '—'}
          sub={biggestBust.name || undefined}
          tone="lose"
        />
      </div>

      <ol className="mt-4 flex flex-col gap-1.5">
        {/* Column legend */}
        <li className="grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_4.5rem_4.5rem_5rem] items-center gap-2 px-3 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-ink-mute/80 sm:gap-3">
          <span>#</span>
          <span>Player</span>
          <span className="text-right">Hands</span>
          <span className="text-right">Best</span>
          <span className="text-right">Worst</span>
          <span className="text-right">Net</span>
        </li>
        {rows.map((row, i) => {
          const isMine = row.identityId === myIdentityId;
          const tone =
            row.chipDelta > 0 ? 'text-win' : row.chipDelta < 0 ? 'text-fold' : 'text-ink-mute';
          return (
            <li
              key={row.identityId || i}
              className={
                'grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_4.5rem_4.5rem_5rem] items-center gap-2 rounded-xl px-3 py-2 sm:gap-3 ' +
                (isMine ? 'border border-sunset/45 bg-sunset/10' : 'bg-black/25')
              }
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-amber/15 font-display text-sm font-bold text-amber">
                {i + 1}
              </span>
              <span className="truncate text-sm font-bold text-ink">
                {row.displayName || 'Guest'}
                {isMine && (
                  <span className="ml-1.5 rounded-full bg-sunset/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sunset">
                    You
                  </span>
                )}
              </span>
              <span className="text-right text-[11px] tabular-nums text-ink-soft">
                {row.handsPlayed}
              </span>
              <span className="text-right text-[11px] tabular-nums text-win">
                {row.biggestWin > 0 ? `+${row.biggestWin.toLocaleString()}` : '—'}
              </span>
              <span className="text-right text-[11px] tabular-nums text-fold">
                {row.biggestLoss < 0 ? row.biggestLoss.toLocaleString() : '—'}
              </span>
              <span className={'text-right font-display text-base font-bold tabular-nums ' + tone}>
                {row.chipDelta > 0 ? '+' : ''}
                {row.chipDelta.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'win' | 'lose';
}) {
  const valueTone =
    tone === 'win' ? 'text-win' : tone === 'lose' ? 'text-fold' : 'text-ink';
  return (
    <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-ink-mute">
        {label}
      </p>
      <p className={'mt-0.5 font-display text-base font-black tabular-nums sm:text-lg ' + valueTone}>
        {value}
      </p>
      {sub && (
        <p className="truncate text-[10px] text-ink-soft">{sub}</p>
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
  const isHoldem = t.game === 'holdem';
  const isBlackjack = !isCraps && !isHoldem;
  return (
    <button
      onClick={onJoin}
      disabled={joining}
      className="group relative flex flex-col overflow-hidden rounded-[24px] border border-white/8 bg-surface text-left shadow-brand transition hover:-translate-y-1 hover:border-sunset/40 hover:shadow-[0_30px_60px_-20px_rgba(255,106,61,.45)] disabled:opacity-60"
    >
      {isCraps ? <CrapsHero /> : isHoldem ? <HoldemTileHero /> : <BlackjackHero />}
      <span className="absolute right-4 top-4 z-10 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur">
        {t.seatsTaken} / {t.maxSeats} seats
      </span>

      <div className="relative flex flex-col gap-3 p-5">
        <p className="text-xs text-ink-mute">
          {isHoldem ? (
            <>
              {t.minBet}/{t.maxBet} blinds · {t.inHand ? 'mid-hand' : 'open'}
              {' · '}
              <span className="text-amber">no-limit</span>
            </>
          ) : (
            <>
              {t.minBet}–{t.maxBet} chips · {t.inHand ? 'mid-hand' : 'open'}
              {isBlackjack && (
                <>
                  {' · '}
                  <span className="text-amber">single deck · counting allowed</span>
                </>
              )}
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

// Hold'em tile hero — same composition language as Blackjack/Craps. Two
// hole cards + a chip behind, gold banner reading HOLD'EM, violet-ish glow.
function HoldemTileHero() {
  return (
    <HeroFrame
      ariaLabel="Texas Hold'em"
      variant={{
        bgGlow: 'sunset',
        chipFill: '#7A4FA3',
        chipRim: '#2C1A4A',
        decoration: 'spade',
        title: "HOLD'EM",
        foreground: (
          <g filter="url(#cardDrop)">
            <g transform="translate(190 32) rotate(-12)">
              <rect width="74" height="102" rx="9" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="68" height="96" rx="6" fill="none" stroke="rgba(0,0,0,.06)" />
              <text x="9" y="26" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#E0556B">
                A
              </text>
              <text x="9" y="46" fontFamily="Bricolage Grotesque" fontSize="22" fill="#E0556B">
                ♥
              </text>
              <text x="37" y="64" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="38" textAnchor="middle" fill="#E0556B">
                ♥
              </text>
              <text x="65" y="96" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#E0556B" textAnchor="end" transform="rotate(180 65 88)">
                A
              </text>
            </g>
            <g transform="translate(244 24) rotate(12)">
              <rect width="74" height="102" rx="9" fill="#FFFFFF" stroke="#2C2552" strokeWidth="1.5" />
              <rect x="3" y="3" width="68" height="96" rx="6" fill="none" stroke="rgba(0,0,0,.06)" />
              <text x="9" y="26" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A">
                K
              </text>
              <text x="9" y="46" fontFamily="Bricolage Grotesque" fontSize="22" fill="#14101A">
                ♣
              </text>
              <text x="37" y="64" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="38" textAnchor="middle" fill="#14101A">
                ♣
              </text>
              <text x="65" y="96" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="22" fill="#14101A" textAnchor="end" transform="rotate(180 65 88)">
                K
              </text>
            </g>
          </g>
        ),
      }}
    />
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
            <stop offset="0%" stopColor="#1A0F08" />
            <stop offset="50%" stopColor="#14101A" />
            <stop offset="100%" stopColor="#0A0610" />
          </linearGradient>
          <linearGradient id="bannerTextHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,248,220,.9)" />
            <stop offset="40%" stopColor="rgba(255,211,122,0)" />
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

        {/* Gold banner with the title — taller + bigger letters for legibility */}
        <g filter="url(#softDrop)">
          <path d="M 4 138 L 60 112 L 80 148 L 24 174 Z" fill="url(#bannerFold)" />
          <path d="M 476 138 L 420 112 L 400 148 L 456 174 Z" fill="url(#bannerFold)" />
          <path
            d="M 30 116 Q 240 86 450 116 L 450 172 Q 240 142 30 172 Z"
            fill="url(#bannerGold)"
            stroke="#3a2412"
            strokeWidth="2"
          />
          {/* Inner highlight stripes */}
          <path
            d="M 50 124 Q 240 100 430 124"
            stroke="#FFF8DC"
            strokeWidth="1.4"
            fill="none"
            opacity="0.9"
          />
          <path
            d="M 50 166 Q 240 142 430 166"
            stroke="#3A2410"
            strokeWidth="0.9"
            fill="none"
            opacity="0.55"
          />
          {/* Title text — dark fill on gold for max legibility, with a soft
              highlight pass so the letters still feel embossed. BLACKJACK
              gets slightly smaller letters so the long word still fits. */}
          {(() => {
            const longTitle = variant.title.length >= 8;
            const size = longTitle ? 44 : 52;
            const letterSpacing = longTitle ? 2 : 4;
            return (
              <>
                <text
                  x="241"
                  y="160"
                  fontFamily="Bricolage Grotesque, sans-serif"
                  fontWeight="900"
                  fontSize={size}
                  textAnchor="middle"
                  fill="#FFE4B0"
                  opacity="0.35"
                  letterSpacing={letterSpacing}
                >
                  {variant.title}
                </text>
                <text
                  x="240"
                  y="158"
                  fontFamily="Bricolage Grotesque, sans-serif"
                  fontWeight="900"
                  fontSize={size}
                  textAnchor="middle"
                  fill="url(#bannerText)"
                  stroke="#000000"
                  strokeWidth="0.6"
                  letterSpacing={letterSpacing}
                >
                  {variant.title}
                </text>
                {/* top-edge highlight */}
                <text
                  x="240"
                  y="158"
                  fontFamily="Bricolage Grotesque, sans-serif"
                  fontWeight="900"
                  fontSize={size}
                  textAnchor="middle"
                  fill="url(#bannerTextHighlight)"
                  letterSpacing={letterSpacing}
                  style={{ mixBlendMode: 'screen' }}
                >
                  {variant.title}
                </text>
              </>
            );
          })()}
          {/* Decorative spade in the middle (Blackjack only) */}
          {variant.decoration === 'spade' && (
            <g transform="translate(240 178)">
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

