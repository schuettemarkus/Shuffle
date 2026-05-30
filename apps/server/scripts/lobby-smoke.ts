// Phase 2 smoke test: connect to lobby, verify presence + walking work.

import { Client } from 'colyseus.js';

const URL = process.env.SERVER_URL ?? 'ws://localhost:2567';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ServerPlayer { sessionId: string; displayName: string; x: number; y: number; host: boolean }
interface ServerTable { tableId: string; name: string; x: number; y: number; seatsTaken: number }
interface ServerState { players: Map<string, ServerPlayer>; tables: Map<string, ServerTable>; hostId: string }

async function main() {
  const client = new Client(URL);
  const room = await client.joinOrCreate('lobby', {
    identityId: 'lobby-smoke-' + Math.random().toString(36).slice(2, 8),
    displayName: 'Smoke',
  });
  console.log('joined lobby as', room.sessionId);

  let lastX = -1;
  let lastY = -1;
  let phases = 0;

  room.onStateChange((state: ServerState) => {
    const me = state.players.get(room.sessionId);
    if (me && (me.x !== lastX || me.y !== lastY)) {
      lastX = me.x;
      lastY = me.y;
      phases++;
      if (phases % 8 === 0) {
        console.log(`me @ (${me.x.toFixed(1)}, ${me.y.toFixed(1)}) host=${me.host}`);
      }
    }
  });

  // Wait for state, then walk left for a second.
  await delay(500);
  for (let i = 0; i < 20; i++) {
    room.send('move', { dx: -1, dy: 0 });
    await delay(50);
  }
  console.log('after walk left, lastX=', lastX);

  // Tap-to-travel toward (90, 10).
  room.send('travelTo', { x: 90, y: 10 });
  await delay(3000);
  console.log('after travel, pos=', lastX, lastY);

  if (phases < 5) {
    console.error('TIMED OUT — server never moved my avatar');
    process.exit(1);
  }
  console.log('OK — lobby presence + walking work. updates =', phases);
  await room.leave(true);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
