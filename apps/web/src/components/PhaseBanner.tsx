import type { TableView } from '../lib/store';

export function PhaseBanner({ table }: { table: TableView }) {
  const label =
    table.phase === 'betting'
      ? 'Place your bets'
      : table.phase === 'dealing'
      ? 'Dealing…'
      : table.phase === 'playing'
      ? 'Acting'
      : table.phase === 'dealer'
      ? 'Dealer draws'
      : table.phase === 'settling'
      ? 'Settling'
      : table.phase === 'paused'
      ? 'Paused'
      : 'Waiting for players';
  return (
    <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-border-hi bg-black/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink backdrop-blur">
      <span className="text-sunset">Blackjack</span>
      <span>{label}</span>
      <span className="text-ink-mute">{table.name}</span>
    </div>
  );
}
