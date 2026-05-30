// The on-screen control surface. Mirrors the controller mapping 1:1 so
// behavior is identical on a laptop, on a phone (primary input on touch),
// and on a gamepad.

import type { SeatView, TableView } from '../lib/store';
import { useStore } from '../lib/store';
import { sendAction, sendReaction, sendChipToss } from '../lib/intents';

interface Props {
  table: TableView;
  mySeat: SeatView | null;
}

const PRESETS = [
  { label: 'Min', factor: 0 },
  { label: '½ Pot', factor: 0.5 },
  { label: 'Pot', factor: 1 },
  { label: '2×', factor: 2 },
  { label: 'All-in', factor: 999 },
];

export function TableControls({ table, mySeat }: Props) {
  const room = useStore((s) => s.tableRoom);
  const betDraft = useStore((s) => s.betDraft);
  const setBetDraft = useStore((s) => s.setBetDraft);
  const selectedSeatIndex = useStore((s) => s.selectedSeatIndex);
  const setSelectedSeat = useStore((s) => s.setSelectedSeat);

  // Sit + buy-in flow
  if (!mySeat) {
    const target = selectedSeatIndex ?? table.seats.find((s) => s.phase === 'empty')?.index ?? null;
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-brand">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-mute">
          Choose a seat to begin
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {table.seats.map((s) => (
            <button
              key={s.index}
              onClick={() => setSelectedSeat(s.index)}
              disabled={s.phase !== 'empty'}
              className={
                'rounded-xl px-3 py-2 text-xs font-bold tap-target ' +
                (target === s.index
                  ? 'bg-gradient-to-br from-sunset-bright to-sunset text-white shadow-sunset'
                  : s.phase === 'empty'
                  ? 'border border-border-hi text-ink'
                  : 'border border-border text-ink-mute opacity-50')
              }
            >
              Seat {s.index + 1}
            </button>
          ))}
        </div>
        <button
          disabled={target == null}
          onClick={() => {
            if (target == null) return;
            sendAction(room, { type: 'sit', seatIndex: target, buyIn: 1000 });
          }}
          className="mt-3 w-full rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-3 py-3 text-sm font-bold text-white shadow-sunset disabled:opacity-40"
        >
          Buy in for 1,000 chips
        </button>
      </div>
    );
  }

  // Betting phase
  if (table.phase === 'betting') {
    const stack = mySeat.stack + mySeat.bet; // pre-bet equivalent so slider reflects max
    const min = table.minBet;
    const max = Math.min(table.maxBet, stack);
    const draft = clamp(betDraft, min, max);
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-brand">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-display text-2xl font-bold leading-none">
              {draft} <span className="text-sm text-ink-mute">chips</span>
            </p>
            <p className="text-[11px] text-ink-mute">
              {Math.max(0, Math.ceil(table.phaseClockMs / 1000))}s to lock it in
            </p>
          </div>
          <div className="text-right text-[11px] text-ink-mute">
            Stack {stack} · {table.minBet}–{table.maxBet}
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={25}
          value={draft}
          onChange={(e) => setBetDraft(Number(e.target.value))}
          className="mt-3 w-full accent-sunset"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const v = p.factor === 999 ? max : Math.max(min, Math.round((p.factor || 1) * 100));
                setBetDraft(clamp(v, min, max));
              }}
              className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-soft tap-target"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => sendAction(room, { type: 'bet', amount: draft })}
            className="flex-1 rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-3 py-3 text-sm font-bold text-white shadow-sunset tap-target"
          >
            {mySeat.bet > 0 ? `Update bet · ${draft}` : `Place bet · ${draft}`}
          </button>
          <button
            onClick={() => sendAction(room, { type: 'leave' })}
            className="rounded-xl border border-border-hi bg-elevated px-3 py-3 text-xs font-semibold text-ink-soft tap-target"
          >
            Cash out
          </button>
        </div>
        <SocialRow />
      </div>
    );
  }

  // Playing phase — actions for the acting seat; passive otherwise.
  if (table.phase === 'playing' && mySeat.isTurn) {
    return (
      <div className="rounded-2xl border border-sunset/50 bg-surface p-4 shadow-sunset">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sunset">
          Your turn · {Math.max(0, Math.ceil(mySeat.turnClockMs / 1000))}s
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ActionBtn label="Hit" hint="A" onClick={() => sendAction(room, { type: 'hit' })} />
          <ActionBtn label="Stand" hint="X" onClick={() => sendAction(room, { type: 'standHand' })} />
          <ActionBtn
            label="Double"
            hint="Y"
            disabled={mySeat.hand.length !== 2 || mySeat.stack < mySeat.bet}
            onClick={() => sendAction(room, { type: 'double' })}
          />
          <ActionBtn
            label="Surrender"
            tone="fold"
            hint="B"
            disabled={mySeat.hand.length !== 2}
            onClick={() => sendAction(room, { type: 'surrender' })}
          />
        </div>
        <SocialRow />
      </div>
    );
  }

  // Other states — show a quiet status pane.
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-brand">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-mute">Status</p>
      <p className="mt-1 text-sm text-ink">
        {table.phase === 'dealer' && 'Dealer is drawing…'}
        {table.phase === 'settling' && 'Settling the hand…'}
        {table.phase === 'waiting' && 'Waiting for the table to fill.'}
        {table.phase === 'playing' && !mySeat.isTurn && 'Watching the action.'}
        {table.phase === 'dealing' && 'Dealing…'}
        {table.phase === 'paused' && 'Host paused the table.'}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => sendAction(room, { type: 'leave' })}
          className="rounded-xl border border-border-hi bg-elevated px-3 py-2 text-xs font-semibold text-ink-soft tap-target"
        >
          Leave seat
        </button>
      </div>
      <SocialRow />
    </div>
  );
}

function ActionBtn({
  label,
  hint,
  tone = 'sunset',
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  tone?: 'sunset' | 'fold';
  disabled?: boolean;
  onClick: () => void;
}) {
  const cls =
    tone === 'fold'
      ? 'border border-fold/40 bg-fold/10 text-[#FF9DAC]'
      : 'bg-gradient-to-br from-sunset-bright to-sunset text-white shadow-sunset';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'tap-target relative rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-40 ' + cls
      }
    >
      {label}
      <span className="absolute right-2 top-1 rounded bg-black/30 px-1.5 py-0.5 text-[9px] font-bold opacity-80">
        {hint}
      </span>
    </button>
  );
}

function SocialRow() {
  const room = useStore((s) => s.tableRoom);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {(['cheers', 'facepalm', 'clap', 'taunt'] as const).map((e) => (
        <button
          key={e}
          onClick={() => sendReaction(room, e)}
          className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-base tap-target"
          title={e}
        >
          {emoteIcon(e)}
        </button>
      ))}
      <button
        onClick={() => sendChipToss(room)}
        className="ml-auto rounded-lg border border-border-hi bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-soft tap-target"
        title="R3 — toss a chip"
      >
        🪙 Toss
      </button>
    </div>
  );
}

function emoteIcon(e: 'cheers' | 'facepalm' | 'clap' | 'taunt') {
  return { cheers: '🥂', facepalm: '🤦', clap: '👏', taunt: '😏' }[e];
}

function clamp(n: number, lo: number, hi: number) {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
