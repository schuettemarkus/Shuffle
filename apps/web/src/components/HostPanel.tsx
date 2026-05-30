// Host control panel — only the room creator sees this. Mirrors Meet's host
// model: lock stakes, pause a table, kick a player. Mute lands with LiveKit.

import { useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S } from '@shuffle/shared';
import type { FloorPlayer, FloorTable } from '../lib/store';

interface Props {
  room: Room;
  tables: FloorTable[];
  players: FloorPlayer[];
  mySessionId: string | null;
}

export function HostPanel({ room, tables, players, mySessionId }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = tables.find((t) => t.tableId === editingId) ?? tables[0] ?? null;

  return (
    <div className="fixed right-3 top-3 z-30 sm:right-6 sm:top-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-amber/50 bg-amber/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-amber backdrop-blur"
      >
        <span>★ Host</span>
        <span className="text-amber/70">{open ? 'close' : 'controls'}</span>
      </button>

      {open && (
        <div className="mt-2 w-[min(92vw,360px)] rounded-2xl border border-border-hi bg-surface p-4 shadow-brand">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Tables
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tables.map((t) => (
              <button
                key={t.tableId}
                onClick={() => setEditingId(t.tableId)}
                className={
                  'rounded-lg px-2.5 py-1.5 text-xs font-semibold tap-target ' +
                  (editing?.tableId === t.tableId
                    ? 'bg-elevated text-ink ring-1 ring-amber/40'
                    : 'border border-border text-ink-soft')
                }
              >
                {t.name}
              </button>
            ))}
          </div>

          {editing && <TableHostControls room={room} t={editing} />}

          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Players
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {players.map((p) => (
              <div
                key={p.sessionId}
                className="flex items-center justify-between rounded-lg border border-border bg-bg-2 px-2.5 py-1.5 text-xs"
              >
                <span className="flex items-center gap-2 truncate text-ink">
                  {p.displayName || 'Guest'}
                  {p.host && (
                    <span className="rounded bg-amber/30 px-1 text-[9px] font-bold uppercase text-amber">
                      host
                    </span>
                  )}
                  {p.sessionId === mySessionId && (
                    <span className="rounded bg-sunset/30 px-1 text-[9px] font-bold uppercase text-sunset">
                      you
                    </span>
                  )}
                </span>
                {p.sessionId !== mySessionId && (
                  <button
                    onClick={() =>
                      room.send(C2S.hostKick, { sessionId: p.sessionId })
                    }
                    className="rounded-md border border-fold/40 bg-fold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fold"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TableHostControls({ room, t }: { room: Room; t: FloorTable }) {
  const [min, setMin] = useState(t.minBet);
  const [max, setMax] = useState(t.maxBet);

  return (
    <div className="mt-3 rounded-xl border border-border bg-bg-2/60 p-3">
      <p className="font-display text-sm font-bold">{t.name}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <NumberField
          label="Min"
          value={min}
          disabled={t.stakesLocked}
          onCommit={(v) => {
            setMin(v);
            room.send(C2S.hostSetStakes, { tableId: t.tableId, minBet: v, maxBet: max });
          }}
        />
        <NumberField
          label="Max"
          value={max}
          disabled={t.stakesLocked}
          onCommit={(v) => {
            setMax(v);
            room.send(C2S.hostSetStakes, { tableId: t.tableId, minBet: min, maxBet: v });
          }}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          onClick={() =>
            room.send(C2S.hostLockStakes, { tableId: t.tableId, locked: !t.stakesLocked })
          }
          className={
            'rounded-lg px-2.5 py-1.5 text-xs font-bold tap-target ' +
            (t.stakesLocked
              ? 'bg-amber/20 text-amber ring-1 ring-amber/40'
              : 'border border-border text-ink-soft')
          }
        >
          {t.stakesLocked ? '🔒 Stakes locked' : 'Lock stakes'}
        </button>
        <button
          onClick={() =>
            room.send(C2S.hostPauseTable, { tableId: t.tableId, paused: !t.paused })
          }
          className={
            'rounded-lg px-2.5 py-1.5 text-xs font-bold tap-target ' +
            (t.paused
              ? 'bg-fold/15 text-fold ring-1 ring-fold/40'
              : 'border border-border text-ink-soft')
          }
        >
          {t.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
      </div>
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
