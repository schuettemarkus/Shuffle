// No-Limit Texas Hold'em — Phase 4 ship.
//
// Same flanking layout as the Blackjack screen (3 seats down each side, felt
// at top), so it slots into the existing Lobby/Settings/Chat infrastructure
// without bespoke chrome. The room is server-authoritative; the client just
// renders state + sends `HoldemAction`s on click.

import { useEffect, useMemo, useRef, useState } from 'react';
import { C2S, type HoldemAction, HOLDEM_MAX_SEATS } from '@shuffle/shared';
import { useStore } from '../lib/store';
import { ChatPanel } from '../components/ChatPanel';
import { PlayingCard } from '../components/PlayingCard';
import type { Room } from 'colyseus.js';

interface HoldemSeatView {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  committed: number;
  totalCommitted: number;
  hole: Array<{ rank: string; suit: string }>;
  phase: string;
  isTurn: boolean;
  turnClockMs: number;
  connected: boolean;
  handLabel: string;
  handsPlayed: number;
  handsWon: number;
  netProfit: number;
  sittingOut: boolean;
}

interface HoldemPotView {
  amount: number;
  cap: number;
  eligibleSeats: number[];
}

interface HoldemTableView {
  name: string;
  phase: string;
  phaseClockMs: number;
  round: number;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  hostId: string;
  community: Array<{ rank: string; suit: string }>;
  pots: HoldemPotView[];
  seats: HoldemSeatView[];
}

function emptySeat(i: number): HoldemSeatView {
  return {
    index: i,
    playerId: '',
    identityId: '',
    displayName: '',
    stack: 0,
    committed: 0,
    totalCommitted: 0,
    hole: [],
    phase: 'empty',
    isTurn: false,
    turnClockMs: 0,
    connected: true,
    handLabel: '',
    handsPlayed: 0,
    handsWon: 0,
    netProfit: 0,
    sittingOut: false,
  };
}

export function Holdem() {
  const room = useStore((s) => s.holdemRoom);
  const setView = useStore((s) => s.setView);
  const mySessionId = useStore((s) => s.mySessionId);
  const myDisplayName = useStore((s) => s.myDisplayName);
  const camStream = useStore((s) => s.camStream);
  const peerStreams = useStore((s) => s.peerStreams);
  const pushToast = useStore((s) => s.pushToast);

  const [table, setTable] = useState<HoldemTableView | null>(null);
  const [lastResult, setLastResult] = useState<null | {
    round: number;
    community: Array<{ rank: string; suit: string }>;
    perPot: Array<{
      amount: number;
      winners: Array<{ seatIndex: number; playerId: string; share: number; handLabel?: string }>;
    }>;
    perSeat: Array<{ seatIndex: number; playerId: string; delta: number; handLabel?: string }>;
  }>(null);
  const [betDraft, setBetDraft] = useState(0);

  useEffect(() => {
    if (!room) return;
    const sync = () => setTable(snapshot(room.state));
    room.onStateChange(sync);
    sync();
    room.onLeave(() => {
      pushToast({ kind: 'info', text: 'Left the Hold’em table.' });
      setView('lobby');
    });
    room.onMessage('holdemHandResult', (r: typeof lastResult) => {
      setLastResult(r);
      setTimeout(() => setLastResult(null), 4500);
    });
    // Hand history list — not displayed yet but registering the handler keeps
    // colyseus.js from logging "onMessage() not registered" on every join.
    room.onMessage('holdemHandHistory', () => {
      // no-op placeholder until a Hold'em hand-history panel exists
    });
  }, [room, pushToast, setView]);

  const mySeat = useMemo(
    () => (table ? table.seats.find((s) => s.playerId === mySessionId) ?? null : null),
    [table, mySessionId],
  );

  const myTurn = mySeat?.isTurn ?? false;

  useEffect(() => {
    if (!myTurn || !table || !mySeat) return;
    // Reset draft to the smallest legal raise / min bet each time it becomes
    // our turn — clearer than carrying stale state across hands.
    const min = Math.max(table.bigBlind, table.currentBet + table.minRaise);
    setBetDraft(Math.min(min, mySeat.stack + mySeat.committed));
  }, [myTurn, table?.currentBet, table?.minRaise, mySeat?.stack]);

  if (!room || !table) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">
        Walking over to the Hold’em table…
      </div>
    );
  }

  const leftSeats = table.seats.slice(0, 3);
  const rightSeats = table.seats.slice(3, 6);
  const pot = table.pots.reduce((sum, p) => sum + p.amount, 0)
    + table.seats.reduce((sum, s) => sum + s.committed, 0);

  return (
    <div className="relative mx-auto flex max-w-5xl flex-col gap-3 px-2 pb-32 pt-3 sm:px-6 sm:pt-5 sm:pr-[336px]">
      <header className="flex items-center justify-between">
        <button
          onClick={() => setView('lobby')}
          className="rounded-full border border-border-hi bg-black/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft backdrop-blur"
        >
          ← Lobby
        </button>
        <div className="rounded-full border border-border-hi bg-black/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink backdrop-blur">
          <span className="text-sunset">Hold’em</span>
          <span className="mx-2 text-white/30">·</span>
          {phaseLabel(table.phase)}
        </div>
        <div />
      </header>

      <section className="relative">
        {/* MOBILE — felt on top, 3×2 seat grid below. */}
        <div className="sm:hidden">
          <FeltCenter table={table} pot={pot} lastResult={lastResult} mySessionId={mySessionId} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {table.seats.map((s) => (
              <Seat
                key={s.index}
                seat={s}
                table={table}
                isMine={s.playerId === mySessionId}
                stream={streamFor(s, mySessionId, camStream, peerStreams)}
                room={room}
              />
            ))}
          </div>
        </div>

        {/* DESKTOP — flanking columns. */}
        <div className="hidden gap-3 sm:grid sm:grid-cols-[170px_minmax(0,1fr)_170px] md:grid-cols-[190px_minmax(0,1fr)_190px]">
          <div className="flex flex-col gap-3">
            {leftSeats.map((s) => (
              <Seat
                key={s.index}
                seat={s}
                table={table}
                isMine={s.playerId === mySessionId}
                stream={streamFor(s, mySessionId, camStream, peerStreams)}
                room={room}
              />
            ))}
          </div>
          <FeltCenter table={table} pot={pot} lastResult={lastResult} mySessionId={mySessionId} />
          <div className="flex flex-col gap-3">
            {rightSeats.map((s) => (
              <Seat
                key={s.index}
                seat={s}
                table={table}
                isMine={s.playerId === mySessionId}
                stream={streamFor(s, mySessionId, camStream, peerStreams)}
                room={room}
              />
            ))}
          </div>
        </div>
      </section>

      <ActionBar
        table={table}
        mySeat={mySeat}
        myTurn={myTurn}
        betDraft={betDraft}
        setBetDraft={setBetDraft}
        room={room}
      />

      <ChatPanel room={room} mySessionId={mySessionId} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Felt center — dealer/community area + pot
// ----------------------------------------------------------------------------

function FeltCenter({
  table,
  pot,
  lastResult,
  mySessionId,
}: {
  table: HoldemTableView;
  pot: number;
  lastResult: null | {
    round: number;
    perSeat: Array<{ seatIndex: number; playerId: string; delta: number; handLabel?: string }>;
    perPot: Array<{ amount: number; winners: Array<{ seatIndex: number; playerId: string; share: number; handLabel?: string }> }>;
  };
  mySessionId: string | null;
}) {
  return (
    <div className="felt relative overflow-hidden rounded-[24px] border border-white/8 px-3 py-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] sm:px-4 sm:py-4">
      <div className="pointer-events-none absolute inset-2 rounded-[240px_/_140px] border border-white/10" />
      <div className="pointer-events-none absolute inset-4 rounded-[160px_/_110px] border border-white/5" />

      {lastResult && table.phase === 'showdown' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-3">
          <HoldemResultRibbon r={lastResult} mySessionId={mySessionId} />
        </div>
      )}

      <div className="relative flex flex-col items-center gap-3">
        <div className="inline-flex items-center gap-3 rounded-full border border-amber/45 bg-black/40 px-5 py-1.5 shadow-[0_0_24px_-6px_rgba(255,177,78,.5)] backdrop-blur">
          <span className="font-display text-[13px] font-bold uppercase tracking-[0.5em] text-amber">
            Community
          </span>
        </div>

        <CommunityRow community={table.community} />

        <PhaseClock table={table} />

        <PotChips pot={pot} pots={table.pots} blinds={`${table.smallBlind}/${table.bigBlind}`} />
      </div>
    </div>
  );
}

function CommunityRow({ community }: { community: Array<{ rank: string; suit: string }> }) {
  const slots: Array<{ rank: string; suit: string } | null> = [null, null, null, null, null];
  for (let i = 0; i < community.length; i++) slots[i] = community[i]!;
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {slots.map((c, i) => (
        <div key={i} className="grid place-items-center">
          {c ? (
            <PlayingCard card={{ rank: c.rank as any, suit: c.suit as any }} size="lg" />
          ) : (
            <div className="h-[92px] w-[64px] rounded-xl border border-white/15 bg-black/30 sm:h-[120px] sm:w-[84px]" />
          )}
        </div>
      ))}
    </div>
  );
}

function PhaseClock({ table }: { table: HoldemTableView }) {
  if (table.phase === 'waiting' || table.phase === 'paused') {
    return (
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink-mute">
        Waiting for players…
      </p>
    );
  }
  if (table.phase === 'between') {
    return (
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink-mute">
        Next hand in {Math.max(0, Math.ceil(table.phaseClockMs / 1000))}s
      </p>
    );
  }
  if (table.phase === 'showdown') {
    return (
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">
        Showdown
      </p>
    );
  }
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-sunset">
      {phaseLabel(table.phase)} · bet to call <span className="text-white">{table.currentBet}</span>
    </p>
  );
}

function PotChips({ pot, pots, blinds }: { pot: number; pots: HoldemPotView[]; blinds: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="rounded-2xl border border-amber/45 bg-black/50 px-4 py-2 text-center shadow-[0_0_18px_-6px_rgba(255,177,78,.45)] backdrop-blur">
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber">Pot</p>
        <p className="font-display text-2xl font-black leading-none tabular-nums text-white">
          {pot}
        </p>
      </div>
      {pots.length > 1 && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
          {pots.length} side pots
        </p>
      )}
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink-mute/80">
        Blinds {blinds}
      </p>
    </div>
  );
}

function HoldemResultRibbon({
  r,
  mySessionId,
}: {
  r: {
    round: number;
    perSeat: Array<{ seatIndex: number; playerId: string; delta: number; handLabel?: string }>;
    perPot: Array<{ amount: number; winners: Array<{ seatIndex: number; playerId: string; share: number; handLabel?: string }> }>;
  };
  mySessionId: string | null;
}) {
  const mine = mySessionId ? r.perSeat.find((s) => s.playerId === mySessionId) : null;
  const topWinner = r.perPot[0]?.winners[0];
  if (!mine) {
    return (
      <div className="rounded-2xl border border-border-hi bg-black/75 px-5 py-3 backdrop-blur-md">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ink-mute">
          Round {r.round}
        </p>
        {topWinner && (
          <p className="mt-1 font-display text-2xl font-black text-amber">
            Pot {r.perPot[0]!.amount} →{' '}
            <span className="text-white">{topWinner.handLabel ?? 'Best hand'}</span>
          </p>
        )}
      </div>
    );
  }
  const delta = mine.delta;
  const mood: 'win' | 'lose' | 'push' = delta > 0 ? 'win' : delta < 0 ? 'lose' : 'push';
  const headline = delta > 0 ? 'You won' : delta < 0 ? 'You lost' : 'Push';
  const ringClass =
    mood === 'win'
      ? 'border-win/70 shadow-[0_0_60px_-10px_rgba(63,190,147,.7)]'
      : mood === 'lose'
      ? 'border-fold/70 shadow-[0_0_60px_-10px_rgba(255,124,150,.6)]'
      : 'border-amber/55 shadow-[0_0_60px_-12px_rgba(255,177,78,.45)]';
  const headlineClass = mood === 'win' ? 'text-win' : mood === 'lose' ? 'text-[#FF9DAC]' : 'text-amber';
  const deltaClass = delta > 0 ? 'text-win' : delta < 0 ? 'text-[#FF9DAC]' : 'text-amber';
  return (
    <div
      className={
        'pointer-events-none relative overflow-hidden rounded-2xl border bg-black/80 px-6 py-3 backdrop-blur-md animate-rise ' +
        ringClass
      }
    >
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.32em] text-ink-mute">
            Round {r.round}
          </span>
          <span className={'font-display text-3xl font-black leading-none sm:text-4xl ' + headlineClass}>
            {headline}
          </span>
          {mine.handLabel && (
            <span className="mt-0.5 text-xs font-semibold text-ink-soft">{mine.handLabel}</span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">Net</span>
          <span className={'font-display text-3xl font-black tabular-nums leading-none sm:text-4xl ' + deltaClass}>
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Seat tile
// ----------------------------------------------------------------------------

function Seat({
  seat,
  table,
  isMine,
  stream,
  room,
}: {
  seat: HoldemSeatView;
  table: HoldemTableView;
  isMine: boolean;
  stream: MediaStream | null;
  room: Room | null;
}) {
  const setSelectedSeat = useStore((s) => s.setSelectedSeat);
  const selectedSeatIndex = useStore((s) => s.selectedSeatIndex);
  const empty = seat.phase === 'empty';
  const isButton = seat.index === table.buttonSeat;
  const isSB = seat.index === table.smallBlindSeat;
  const isBB = seat.index === table.bigBlindSeat;
  const showHole = isMine || (table.phase === 'showdown' && seat.hole.length > 0);

  if (empty) {
    return (
      <button
        onClick={() => {
          if (selectedSeatIndex !== seat.index) {
            setSelectedSeat(seat.index);
            return;
          }
          send(room, { type: 'sit', seatIndex: seat.index, buyIn: 1000 });
          setSelectedSeat(null);
        }}
        className={
          'group relative flex min-h-[220px] w-full flex-col items-center justify-center gap-1 rounded-2xl border bg-black/20 px-3 py-4 text-xs font-bold text-ink-soft transition hover:text-sunset sm:min-h-[240px] ' +
          (selectedSeatIndex === seat.index
            ? 'border-sunset/60 bg-sunset/10 text-sunset'
            : 'border-dashed border-border')
        }
      >
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink-mute">
          Seat {seat.index + 1}
        </span>
        <span className="text-sm">
          {selectedSeatIndex === seat.index ? 'Confirm · 1,000 chips' : 'Sit down →'}
        </span>
      </button>
    );
  }

  const borderClass = seat.isTurn
    ? 'border-sunset/70 shadow-sunset animate-pulseSunset'
    : seat.phase === 'folded'
    ? 'border-white/10 opacity-60'
    : seat.phase === 'allIn'
    ? 'border-amber/55'
    : isMine
    ? 'border-amber/40'
    : 'border-white/10';

  return (
    <div className={'relative flex min-h-[220px] flex-col gap-1.5 overflow-visible rounded-2xl border bg-gradient-to-b from-surface to-bg-2 p-2 transition sm:min-h-[240px] sm:p-2.5 ' + borderClass}>
      {isButton && (
        <div
          className="absolute -left-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/80 bg-gradient-to-br from-amber to-sunset text-[10px] font-bold text-black shadow-[0_4px_14px_rgba(255,177,78,.6)]"
          title="Dealer button"
        >
          D
        </div>
      )}
      {(isSB || isBB) && (
        <div
          className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/40 bg-black/70 text-[10px] font-bold text-amber"
          title={isSB ? 'Small blind' : 'Big blind'}
        >
          {isSB ? 'SB' : 'BB'}
        </div>
      )}

      <SeatVideo seat={seat} stream={stream} mine={isMine} />

      <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-display text-base font-bold leading-none tabular-nums text-ink">
            {seat.stack}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-ink-mute">chips</span>
        </div>
        {seat.committed > 0 && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber">
            In {seat.committed}
          </p>
        )}
        {seat.phase === 'folded' && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-fold/80">Folded</p>
        )}
        {seat.phase === 'allIn' && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber">All-in</p>
        )}
        {seat.handLabel && table.phase === 'showdown' && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-win">
            {seat.handLabel}
          </p>
        )}
      </div>

      {/* Hole cards - face-up to owner / at showdown, otherwise card-back pattern. */}
      <div className="flex justify-center gap-1.5">
        {seat.hole.length > 0 ? (
          seat.hole.map((c, i) =>
            showHole ? (
              <PlayingCard key={i} card={{ rank: c.rank as any, suit: c.suit as any }} size="sm" />
            ) : (
              <CardBack key={i} />
            ),
          )
        ) : seat.phase === 'inHand' || seat.phase === 'allIn' ? (
          <>
            <CardBack />
            <CardBack />
          </>
        ) : (
          <div className="h-10" />
        )}
      </div>
    </div>
  );
}

function SeatVideo({
  seat,
  stream,
  mine,
}: {
  seat: HoldemSeatView;
  stream: MediaStream | null;
  mine: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const showVideo = !!stream;
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-black">
      {showVideo ? (
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{
            transform: `scale(1.55) translateY(-2%)${mine ? ' scaleX(-1)' : ''}`,
            transformOrigin: 'center 32%',
          }}
        />
      ) : (
        <div className="grid h-full place-items-center bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3] font-display text-5xl font-bold text-white/85">
          {initials(seat.displayName)}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-2 pt-6">
        <p className="truncate font-display text-sm font-bold leading-tight text-white">
          {seat.displayName || `Seat ${seat.index + 1}`}
        </p>
        {!seat.connected && (
          <span className="rounded-full bg-fold/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fold">
            AFK
          </span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase().slice(0, 2) || '·';
}

function CardBack() {
  return (
    <div className="h-14 w-10 rounded-md border border-white/15 bg-gradient-to-br from-[#2b2238] to-[#14101a] sm:h-16 sm:w-12">
      <div className="h-full w-full rounded-md bg-[repeating-linear-gradient(45deg,rgba(255,106,61,.18)_0_6px,transparent_6px_12px)]" />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Action bar
// ----------------------------------------------------------------------------

function ActionBar({
  table,
  mySeat,
  myTurn,
  betDraft,
  setBetDraft,
  room,
}: {
  table: HoldemTableView;
  mySeat: HoldemSeatView | null;
  myTurn: boolean;
  betDraft: number;
  setBetDraft: (n: number) => void;
  room: Room | null;
}) {
  if (!mySeat) {
    return <HoldemBuyInPanel table={table} room={room} />;
  }

  // Broke seat — show top-up regardless of phase.
  if (mySeat.stack === 0 && mySeat.committed === 0) {
    return (
      <div className="rounded-2xl border border-amber/45 bg-black/35 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">Out of chips</p>
        <button
          onClick={() => send(room, { type: 'topUp', amount: 1000 })}
          className="mt-2 w-full rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3 text-base font-bold uppercase tracking-[0.18em] text-white shadow-sunset"
        >
          + 1,000 chips
        </button>
      </div>
    );
  }

  if (!myTurn) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-ink-mute">
        {table.phase === 'between'
          ? 'Next hand starting soon…'
          : table.phase === 'showdown'
          ? 'Showdown — chips coming your way (or someone else’s).'
          : table.phase === 'waiting'
          ? 'Waiting for another player to sit down…'
          : 'Watching the action.'}
      </div>
    );
  }

  const owed = Math.max(0, table.currentBet - mySeat.committed);
  const canCheck = owed === 0;
  const canCall = owed > 0 && mySeat.stack > 0;
  const minOpen = canCheck ? table.bigBlind : table.currentBet + table.minRaise;
  const maxOpen = mySeat.stack + mySeat.committed;
  const draftClamped = Math.min(maxOpen, Math.max(minOpen, betDraft));

  return (
    <div className="rounded-2xl border border-sunset/55 bg-black/40 px-4 py-3 shadow-[0_0_40px_-6px_rgba(255,106,61,.5)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-sunset">
          Your turn · {Math.max(0, Math.ceil(mySeat.turnClockMs / 1000))}s
        </p>
        <p className="text-[10px] uppercase tracking-wider text-ink-mute">
          Stack <span className="text-white">{mySeat.stack}</span>
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ActionBtn
          label="Fold"
          tone="fold"
          onClick={() => send(room, { type: 'fold' })}
        />
        {canCheck ? (
          <ActionBtn label="Check" onClick={() => send(room, { type: 'check' })} />
        ) : (
          <ActionBtn
            label={`Call ${Math.min(owed, mySeat.stack)}`}
            onClick={() => send(room, { type: 'call' })}
            disabled={!canCall}
          />
        )}
        <ActionBtn
          label={canCheck ? `Bet ${draftClamped}` : `Raise to ${draftClamped}`}
          disabled={maxOpen < minOpen}
          onClick={() => {
            if (canCheck) send(room, { type: 'bet', amount: draftClamped });
            else send(room, { type: 'raise', amount: draftClamped });
          }}
        />
        <ActionBtn
          label={`All-in ${mySeat.stack}`}
          onClick={() => send(room, { type: 'allIn' })}
          disabled={mySeat.stack === 0}
        />
      </div>

      {maxOpen >= minOpen && (
        <div className="mt-3">
          <input
            type="range"
            min={minOpen}
            max={maxOpen}
            step={table.bigBlind}
            value={draftClamped}
            onChange={(e) => setBetDraft(Number(e.target.value))}
            className="w-full accent-sunset"
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[
              { label: 'Min', value: minOpen },
              { label: '½ Pot', value: Math.round(potTotal(table) * 0.5) },
              { label: 'Pot', value: potTotal(table) },
              { label: '2× Pot', value: Math.round(potTotal(table) * 2) },
              { label: 'All-in', value: maxOpen },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setBetDraft(clamp(p.value, minOpen, maxOpen))}
                className="rounded-lg border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 hover:bg-black/35"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Pick-a-seat + buy-in surface — mirrors the Blackjack FeltActionPanel so the
// onboarding feels identical across both games.
function HoldemBuyInPanel({
  table,
  room,
}: {
  table: HoldemTableView;
  room: Room | null;
}) {
  const selectedSeatIndex = useStore((s) => s.selectedSeatIndex);
  const setSelectedSeat = useStore((s) => s.setSelectedSeat);
  const target =
    selectedSeatIndex ?? table.seats.find((s) => s.phase === 'empty')?.index ?? null;
  return (
    <div className="relative rounded-3xl border border-amber/45 bg-black/30 px-4 py-4 shadow-[0_0_30px_-10px_rgba(255,177,78,.35)] backdrop-blur-md sm:px-5 sm:py-5">
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-white/[.06] to-transparent" />
      <div className="relative flex flex-col items-center gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber">
          Pick a seat
        </p>
        <div className="grid w-full grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2">
          {table.seats.map((s) => (
            <button
              key={s.index}
              onClick={() => setSelectedSeat(s.index)}
              disabled={s.phase !== 'empty'}
              className={
                'tap-target rounded-xl px-2 py-2 text-[11px] font-bold transition ' +
                (target === s.index
                  ? 'bg-gradient-to-br from-sunset-bright to-sunset text-white shadow-sunset'
                  : s.phase === 'empty'
                  ? 'border border-white/15 bg-black/30 text-ink hover:border-amber/50'
                  : 'border border-white/8 bg-black/20 text-ink-mute opacity-40')
              }
            >
              {s.index + 1}
            </button>
          ))}
        </div>
        <button
          disabled={target == null}
          onClick={() => {
            if (target == null) return;
            send(room, { type: 'sit', seatIndex: target, buyIn: 1000 });
            setSelectedSeat(null);
          }}
          className="tap-target w-full rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3.5 text-base font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          Buy in · 1,000 chips
        </button>
        <p className="text-[10px] text-white/55">
          {table.smallBlind}/{table.bigBlind} blinds · no-limit · free play-money
        </p>
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  tone = 'sunset',
  disabled,
  onClick,
}: {
  label: string;
  tone?: 'sunset' | 'fold';
  disabled?: boolean;
  onClick: () => void;
}) {
  const cls =
    tone === 'fold'
      ? 'border border-fold/40 bg-fold/15 text-[#FF9DAC]'
      : 'bg-gradient-to-br from-sunset-bright to-sunset text-white shadow-sunset';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'rounded-2xl px-3 py-3 text-sm font-bold uppercase tracking-wider transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 ' +
        cls
      }
    >
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

function snapshot(state: any): HoldemTableView {
  // Defensive: early Colyseus state patches can land before every nested
  // ArraySchema has been populated, so guard each iteration with a fallback.
  const safeArr = (x: any): any[] => (x && typeof x[Symbol.iterator] === 'function' ? Array.from(x) : []);
  return {
    name: state?.name ?? '',
    phase: state?.phase ?? 'waiting',
    phaseClockMs: state?.phaseClockMs ?? 0,
    round: state?.round ?? 0,
    buttonSeat: state?.buttonSeat ?? -1,
    smallBlindSeat: state?.smallBlindSeat ?? -1,
    bigBlindSeat: state?.bigBlindSeat ?? -1,
    currentBet: state?.currentBet ?? 0,
    minRaise: state?.minRaise ?? 10,
    smallBlind: state?.smallBlind ?? 5,
    bigBlind: state?.bigBlind ?? 10,
    hostId: state?.hostId ?? '',
    community: safeArr(state?.community).map((c: any) => ({ rank: c.rank, suit: c.suit })),
    pots: safeArr(state?.pots).map((p: any) => ({
      amount: p.amount,
      cap: p.cap,
      eligibleSeats: safeArr(p.eligibleSeats),
    })),
    seats: Array.from({ length: HOLDEM_MAX_SEATS }, (_, i) => {
      const s = state?.seats?.[i];
      if (!s) return emptySeat(i);
      return {
        index: s.index ?? i,
        playerId: s.playerId ?? '',
        identityId: s.identityId ?? '',
        displayName: s.displayName ?? '',
        stack: s.stack ?? 0,
        committed: s.committed ?? 0,
        totalCommitted: s.totalCommitted ?? 0,
        hole: safeArr(s.hole).map((c: any) => ({ rank: c.rank, suit: c.suit })),
        phase: s.phase ?? 'empty',
        isTurn: !!s.isTurn,
        turnClockMs: s.turnClockMs ?? 0,
        connected: s.connected !== false,
        handLabel: s.handLabel ?? '',
        handsPlayed: s.handsPlayed ?? 0,
        handsWon: s.handsWon ?? 0,
        netProfit: s.netProfit ?? 0,
        sittingOut: !!s.sittingOut,
      };
    }),
  };
}

function streamFor(
  seat: HoldemSeatView,
  mySessionId: string | null,
  camStream: MediaStream | null,
  peerStreams: Map<string, MediaStream>,
): MediaStream | null {
  if (seat.playerId === mySessionId) return camStream;
  return peerStreams.get(seat.identityId) ?? null;
}

function send(room: Room | null, action: HoldemAction) {
  if (!room) return;
  room.send(C2S.action, action);
}

function phaseLabel(p: string): string {
  switch (p) {
    case 'preflop': return 'Preflop';
    case 'flop': return 'Flop';
    case 'turn': return 'Turn';
    case 'river': return 'River';
    case 'showdown': return 'Showdown';
    case 'between': return 'Between hands';
    case 'paused': return 'Paused';
    default: return 'Waiting';
  }
}

function potTotal(table: HoldemTableView): number {
  return (
    table.pots.reduce((sum, p) => sum + p.amount, 0) +
    table.seats.reduce((sum, s) => sum + s.committed, 0)
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
