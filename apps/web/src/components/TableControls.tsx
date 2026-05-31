// The on-screen control surface — now anchored ON the felt, inside the bet
// circle. Mirrors the controller mapping 1:1 so behavior is identical on a
// laptop, on a phone (primary input on touch), and on a gamepad.
//
// Styling assumes a teal felt behind it: translucent surfaces, warm borders,
// sunset accents. We don't paint an opaque card here — the felt is the card.

import type { Room } from 'colyseus.js';
import type { SeatView, TableView } from '../lib/store';
import { useStore } from '../lib/store';
import { sendAction } from '../lib/intents';

interface Props {
  table: TableView;
  mySeat: SeatView | null;
  // Optional: the parent passes the live Colyseus room so we don't have to
  // re-subscribe to the store inside this component. (Falls back to the store
  // if not provided.)
  room?: Room | null;
}

const PRESETS = [
  { label: 'Min', factor: 0 },
  { label: '½ Pot', factor: 0.5 },
  { label: 'Pot', factor: 1 },
  { label: '2×', factor: 2 },
  { label: 'All-in', factor: 999 },
];

// The panel that sits on the felt. It changes shape based on phase:
//   - not seated → seat picker + buy-in
//   - betting    → bet slider + presets + place-bet
//   - your turn  → hit/stand/double/split/surrender
//   - other      → quiet status line
export function FeltActionPanel({ table, mySeat, room: roomProp }: Props) {
  const storeRoom = useStore((s) => s.tableRoom);
  const room = roomProp ?? storeRoom;
  const betDraft = useStore((s) => s.betDraft);
  const setBetDraft = useStore((s) => s.setBetDraft);
  const selectedSeatIndex = useStore((s) => s.selectedSeatIndex);
  const setSelectedSeat = useStore((s) => s.setSelectedSeat);

  // --- Not seated: seat picker + buy-in, drawn into the bet circle. ---
  if (!mySeat) {
    const target = selectedSeatIndex ?? table.seats.find((s) => s.phase === 'empty')?.index ?? null;
    return (
      <FeltPanel tone="invite">
        <div className="flex flex-col items-center gap-3">
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
              sendAction(room, { type: 'sit', seatIndex: target, buyIn: 1000 });
            }}
            className="tap-target w-full rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3.5 text-base font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            Buy in · 1,000 chips
          </button>
          <p className="text-[10px] text-white/55">
            Free play-money. Pick any open seat to deal in.
          </p>
        </div>
      </FeltPanel>
    );
  }

  // --- Betting phase: slider lives here, presets below, place-bet wide. ---
  if (table.phase === 'betting') {
    const stack = mySeat.stack + mySeat.bet;
    const min = table.minBet;
    // Out of chips — show a single hero "Buy 1000 chips" button instead of the
    // bet slider. Top-ups are unlimited, free play-money.
    if (stack < min) {
      return (
        <FeltPanel tone="invite">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber">
              You're out of chips
            </p>
            <p className="font-display text-2xl font-bold leading-tight text-white">
              Buy back in?
            </p>
            <button
              onClick={() => sendAction(room, { type: 'topUp', amount: 1000 })}
              className="tap-target mt-1 w-full rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3.5 text-base font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5"
            >
              + 1,000 chips
            </button>
            <p className="text-[10px] text-white/55">
              Unlimited buy-back — play-money & social only.
            </p>
          </div>
        </FeltPanel>
      );
    }
    const max = Math.min(table.maxBet, stack);
    const draft = clamp(betDraft, min, max);
    return (
      <FeltPanel tone="active">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber">
              Place your bet
            </p>
            <p className="mt-1 font-display text-3xl font-bold leading-none text-white">
              {draft}
              <span className="ml-1 text-sm font-medium text-white/60">chips</span>
            </p>
          </div>
          <div className="text-right text-[10px] uppercase tracking-[0.18em] text-white/60">
            <p>{Math.max(0, Math.ceil(table.phaseClockMs / 1000))}s left</p>
            <p className="mt-1">
              Stack <span className="text-white">{stack}</span>
              <button
                onClick={() => sendAction(room, { type: 'topUp', amount: 1000 })}
                className="ml-1 rounded-md border border-amber/45 bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber transition hover:bg-amber/25"
                title="Add 1,000 chips"
              >
                + 1k
              </button>
            </p>
            <p>
              {table.minBet}–{table.maxBet}
            </p>
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
                const v =
                  p.factor === 999 ? max : Math.max(min, Math.round((p.factor || 1) * 100));
                setBetDraft(clamp(v, min, max));
              }}
              className="tap-target rounded-lg border border-white/15 bg-black/25 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/80 hover:bg-black/35"
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => sendAction(room, { type: 'bet', amount: draft })}
          className="tap-target mt-3 w-full rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-3 py-3.5 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5"
        >
          {mySeat.bet > 0 ? `Update · ${draft}` : `Place bet · ${draft}`}
        </button>

        {/* Royal Match side bet — collapsible, paid out at deal time. */}
        <RoyalMatchControl table={table} mySeat={mySeat} room={room} />

      </FeltPanel>
    );
  }

  // --- Acting: hit/stand/double/split/surrender. ---
  if (table.phase === 'playing' && mySeat.isTurn) {
    const canSplit =
      !mySeat.splitActive &&
      mySeat.splitBet === 0 &&
      mySeat.hand.length === 2 &&
      mySeat.stack >= mySeat.bet &&
      sameRank(mySeat.hand[0]?.rank, mySeat.hand[1]?.rank);
    const activeBet = mySeat.splitActive ? mySeat.splitBet : mySeat.bet;
    const activeHandLen = mySeat.splitActive ? mySeat.splitHand.length : mySeat.hand.length;
    const canDouble = activeHandLen === 2 && mySeat.stack >= activeBet;
    const canSurrender = !mySeat.splitActive && mySeat.splitBet === 0 && mySeat.hand.length === 2;
    return (
      <FeltPanel tone="acting">
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-sunset">
          Your turn · {Math.max(0, Math.ceil(mySeat.turnClockMs / 1000))}s
          {mySeat.splitBet > 0 && (
            <span className="ml-2 text-white/60">
              · {mySeat.splitActive ? 'Hand 2' : 'Hand 1'}
            </span>
          )}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <ActionBtn label="Hit" hint="A" onClick={() => sendAction(room, { type: 'hit' })} />
          <ActionBtn label="Stand" hint="X" onClick={() => sendAction(room, { type: 'standHand' })} />
          <ActionBtn
            label="Double"
            hint="Y"
            disabled={!canDouble}
            onClick={() => sendAction(room, { type: 'double' })}
          />
          <ActionBtn
            label="Split"
            hint="LB"
            disabled={!canSplit}
            onClick={() => sendAction(room, { type: 'split' })}
          />
          <ActionBtn
            label="Surrender"
            tone="fold"
            hint="B"
            disabled={!canSurrender}
            onClick={() => sendAction(room, { type: 'surrender' })}
          />
        </div>
      </FeltPanel>
    );
  }

  // --- Waiting for the table to fill — let the seated player tap Deal to
  //     open a betting window immediately instead of staring at the message. ---
  if (table.phase === 'waiting') {
    return (
      <FeltPanel tone="invite">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber">
            Ready when you are
          </p>
          <p className="text-sm text-white/80">
            No one else is here yet — tap Deal to start a hand solo. Friends
            who join later get dealt into the next one.
          </p>
          <button
            onClick={() => sendAction(room, { type: 'ready' })}
            className="tap-target mt-1 w-full rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3.5 text-base font-bold uppercase tracking-[0.18em] text-white shadow-sunset transition hover:-translate-y-0.5"
          >
            Deal me in →
          </button>
        </div>
      </FeltPanel>
    );
  }

  // --- Passive states. ---
  return (
    <FeltPanel tone="status">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/55">
          Status
        </p>
        <p className="mt-1 text-sm text-white">
          {table.phase === 'dealer' && 'Dealer is drawing…'}
          {table.phase === 'settling' && 'Settling the hand…'}
          {table.phase === 'playing' && !mySeat.isTurn && 'Watching the action.'}
          {table.phase === 'dealing' && 'Dealing…'}
          {table.phase === 'paused' && 'Host paused the table.'}
        </p>
      </div>
    </FeltPanel>
  );
}

// Translucent panel that sits on the teal felt. Each tone tweaks the border
// and the glow but keeps the see-through center so the felt reads through.
function FeltPanel({
  tone,
  children,
}: {
  tone: 'invite' | 'active' | 'acting' | 'status';
  children: React.ReactNode;
}) {
  const border =
    tone === 'acting'
      ? 'border-sunset/70 shadow-[0_0_40px_-6px_rgba(255,106,61,.55)]'
      : tone === 'active'
      ? 'border-amber/55 shadow-[0_0_36px_-8px_rgba(255,177,78,.45)]'
      : tone === 'invite'
      ? 'border-amber/45 shadow-[0_0_30px_-10px_rgba(255,177,78,.35)]'
      : 'border-white/15';
  return (
    <div
      className={
        'relative rounded-3xl border bg-black/30 px-4 py-4 backdrop-blur-md sm:px-5 sm:py-5 ' +
        border
      }
    >
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-white/[.06] to-transparent" />
      <div className="relative">{children}</div>
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
  // `hint` (the keyboard/controller key) used to render as an absolute pill in
  // the corner of the button, but it overlapped short labels like "Hit" /
  // "Stand" once the buttons were laid out narrow in a 5-column grid. We just
  // drop it — power users learn the shortcuts from the help screen.
  hint?: string;
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
        // Tight padding + normal tracking + truncate so longer labels like
        // "Surrender" / "Double" don't bleed past the button in the 5-column
        // grid. Min-w-0 lets the truncate kick in on narrow containers.
        'tap-target min-w-0 truncate rounded-2xl px-2 py-2.5 text-[13px] font-bold uppercase tracking-normal transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 sm:text-sm ' +
        cls
      }
    >
      {label}
    </button>
  );
}

function clamp(n: number, lo: number, hi: number) {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function sameRank(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const tens = new Set(['10', 'J', 'Q', 'K']);
  return tens.has(a) && tens.has(b);
}

// Royal Match opt-in chip. One toggle for the table-minimum (cheap), one
// chip-stack glyph to amplify ("a bet that pays 25:1 when both your cards are
// the same suit"). Posted with the main bet; resolved server-side at deal.
function RoyalMatchControl({
  table,
  mySeat,
  room,
}: {
  table: TableView;
  mySeat: SeatView;
  room: Room | null;
}) {
  const active = mySeat.royalMatchBet > 0;
  const options = unique([table.minBet, table.minBet * 2, table.minBet * 5])
    .filter((v) => v <= mySeat.stack + mySeat.royalMatchBet);
  if (options.length === 0) return null;
  const place = (amount: number) => {
    sendAction(room, { type: 'royalMatch', amount });
  };
  return (
    <div className="mt-3 rounded-xl border border-amber/30 bg-gradient-to-br from-amber/10 to-rose/10 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-amber">
          <span aria-hidden>👑</span>
          Royal Match
          <span className="rounded bg-black/30 px-1.5 py-0.5 text-[8px] tracking-wider text-amber/90">
            25:1 · 5:2
          </span>
        </div>
        <span className="text-[10px] text-white/55">
          Suited K+Q wins big · any suited pair pays 5:2
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => place(0)}
          className={
            'tap-target rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition ' +
            (!active
              ? 'border-amber/40 bg-amber/15 text-amber'
              : 'border-white/12 bg-black/25 text-white/65')
          }
        >
          Off
        </button>
        {options.map((amount) => (
          <button
            key={amount}
            onClick={() => place(amount)}
            className={
              'tap-target rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition ' +
              (mySeat.royalMatchBet === amount
                ? 'border-amber/70 bg-gradient-to-br from-amber to-sunset text-black shadow-[0_0_18px_-4px_rgba(255,177,78,.6)]'
                : 'border-white/15 bg-black/25 text-white/85 hover:bg-black/40')
            }
          >
            +{amount}
          </button>
        ))}
        {active && (
          <span className="ml-auto text-[10px] font-semibold text-amber">
            Wagered: {mySeat.royalMatchBet}
          </span>
        )}
      </div>
    </div>
  );
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// Kept as a backwards-compatible alias for any older import sites. The new
// canonical export is FeltActionPanel — it renders the same UI but tuned to
// sit on the felt directly.
export const TableControls = FeltActionPanel;
