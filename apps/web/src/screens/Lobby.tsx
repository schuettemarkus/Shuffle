// The lobby is a living floor: every connected player is an avatar walking
// across a 2.5D plane, tables are objects you can walk over to, and the host
// gets a control panel. Walking via WASD/arrows on desktop, virtual joystick
// on mobile, left stick on a controller, or tap anywhere to travel.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S, SIT_RADIUS } from '@shuffle/shared';
import { useStore, type FloorPlayer, type FloorTable } from '../lib/store';
import { joinLobby, joinBlackjack } from '../lib/colyseus';
import { Floor } from '../components/Floor';
import { TouchStick } from '../components/TouchStick';
import { HostPanel } from '../components/HostPanel';
import { startWalking } from '../lib/walking';

interface ServerPlayer {
  sessionId: string;
  identityId: string;
  displayName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  host: boolean;
  connected: boolean;
  walkingTo: string;
  hasTarget: boolean;
}

interface ServerTable {
  tableId: string;
  name: string;
  game: string;
  x: number;
  y: number;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatsTaken: number;
  inHand: boolean;
  heat: number;
  heatState: string;
  stakesLocked: boolean;
  paused: boolean;
}

interface ServerLobbyState {
  players: Map<string, ServerPlayer>;
  tables: Map<string, ServerTable>;
  hostId: string;
  playersOnline: number;
}

export function Lobby() {
  const {
    myDisplayName,
    myIdentityId,
    lobbyRoom,
    setLobbyRoom,
    setTableRoom,
    setView,
    pushToast,
  } = useStore();

  const [players, setPlayers] = useState<FloorPlayer[]>([]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [hostId, setHostId] = useState<string>('');
  const [mySessionId, setMySessionId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);

  useEffect(() => {
    let room: Room | null = null;
    let cancelled = false;
    (async () => {
      try {
        room = await joinLobby({
          identityId: myIdentityId,
          displayName: myDisplayName || 'Guest',
        });
        if (cancelled) {
          room.leave();
          return;
        }
        setLobbyRoom(room);
        setMySessionId(room.sessionId);
        const sync = () => {
          const s = room!.state as unknown as ServerLobbyState;
          setHostId(s.hostId);
          setPlayers(
            Array.from(s.players.values()).map((p) => ({
              sessionId: p.sessionId,
              identityId: p.identityId,
              displayName: p.displayName,
              x: p.x,
              y: p.y,
              vx: p.vx,
              vy: p.vy,
              facing: p.facing,
              host: p.host,
              connected: p.connected,
              walkingTo: p.walkingTo,
              hasTarget: p.hasTarget,
            })),
          );
          setTables(Array.from(s.tables.values()).map((t) => ({ ...t })));
        };
        room.onStateChange(sync);
        room.onLeave((code: number) => {
          if (code === 4000) pushToast({ kind: 'error', text: 'Removed by host.' });
        });
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
  }, [myIdentityId, myDisplayName]);

  // Walking input — send normalized vectors to the server.
  useEffect(() => {
    if (!lobbyRoom) return;
    const stop = startWalking((v) => {
      lobbyRoom.send(C2S.move, { dx: v.dx, dy: v.dy });
    });
    return stop;
  }, [lobbyRoom]);

  // Walk-and-sit: when our avatar reaches its walkingTo target's sit radius,
  // auto-join the BlackjackRoom for that table.
  const me = useMemo(
    () => players.find((p) => p.sessionId === mySessionId) ?? null,
    [players, mySessionId],
  );
  useEffect(() => {
    if (!me || !me.walkingTo) return;
    const t = tables.find((x) => x.tableId === me.walkingTo);
    if (!t) return;
    const dist = Math.hypot(t.x - me.x, t.y - me.y);
    if (dist <= SIT_RADIUS) enterTable(t.tableId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.x, me?.y, me?.walkingTo]);

  const enterTable = async (tableId: string) => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    try {
      const r = await joinBlackjack({
        identityId: myIdentityId,
        displayName: myDisplayName || 'Guest',
      });
      setTableRoom(r, r.sessionId);
      setView('table');
    } catch (e) {
      pushToast({ kind: 'error', text: 'Could not reach that table.' });
      console.warn(e);
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  };

  const onFloorTap = (x: number, y: number) => {
    lobbyRoom?.send(C2S.travelTo, { x, y });
  };
  const onTableTap = (tableId: string) => {
    // If close enough already, sit directly. Otherwise walk over.
    if (!me) return;
    const t = tables.find((x) => x.tableId === tableId);
    if (!t) return;
    const dist = Math.hypot(t.x - me.x, t.y - me.y);
    if (dist <= SIT_RADIUS) enterTable(tableId);
    else lobbyRoom?.send(C2S.walkToTable, { tableId });
  };

  const isHost = mySessionId !== null && hostId === mySessionId;

  return (
    <div className="mx-auto max-w-6xl px-3 pb-32 pt-3 sm:px-6 sm:pt-6">
      <header className="mb-4 flex items-baseline justify-between gap-3 sm:mb-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-sunset sm:text-[11px]">
            The floor
          </p>
          <h2 className="font-display text-2xl font-bold leading-none tracking-tight sm:text-3xl">
            Walk over, {myDisplayName || 'friend'}.
          </h2>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-mute">
            Playing tonight
          </p>
          <p className="font-display text-base font-bold">{players.length}</p>
        </div>
      </header>

      <Floor
        players={players}
        tables={tables}
        mySessionId={mySessionId}
        onFloorTap={onFloorTap}
        onTableTap={onTableTap}
      />

      {/* Hint strip — keeps chrome minimal but explains the controls. */}
      <p className="mt-3 text-center text-[11px] text-ink-mute">
        WASD / arrows · tap to travel · sit when the table lights up
      </p>

      {/* Touch joystick — primary input on mobile, hidden on hover-capable devices. */}
      <div className="fixed bottom-4 left-4 z-20 sm:hidden">
        <TouchStick />
      </div>

      {joining && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/40 text-sm font-semibold text-ink backdrop-blur-sm">
          Walking over…
        </div>
      )}

      {isHost && lobbyRoom && (
        <HostPanel
          room={lobbyRoom}
          tables={tables}
          players={players}
          mySessionId={mySessionId}
        />
      )}

      <footer className="mt-10 text-center text-[10px] uppercase tracking-[0.32em] text-ink-mute/70">
        play-money · social only
      </footer>
    </div>
  );
}
