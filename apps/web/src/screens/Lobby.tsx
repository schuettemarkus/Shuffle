import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { joinLobby, joinBlackjack } from '../lib/colyseus';
import type { Room } from 'colyseus.js';

interface LobbyTableRow {
  tableId: string;
  name: string;
  game: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatsTaken: number;
  inHand: boolean;
  heat: number;
  heatState: string;
}

export function Lobby() {
  const { myDisplayName, myIdentityId, setLobbyRoom, setTableRoom, setView, pushToast } =
    useStore();
  const [tables, setTables] = useState<LobbyTableRow[]>([]);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let room: Room | null = null;
    let cancelled = false;
    (async () => {
      try {
        room = await joinLobby();
        if (cancelled) {
          room.leave();
          return;
        }
        setLobbyRoom(room);
        const sync = () => {
          const t = room!.state as unknown as {
            tables: Map<string, LobbyTableRow>;
          };
          setTables(Array.from(t.tables.values()).map((r) => ({ ...r })));
        };
        room.onStateChange(sync);
        sync();
      } catch (err) {
        pushToast({ kind: 'error', text: 'Could not reach the floor.' });
        console.warn(err);
      }
    })();
    return () => {
      cancelled = true;
      if (room) {
        room.leave();
        setLobbyRoom(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enterTable = async (id: string) => {
    if (joining) return;
    setJoining(id);
    try {
      const r = await joinBlackjack({
        identityId: myIdentityId,
        displayName: myDisplayName || 'Guest',
      });
      setTableRoom(r, r.sessionId);
      setView('table');
    } catch (e) {
      pushToast({ kind: 'error', text: 'Could not join that table.' });
      console.warn(e);
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pb-32 pt-10 sm:pt-14">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sunset">
            The floor
          </p>
          <h2 className="font-display text-3xl font-bold leading-none tracking-tight sm:text-4xl">
            Pull up a chair, {myDisplayName || 'friend'}.
          </h2>
          <p className="mt-2 max-w-md text-sm text-ink-mute">
            Walk over to any open seat. Play-money chips on the house — yours never leave.
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-mute">
            Tonight
          </p>
          <p className="font-display text-2xl font-bold">Sunset Lounge</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <TableCard key={t.tableId} t={t} onJoin={() => enterTable(t.tableId)} joining={joining === t.tableId} />
        ))}
      </div>

      <FloorNote />
    </div>
  );
}

function TableCard({
  t,
  onJoin,
  joining,
}: {
  t: LobbyTableRow;
  onJoin: () => void;
  joining: boolean;
}) {
  const heat = heatPresentation(t.heatState, t.heat);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-brand transition hover:-translate-y-1 hover:border-border-hi">
      <div className="relative h-24 felt">
        <span
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-md"
          style={{ background: heat.bg, color: heat.fg }}
        >
          <span>{heat.icon}</span> {heat.label}
        </span>
        <span className="absolute right-3 top-3 text-xs font-semibold text-white/85">
          {t.seatsTaken} / {t.maxSeats}
        </span>
      </div>
      <div className="p-4">
        <p className="font-display text-base font-bold tracking-tight">{t.name}</p>
        <p className="mt-0.5 text-xs text-ink-mute">
          Blackjack · {t.minBet} – {t.maxBet} min/max
        </p>
        <button
          onClick={onJoin}
          disabled={joining}
          className="mt-4 w-full rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-3 py-2.5 text-sm font-bold text-white shadow-sunset disabled:opacity-50"
        >
          {joining ? 'Walking over…' : 'Sit down →'}
        </button>
      </div>
    </div>
  );
}

function FloorNote() {
  return (
    <p className="mx-auto mt-10 max-w-md text-center text-xs text-ink-mute">
      More games (Hold'em), spatial audio, segmented backgrounds, and the Heat Index land in later
      phases. Tonight: one Blackjack table, fully playable.
    </p>
  );
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
    case 'rollercoaster':
      return { icon: '🎢', label: 'Rollercoaster', bg: 'rgba(255,92,158,.9)', fg: '#fff' };
    case 'whale_watch':
      return { icon: '🐳', label: 'Whale Watch', bg: 'rgba(70,160,230,.9)', fg: '#fff' };
    case 'heater':
      return { icon: '🍀', label: 'Heater', bg: 'rgba(255,203,82,.92)', fg: '#1a1206' };
    case 'graveyard':
    default:
      return value >= 50
        ? { icon: '⚡', label: 'Buzzing', bg: 'rgba(255,177,78,.92)', fg: '#1a0f04' }
        : { icon: '💀', label: 'Graveyard', bg: 'rgba(138,129,148,.85)', fg: '#fff' };
  }
}
