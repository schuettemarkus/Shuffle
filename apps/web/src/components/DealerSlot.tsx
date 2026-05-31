import { useEffect, useRef, useState } from 'react';
import type { TableView } from '../lib/store';
import type { Card } from '@shuffle/shared';
import { PlayingCard, HandValueBadge } from './PlayingCard';

// Dealer's cards are the centerpiece. Rendered at `xl` so eyes land here
// first across the felt. When the hole card flips from face-down to
// face-up, we play a 3D flip animation so the reveal lands with weight.
export function DealerSlot({ table }: { table: TableView }) {
  const flipIndex = useHoleCardFlip(table.dealer.hand);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex min-h-[140px] items-end justify-center gap-2 sm:min-h-[172px]">
        {table.dealer.hand.length === 0 ? (
          <span className="rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-mute backdrop-blur">
            awaiting deal
          </span>
        ) : (
          table.dealer.hand.map((c, i) => (
            <span key={i} className={i === flipIndex ? 'card-flip' : undefined}>
              <PlayingCard card={c} index={i} size="xl" />
            </span>
          ))
        )}
      </div>
      {table.dealer.hand.length > 0 && (
        <HandValueBadge value={table.dealer.handValue} soft={table.dealer.isSoft} size="xl" />
      )}
    </div>
  );
}

// Watch the dealer's hand for a card going from hidden to visible — that's
// the reveal moment. Returns the index to flip for ~600ms, then clears.
function useHoleCardFlip(hand: Card[]): number | null {
  const previous = useRef<Card[]>([]);
  const [flipIndex, setFlipIndex] = useState<number | null>(null);
  useEffect(() => {
    const prev = previous.current;
    for (let i = 0; i < hand.length; i++) {
      const was = prev[i];
      const now = hand[i];
      if (was?.hidden && now && !now.hidden) {
        setFlipIndex(i);
        const t = setTimeout(() => setFlipIndex(null), 650);
        previous.current = hand;
        return () => clearTimeout(t);
      }
    }
    previous.current = hand;
  }, [hand]);
  return flipIndex;
}
