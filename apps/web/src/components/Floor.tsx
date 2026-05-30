// The 2.5D floor — a stylized DOM scene rendered with CSS perspective.
// Tables sit on a tilted plane; players walk across it with smooth avatars.
//
// Per the spec, this is the canvas/DOM upgrade path; React-Three-Fiber lands
// in a future polish pass, not now.

import { useMemo } from 'react';
import { FLOOR_HEIGHT, FLOOR_WIDTH, SIT_RADIUS } from '@shuffle/shared';
import type { FloorPlayer, FloorTable } from '../lib/store';

interface Props {
  players: FloorPlayer[];
  tables: FloorTable[];
  mySessionId: string | null;
  onFloorTap: (x: number, y: number) => void;
  onTableTap: (tableId: string) => void;
}

export function Floor({ players, tables, mySessionId, onFloorTap, onTableTap }: Props) {
  const me = players.find((p) => p.sessionId === mySessionId) ?? null;
  const nearestTable = useMemo(() => {
    if (!me) return null;
    let best: { t: FloorTable; d: number } | null = null;
    for (const t of tables) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      if (!best || d < best.d) best = { t, d };
    }
    return best && best.d <= SIT_RADIUS ? best.t : null;
  }, [me, tables]);

  return (
    <div
      onPointerDown={(e) => {
        // Translate viewport coords to floor coords (% of width/height).
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * FLOOR_WIDTH;
        const y = ((e.clientY - r.top) / r.height) * FLOOR_HEIGHT;
        onFloorTap(x, y);
      }}
      className="relative w-full overflow-hidden rounded-[28px] border border-border bg-bg-2 shadow-brand"
      style={{
        aspectRatio: `${FLOOR_WIDTH} / ${FLOOR_HEIGHT}`,
        background:
          'radial-gradient(120% 80% at 50% 0%, rgba(255,106,61,0.25), transparent 60%),' +
          'radial-gradient(80% 60% at 50% 110%, rgba(43,184,158,0.18), transparent 65%),' +
          'linear-gradient(180deg, #1A1422 0%, #14101A 55%, #0E0814 100%)',
      }}
    >
      {/* Floor grid — subtle horizon lines for depth. */}
      <div className="pointer-events-none absolute inset-0 opacity-25 [mask-image:linear-gradient(180deg,transparent,black_35%,black_85%,transparent)]">
        <div
          className="absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(0deg, rgba(255,228,210,.07) 0 1px, transparent 1px 60px),' +
              'repeating-linear-gradient(90deg, rgba(255,228,210,.07) 0 1px, transparent 1px 60px)',
            transform: 'perspective(800px) rotateX(38deg) translateY(8%) scale(1.4)',
            transformOrigin: '50% 50%',
          }}
        />
      </div>

      {/* Sit-radius halo on the table you're standing near. */}
      {nearestTable && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-sunset/40 bg-sunset/5 animate-pulseSunset"
          style={{
            left: `${nearestTable.x}%`,
            top: `${nearestTable.y}%`,
            width: `${SIT_RADIUS * 2.2}%`,
            height: `${SIT_RADIUS * 2.2 * (FLOOR_WIDTH / FLOOR_HEIGHT)}%`,
          }}
        />
      )}

      {/* Tables */}
      {tables.map((t) => (
        <TableMarker key={t.tableId} t={t} onTap={() => onTableTap(t.tableId)} highlighted={nearestTable?.tableId === t.tableId} />
      ))}

      {/* Players */}
      {players.map((p) => (
        <Avatar key={p.sessionId} p={p} mine={p.sessionId === mySessionId} />
      ))}

      {/* Floor label */}
      <div className="pointer-events-none absolute left-1/2 bottom-3 -translate-x-1/2 font-display text-[10px] tracking-[0.5em] text-white/30">
        the floor
      </div>
    </div>
  );
}

function TableMarker({
  t,
  onTap,
  highlighted,
}: {
  t: FloorTable;
  onTap: () => void;
  highlighted: boolean;
}) {
  const heat = heatPresentation(t.heatState, t.heat);
  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className="group absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer tap-target"
      style={{ left: `${t.x}%`, top: `${t.y}%` }}
    >
      <div
        className={
          'relative flex items-center justify-center rounded-full border transition ' +
          (highlighted
            ? 'border-sunset/70 shadow-sunset'
            : 'border-white/10 group-hover:border-white/30')
        }
        style={{
          width: 'clamp(76px, 12vw, 132px)',
          aspectRatio: '5 / 3',
          background:
            'radial-gradient(120% 120% at 50% 0%, #14706a, #0E5C57 55%, #093F3C 100%)',
          boxShadow: 'inset 0 2px 24px rgba(0,0,0,.45), 0 18px 40px -20px rgba(0,0,0,.7)',
        }}
      >
        <span className="font-display text-[10px] tracking-[0.4em] text-white/40">
          {t.game === 'blackjack' ? 'BJ' : '??'}
        </span>
        {t.paused && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
            Paused
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-col items-center gap-1">
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur"
          style={{ background: heat.bg, color: heat.fg }}
        >
          <span>{heat.icon}</span>
          <span>{t.name}</span>
          <span className="opacity-80">{t.seatsTaken}/{t.maxSeats}</span>
        </span>
      </div>
    </button>
  );
}

function Avatar({ p, mine }: { p: FloorPlayer; mine: boolean }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-transform"
      style={{
        left: `${p.x}%`,
        top: `${p.y}%`,
        transitionDuration: '120ms',
        transitionTimingFunction: 'linear',
      }}
    >
      <div
        className={
          'flex h-10 w-10 items-center justify-center rounded-full border-2 font-display text-xs font-bold tracking-tight sm:h-12 sm:w-12 ' +
          (mine
            ? 'border-sunset bg-gradient-to-br from-sunset-bright to-sunset text-white shadow-sunset'
            : 'border-white/30 bg-elevated text-ink')
        }
      >
        {initials(p.displayName)}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-center">
        <span
          className={
            'rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur ' +
            (mine ? 'text-sunset' : 'text-ink-soft')
          }
        >
          {p.displayName || 'Guest'}
        </span>
        {p.host && (
          <span className="rounded-md bg-amber/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
            Host
          </span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase().slice(0, 2);
}

function heatPresentation(state: string, value: number) {
  switch (state) {
    case 'on_fire':
      return { icon: '🔥', label: 'On Fire', bg: 'rgba(255,77,46,.92)', fg: '#fff' };
    case 'buzzing':
      return { icon: '⚡', label: 'Buzzing', bg: 'rgba(255,177,78,.92)', fg: '#1a0f04' };
    case 'cruising':
      return { icon: '😎', label: 'Cruising', bg: 'rgba(43,184,158,.92)', fg: '#06231f' };
    case 'cold':
      return { icon: '🧊', label: 'Cold', bg: 'rgba(91,199,230,.9)', fg: '#062430' };
    case 'graveyard':
    default:
      return value >= 50
        ? { icon: '⚡', label: 'Buzzing', bg: 'rgba(255,177,78,.92)', fg: '#1a0f04' }
        : { icon: '💀', label: 'Graveyard', bg: 'rgba(138,129,148,.85)', fg: '#fff' };
  }
}
