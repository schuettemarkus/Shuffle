// Host control panel anchored to the top-right of the table. Only the room
// creator sees it (we check `table.hostId === mySessionId` on the call site).
// Mirrors Meet's "you're the host" affordances: lock stakes, pause the table,
// kick or mute a seated player.

import { useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S } from '@shuffle/shared';
import type { TableView } from '../lib/store';

interface Props {
  room: Room;
  table: TableView;
  mySessionId: string | null;
}

export function TableHostPanel({ room, table, mySessionId }: Props) {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(table.minBet);
  const [max, setMax] = useState(table.maxBet);
  const [paused, setPaused] = useState(table.phase === 'paused');
  // Keep local state aligned when the server confirms the change.
  if (paused !== (table.phase === 'paused')) setPaused(table.phase === 'paused');

  return (
    <div className="fixed right-3 top-14 z-30 sm:right-6 sm:top-16">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-amber/50 bg-amber/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-amber backdrop-blur"
      >
        ★ Host {open ? 'close' : 'controls'}
      </button>

      {open && (
        <div className="mt-2 w-[min(92vw,340px)] rounded-2xl border border-border-hi bg-surface p-4 shadow-brand">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Stakes
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="Min"
              value={min}
              disabled={table.phase === 'paused'}
              onCommit={(v) => {
                setMin(v);
                room.send(C2S.hostSetStakes, { minBet: v, maxBet: max });
              }}
            />
            <NumberField
              label="Max"
              value={max}
              disabled={table.phase === 'paused'}
              onCommit={(v) => {
                setMax(v);
                room.send(C2S.hostSetStakes, { minBet: min, maxBet: v });
              }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() =>
                room.send(C2S.hostPauseTable, { paused: table.phase !== 'paused' })
              }
              className={
                'rounded-lg px-2.5 py-1.5 text-xs font-bold tap-target ' +
                (table.phase === 'paused'
                  ? 'bg-fold/15 text-fold ring-1 ring-fold/40'
                  : 'border border-border text-ink-soft')
              }
            >
              {table.phase === 'paused' ? '▶ Resume table' : '❚❚ Pause table'}
            </button>
          </div>

          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Seated
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {table.seats
              .filter((s) => s.phase !== 'empty')
              .map((s) => (
                <div
                  key={s.playerId}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg-2 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate text-ink">
                    {s.displayName || `Seat ${s.index + 1}`}
                    {s.playerId === mySessionId && (
                      <span className="ml-1.5 rounded bg-sunset/30 px-1 text-[9px] font-bold uppercase text-sunset">
                        you
                      </span>
                    )}
                  </span>
                  {s.playerId !== mySessionId && (
                    <button
                      onClick={() =>
                        room.send(C2S.hostKick, { sessionId: s.playerId })
                      }
                      className="rounded-md border border-fold/40 bg-fold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fold"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            {table.seats.every((s) => s.phase === 'empty') && (
              <p className="text-xs text-ink-mute">Nobody's seated yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  if (String(value) !== local && document.activeElement?.tagName !== 'INPUT') {
    setLocal(String(value));
  }
  return (
    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">
      {label}
      <input
        type="number"
        value={local}
        disabled={disabled}
        min={5}
        step={5}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Math.max(5, Math.floor(Number(local) || value));
          setLocal(String(n));
          if (n !== value) onCommit(n);
        }}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-ink disabled:opacity-50"
      />
    </label>
  );
}
