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

export type PlayingCardSize = 'sm' | 'lg' | 'xl';

export function PlayingCard({
  card,
  index = 0,
  size = 'sm',
}: {
  card: Card;
  index?: number;
  size?: PlayingCardSize;
}) {
  const hidden = card.hidden;
  const dims =
    size === 'xl'
      ? 'h-[132px] w-[92px] sm:h-[168px] sm:w-[120px]'
      : size === 'lg'
      ? 'h-[108px] w-[76px] sm:h-[140px] sm:w-[100px]'
      : 'h-[68px] w-[48px] sm:h-[88px] sm:w-[64px]';
  const rankCls =
    size === 'xl'
      ? 'text-lg sm:text-2xl'
      : size === 'lg'
      ? 'text-[16px] sm:text-xl'
      : 'text-[11px] sm:text-sm';
  const pipCls =
    size === 'xl'
      ? 'text-xl sm:text-3xl'
      : size === 'lg'
      ? 'text-[17px] sm:text-2xl'
      : 'text-[12px] sm:text-base';
  const centerCls =
    size === 'xl'
      ? 'text-5xl sm:text-6xl'
      : size === 'lg'
      ? 'text-4xl sm:text-5xl'
      : 'text-2xl sm:text-3xl';
  return (
    <div
      className={'card-enter relative rounded-lg ' + dims + ' ' + (hidden ? 'bj-card-back' : 'bj-card')}
      style={{ animationDelay: `${index * 110}ms` }}
    >
      {!hidden && (
        <>
          <div
            className={'absolute left-1 top-1 font-display font-bold leading-none ' + rankCls}
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {card.rank}
            <div className={'leading-none ' + pipCls}>{SUIT_GLYPH[card.suit]}</div>
          </div>
          <div
            className={'absolute right-1 bottom-1 rotate-180 font-display font-bold leading-none ' + rankCls}
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {card.rank}
            <div className={'leading-none ' + pipCls}>{SUIT_GLYPH[card.suit]}</div>
          </div>
          <div
            className={'absolute inset-0 flex items-center justify-center ' + centerCls}
            style={{ color: SUIT_COLOR[card.suit] }}
          >
            {SUIT_GLYPH[card.suit]}
          </div>
        </>
      )}
    </div>
  );
}

export function HandValueBadge({
  value,
  soft,
  size = 'sm',
}: {
  value: number;
  soft: boolean;
  size?: PlayingCardSize;
}) {
  const cls =
    size === 'xl'
      ? 'rounded-xl bg-black/60 px-4 py-1.5 text-xl font-display font-bold tracking-tight text-amber backdrop-blur shadow-[0_0_18px_-6px_rgba(255,177,78,.5)]'
      : size === 'lg'
      ? 'rounded-lg bg-black/55 px-3 py-1 text-base font-bold tracking-tight text-ink backdrop-blur'
      : 'rounded-md bg-bg-2/80 px-2 py-0.5 text-[11px] font-bold tracking-tight text-ink backdrop-blur';
  return (
    <span className={cls}>
      {soft ? `${value - 10} / ${value}` : value}
    </span>
  );
}
