import type { Card } from '@shuffle/shared';

const SUIT_GLYPH: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_COLOR: Record<string, string> = {
  spades: '#14101A',
  clubs: '#14101A',
  hearts: '#E0556B',
  diamonds: '#E0556B',
};

export function PlayingCard({ card, index = 0 }: { card: Card; index?: number }) {
  const hidden = card.hidden;
  return (
    <div
      className={
        'card-enter relative h-[68px] w-[48px] rounded-lg sm:h-[88px] sm:w-[64px] ' +
        (hidden ? 'bj-card-back' : 'bj-card')
      }
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {!hidden && (
        <>
          <div
            className="absolute left-1 top-1 font-display text-[11px] font-bold leading-none sm:text-sm"
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {card.rank}
            <div className="text-[12px] leading-none sm:text-base">{SUIT_GLYPH[card.suit]}</div>
          </div>
          <div
            className="absolute right-1 bottom-1 rotate-180 font-display text-[11px] font-bold leading-none sm:text-sm"
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {card.rank}
            <div className="text-[12px] leading-none sm:text-base">{SUIT_GLYPH[card.suit]}</div>
          </div>
          <div
            className="absolute inset-0 flex items-center justify-center text-2xl sm:text-3xl"
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {SUIT_GLYPH[card.suit]}
          </div>
        </>
      )}
    </div>
  );
}

export function HandValueBadge({ value, soft }: { value: number; soft: boolean }) {
  return (
    <span className="rounded-md bg-bg-2/80 px-2 py-0.5 text-[11px] font-bold tracking-tight text-ink backdrop-blur">
      {soft ? `${value - 10} / ${value}` : value}
    </span>
  );
}
