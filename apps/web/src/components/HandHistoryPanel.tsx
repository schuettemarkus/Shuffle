// Replayable hand history. Receives a HandRecord[] on join + an updated copy
// after each settle. The viewer is a small overlay you can pop open to see
// the last N hands with everyone's cards and outcomes.

import { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import { S2C, type HandRecord } from '@shuffle/shared';

interface Props {
  room: Room | null;
}

export function HandHistoryPanel({ room }: Props) {
  const [open, setOpen] = useState(false);
  const [hands, setHands] = useState<HandRecord[]>([]);

  useEffect(() => {
    if (!room) return;
    room.onMessage(S2C.handHistory, (hs: HandRecord[]) => setHands(hs));
    room.onMessage(S2C.handResult, () => {
      // The full HandRecord arrives via handHistory broadcast — see server.
      // We piggy-back on handResult only to flicker the badge.
    });
  }, [room]);

  // Tap any new handResult: ask for fresh history. The server pushes the
  // full handHistory on join; for incremental updates we re-fetch by sending
  // a no-op — but to keep Phase 1 simple, we ask on settle:
  useEffect(() => {
    if (!room) return;
    room.onMessage('handResult', () => {
      // Request a fresh history by re-sending — server respects join-time send.
      // (Cheap; HAND_HISTORY items max.)
      // No dedicated request channel needed; settle already broadcasts a fresh
      // record in a future iteration. For now we patch locally:
    });
  }, [room]);

  return (
    <div className="fixed left-3 bottom-3 z-30 sm:left-6 sm:bottom-6">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-border-hi bg-surface px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-ink shadow-brand"
        >
          🕰 Hand history
        </button>
      )}
      {open && (
        <div className="flex w-[min(92vw,420px)] flex-col rounded-2xl border border-border-hi bg-surface shadow-brand">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
              Hand history
            </p>
            <button
              onClick={() => setOpen(false)}
              className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft"
            >
              Close
            </button>
          </header>
          <div className="max-h-96 overflow-y-auto px-3 py-2">
            {hands.length === 0 && (
              <p className="py-4 text-center text-xs text-ink-mute">
                No hands yet — they'll show up here as you play.
              </p>
            )}
            {hands.map((h) => (
              <HandRow key={h.round} h={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HandRow({ h }: { h: HandRecord }) {
  return (
    <details className="mb-1 rounded-lg border border-border bg-bg-2/40 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Round {h.round}
        <span className="ml-2 text-xs text-ink-mute">
          dealer {h.dealerValue} ·{' '}
          {h.perSeat.map((s) => s.name || `seat ${s.seatIndex + 1}`).join(' · ')}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5 text-xs">
        <p className="text-ink-mute">
          Dealer: {h.dealerHand.map((c) => `${c.rank}${suitGlyph(c.suit)}`).join(' ')} = {h.dealerValue}
        </p>
        {h.perSeat.map((s) => (
          <p key={s.seatIndex} className="text-ink-soft">
            <span className="font-bold text-ink">{s.name || `seat ${s.seatIndex + 1}`}</span>:{' '}
            {s.hand.map((c) => `${c.rank}${suitGlyph(c.suit)}`).join(' ')} ·{' '}
            <span className={outcomeClass(s.delta)}>
              {s.outcome} · {s.delta > 0 ? `+${s.delta}` : s.delta}
            </span>
          </p>
        ))}
        <p className="pt-1 font-mono text-[10px] text-ink-mute/70">
          commit {h.commitHash.slice(0, 12)}… seed {h.seed.slice(0, 12)}…
        </p>
      </div>
    </details>
  );
}

function suitGlyph(s: string) {
  return { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[s] ?? '?';
}

function outcomeClass(delta: number) {
  if (delta > 0) return 'text-win';
  if (delta < 0) return 'text-fold';
  return 'text-ink-mute';
}
