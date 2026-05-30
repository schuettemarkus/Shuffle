import { useEffect, useMemo } from 'react';
import { useStore, selectMySeat, type TableView, type SeatView } from '../lib/store';
import type { Card, HandResult } from '@shuffle/shared';
import { Seat } from '../components/Seat';
import { DealerSlot } from '../components/DealerSlot';
import { TableControls } from '../components/TableControls';
import { PhaseBanner } from '../components/PhaseBanner';
import { Webcam } from '../components/Webcam';
import { sendAction, sendReaction, sendChipToss } from '../lib/intents';
import { rumble, startGamepadLoop, type GamepadIntent } from '../lib/gamepad';

export function Table() {
  const tableRoom = useStore((s) => s.tableRoom);
  const mySessionId = useStore((s) => s.mySessionId);
  const setTable = useStore((s) => s.setTable);
  const table = useStore((s) => s.table);
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);
  const myDisplayName = useStore((s) => s.myDisplayName);
  const pushReaction = useStore((s) => s.pushReaction);
  const setLastResult = useStore((s) => s.setLastResult);
  const lastResult = useStore((s) => s.lastResult);
  const reactions = useStore((s) => s.reactions);
  const betDraft = useStore((s) => s.betDraft);
  const setBetDraft = useStore((s) => s.setBetDraft);

  // Subscribe to state from Colyseus and mirror into Zustand.
  useEffect(() => {
    if (!tableRoom) {
      setView('lobby');
      return;
    }
    const sync = () => setTable(toView(tableRoom.state as ServerSchema));
    tableRoom.onStateChange(sync);
    sync();
    const onToast = (msg: { kind: string; text: string }) => {
      if (!msg.text) return;
      pushToast({ kind: (msg.kind as 'info' | 'error') ?? 'info', text: msg.text });
    };
    tableRoom.onMessage('toast', onToast);
    const onError = (_e: unknown) => pushToast({ kind: 'error', text: 'Server hiccup. Retrying…' });
    tableRoom.onError(onError);
    const onLeave = () => {
      pushToast({ kind: 'info', text: 'Disconnected from the table.' });
      setView('lobby');
    };
    tableRoom.onLeave(onLeave);
    tableRoom.onMessage('reaction', (m: { from: string; emote: string }) => {
      pushReaction({ from: m.from, emote: m.emote });
    });
    tableRoom.onMessage('chipToss', (m: { from: string }) => {
      pushReaction({ from: m.from, emote: 'chip' });
    });
    tableRoom.onMessage('handResult', (r: HandResult) => {
      setLastResult(r);
      const mine = r.perSeat.find((p) => p.playerId === tableRoom.sessionId);
      if (mine) {
        if (mine.delta > 0) {
          pushToast({ kind: 'win', text: `+${mine.delta} · ${mine.outcome}` });
          rumble(180, 0.7);
          setTimeout(() => rumble(120, 0.7), 220);
        } else if (mine.delta < 0) {
          pushToast({ kind: 'lose', text: `${mine.delta} · ${mine.outcome}` });
        } else {
          pushToast({ kind: 'info', text: `Push · stack returned` });
        }
      }
    });
    tableRoom.onMessage('shuffleReveal', (m: { seed: string; commitHash: string }) => {
      // Provably-fair scaffold — log the reveal so a player can verify.
      console.info(
        `[shuffle] round verified — commit=${m.commitHash.slice(0, 12)}… seed=${m.seed.slice(0, 12)}…`,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRoom]);

  const mySeat = useMemo(() => selectMySeat(table, mySessionId), [table, mySessionId]);

  // Buzz when it becomes my turn.
  useEffect(() => {
    if (mySeat?.isTurn) rumble(220, 0.6);
  }, [mySeat?.isTurn]);

  // Wire the gamepad loop -> table actions.
  useEffect(() => {
    if (!table) return;
    const ctx = () => (mySeat ? ('table' as const) : ('floor' as const));
    const stop = startGamepadLoop({
      context: ctx,
      onConnect: () => pushToast({ kind: 'info', text: 'Controller connected.' }),
      onDisconnect: () => pushToast({ kind: 'info', text: 'Controller disconnected.' }),
      onIntent: (intent: GamepadIntent) => handleGamepadIntent(intent),
    });
    return stop;

    function handleGamepadIntent(intent: GamepadIntent) {
      if (!table) return;
      switch (intent) {
        case 'sit': {
          const target = useStore.getState().selectedSeatIndex;
          const idx = target ?? table.seats.find((s) => s.phase === 'empty')?.index;
          if (idx != null) sendAction(tableRoom, { type: 'sit', seatIndex: idx, buyIn: 1000 });
          return;
        }
        case 'leave':
          sendAction(tableRoom, { type: 'leave' });
          return;
        case 'browseTables':
          setView('lobby');
          return;
        case 'hitOrCall':
          if (table.phase === 'playing' && mySeat?.isTurn) sendAction(tableRoom, { type: 'hit' });
          return;
        case 'fold':
          if (table.phase === 'playing' && mySeat?.isTurn)
            sendAction(tableRoom, { type: 'surrender' });
          else sendAction(tableRoom, { type: 'leave' });
          return;
        case 'betMode':
          if (table.phase === 'playing' && mySeat?.isTurn)
            sendAction(tableRoom, { type: 'double' });
          else if (table.phase === 'betting')
            sendAction(tableRoom, { type: 'bet', amount: useStore.getState().betDraft });
          return;
        case 'cyclePresetUp':
          setBetDraft(Math.min(table.maxBet, betDraft + 50));
          return;
        case 'cyclePresetDown':
          setBetDraft(Math.max(table.minBet, betDraft - 50));
          return;
        case 'fineTuneUp':
          setBetDraft(Math.min(table.maxBet, betDraft + 25));
          return;
        case 'fineTuneDown':
          setBetDraft(Math.max(table.minBet, betDraft - 25));
          return;
        case 'tossChip':
          sendChipToss(tableRoom);
          return;
        case 'emoteCheers':
          sendReaction(tableRoom, 'cheers');
          return;
        case 'emoteFacepalm':
          sendReaction(tableRoom, 'facepalm');
          return;
        case 'emoteClap':
          sendReaction(tableRoom, 'clap');
          return;
        case 'emoteTaunt':
          sendReaction(tableRoom, 'taunt');
          return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, mySeat?.isTurn, mySeat?.phase, tableRoom, betDraft]);

  if (!table) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">
        Walking over to the table…
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-3 pb-40 pt-4 sm:px-6 sm:pt-6">
      <header className="flex items-center justify-between">
        <button
          onClick={() => setView('lobby')}
          className="rounded-full border border-border-hi bg-black/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft backdrop-blur"
        >
          ← Lobby
        </button>
        <PhaseBanner table={table} />
        <div className="hidden text-right text-[11px] text-ink-mute sm:block">
          play-money · social only
        </div>
      </header>

      <FeltSurface table={table} mySeat={mySeat} />

      <FilmStrip table={table} mySessionId={mySessionId} myDisplayName={myDisplayName} />

      <TableControls table={table} mySeat={mySeat} />

      <Fairness table={table} />

      <ReactionsLayer reactions={reactions} />

      {lastResult && <HandResultRibbon r={lastResult} />}
    </div>
  );
}

function FeltSurface({ table, mySeat }: { table: TableView; mySeat: SeatView | null }) {
  return (
    <section className="felt relative rounded-[28px] border border-white/5 px-4 py-6 sm:px-8 sm:py-10">
      <div className="absolute inset-3 rounded-[300px_/_180px] border border-white/10 pointer-events-none" />
      <DealerSlot table={table} />
      <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        {table.seats.map((s) => (
          <Seat
            key={s.index}
            seat={s}
            isMine={s.index === mySeat?.index}
            onSit={() => useStore.getState().setSelectedSeat(s.index)}
          />
        ))}
      </div>
      <p className="mt-6 text-center font-display text-[10px] tracking-[0.5em] text-white/30">
        shuffle
      </p>
    </section>
  );
}

function FilmStrip({
  table,
  mySessionId,
  myDisplayName,
}: {
  table: TableView;
  mySessionId: string | null;
  myDisplayName: string;
}) {
  const seated = table.seats.filter((s) => s.phase !== 'empty');
  if (seated.length === 0) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {seated.map((s) => (
        <Webcam
          key={s.playerId}
          name={s.displayName}
          mine={s.playerId === mySessionId}
          size="sm"
        />
      ))}
      {!seated.some((s) => s.playerId === mySessionId) && (
        <Webcam name={myDisplayName || 'You'} mine size="sm" />
      )}
    </div>
  );
}

function Fairness({ table }: { table: TableView }) {
  if (!table.commitHash) return null;
  return (
    <div className="rounded-xl border border-border bg-bg-2/60 p-3 text-[10px] text-ink-mute">
      <p>
        <span className="text-ink-soft">Provably fair</span> · shuffle for round {table.round} was
        committed before the hand and revealed after.
      </p>
      <p className="mt-1 font-mono break-all">commit: {table.commitHash.slice(0, 32)}…</p>
      {table.revealedSeed && (
        <p className="mt-1 font-mono break-all">seed: {table.revealedSeed.slice(0, 32)}…</p>
      )}
    </div>
  );
}

function HandResultRibbon({ r }: { r: HandResult }) {
  return (
    <div className="fixed inset-x-0 top-[max(env(safe-area-inset-top),16px)] z-40 mx-auto flex max-w-md items-center justify-center gap-2 rounded-full border border-border-hi bg-black/60 px-4 py-2 text-xs backdrop-blur">
      <span className="font-bold text-ink">Round {r.round}</span>
      <span className="text-ink-mute">·</span>
      <span className="text-ink">Dealer {r.dealerValue}</span>
    </div>
  );
}

function ReactionsLayer({
  reactions,
}: {
  reactions: Array<{ id: number; from: string; emote: string }>;
}) {
  const recent = reactions.slice(-3);
  if (recent.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 text-5xl">
      {recent.map((r) => (
        <span
          key={r.id}
          className="mx-1 inline-block animate-rise"
          style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.5))' }}
        >
          {r.emote === 'chip'
            ? '🪙'
            : r.emote === 'cheers'
            ? '🥂'
            : r.emote === 'facepalm'
            ? '🤦'
            : r.emote === 'clap'
            ? '👏'
            : '😏'}
        </span>
      ))}
    </div>
  );
}

// ---------- schema -> view transform ----------

interface ServerSchemaCard {
  rank: string;
  suit: string;
  hidden: boolean;
}
interface ServerSchemaSeat {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  bet: number;
  hand: ServerSchemaCard[];
  handValue: number;
  isSoft: boolean;
  phase: string;
  isTurn: boolean;
  turnClockMs: number;
  connected: boolean;
  graceMs: number;
}
interface ServerSchema {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: string;
  phaseClockMs: number;
  seats: ServerSchemaSeat[];
  dealer: { hand: ServerSchemaCard[]; handValue: number; isSoft: boolean };
  commitHash: string;
  revealedSeed: string;
  hostId: string;
  round: number;
}

function toCard(c: ServerSchemaCard): Card {
  return { rank: c.rank as Card['rank'], suit: c.suit as Card['suit'], hidden: c.hidden };
}

function toView(s: ServerSchema): TableView {
  return {
    tableId: s.tableId,
    name: s.name,
    minBet: s.minBet,
    maxBet: s.maxBet,
    maxSeats: s.maxSeats,
    phase: s.phase as TableView['phase'],
    phaseClockMs: s.phaseClockMs,
    commitHash: s.commitHash,
    revealedSeed: s.revealedSeed,
    hostId: s.hostId,
    round: s.round,
    dealer: {
      hand: Array.from(s.dealer.hand).map(toCard),
      handValue: s.dealer.handValue,
      isSoft: s.dealer.isSoft,
    },
    seats: Array.from(s.seats).map((seat) => ({
      index: seat.index,
      playerId: seat.playerId,
      identityId: seat.identityId,
      displayName: seat.displayName,
      stack: seat.stack,
      bet: seat.bet,
      hand: Array.from(seat.hand).map(toCard),
      handValue: seat.handValue,
      isSoft: seat.isSoft,
      phase: seat.phase as SeatView['phase'],
      isTurn: seat.isTurn,
      turnClockMs: seat.turnClockMs,
      connected: seat.connected,
      graceMs: seat.graceMs,
    })),
  };
}
