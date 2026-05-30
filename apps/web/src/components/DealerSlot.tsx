import type { TableView } from '../lib/store';
import { PlayingCard, HandValueBadge } from './PlayingCard';

export function DealerSlot({ table }: { table: TableView }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 rounded-full bg-bg-2/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
        Dealer
      </div>
      <div className="flex min-h-[72px] items-end justify-center gap-1 sm:min-h-[96px]">
        {table.dealer.hand.length === 0 ? (
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-mute">awaiting deal</span>
        ) : (
          table.dealer.hand.map((c, i) => <PlayingCard key={i} card={c} index={i} />)
        )}
      </div>
      {table.dealer.hand.length > 0 && (
        <HandValueBadge value={table.dealer.handValue} soft={table.dealer.isSoft} />
      )}
    </div>
  );
}
