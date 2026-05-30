import type { SeatView } from '../lib/store';
import { PlayingCard, HandValueBadge } from './PlayingCard';

interface Props {
  seat: SeatView;
  isMine: boolean;
  onSit?: () => void;
}

export function Seat({ seat, isMine, onSit }: Props) {
  const empty = seat.phase === 'empty';
  return (
    <div
      className={
        'flex flex-col items-center gap-2 rounded-2xl border p-2 transition sm:p-3 ' +
        (seat.isTurn
          ? 'border-sunset/70 bg-surface shadow-sunset animate-pulseSunset'
          : isMine
          ? 'border-amber/40 bg-surface'
          : empty
          ? 'border-dashed border-border bg-black/20'
          : 'border-border bg-surface/70')
      }
    >
      {empty ? (
        <button
          onClick={onSit}
          className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl px-3 py-4 text-xs font-bold text-ink-soft transition hover:text-sunset sm:py-6"
        >
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink-mute">Seat {seat.index + 1}</span>
          <span className="text-sm">Sit down →</span>
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold leading-none">
              {seat.displayName || `Seat ${seat.index + 1}`}
            </span>
            {!seat.connected && (
              <span className="rounded-full bg-fold/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fold">
                Reconnecting…
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 text-[11px] text-ink-mute">
            <span>
              <span className="text-ink">{seat.stack}</span> chips
            </span>
            {seat.bet > 0 && <span className="text-amber">· bet {seat.bet}</span>}
          </div>
          <div className="flex min-h-[72px] items-end justify-center gap-1 sm:min-h-[96px]">
            {seat.hand.length === 0 ? (
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-mute">
                {seat.phase === 'betting' ? 'placing bet…' : 'waiting'}
              </span>
            ) : (
              seat.hand.map((c, i) => (
                <PlayingCard key={i} card={c} index={i} />
              ))
            )}
          </div>
          {seat.hand.length > 0 && (
            <HandValueBadge value={seat.handValue} soft={seat.isSoft} />
          )}
          <PhaseChip phase={seat.phase} />
        </>
      )}
    </div>
  );
}

function PhaseChip({ phase }: { phase: SeatView['phase'] }) {
  const label = {
    empty: '',
    waiting: 'Waiting',
    betting: 'Bet placed',
    playing: 'Your turn',
    standing: 'Stand',
    busted: 'Bust',
    blackjack: 'Blackjack!',
    surrendered: 'Surrender',
    settled: '',
  }[phase];
  if (!label) return null;
  const color =
    phase === 'busted' || phase === 'surrendered'
      ? 'text-fold bg-fold/15'
      : phase === 'blackjack'
      ? 'text-win bg-win/15'
      : phase === 'playing'
      ? 'text-sunset bg-sunset/15'
      : 'text-ink-mute bg-ink-mute/10';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color}`}>
      {label}
    </span>
  );
}
