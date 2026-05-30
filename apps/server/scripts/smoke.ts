// End-to-end smoke test: spin up a colyseus.js client, join blackjack, sit,
// place a bet, and watch a full hand play out. Exits 0 on success.
//
// Usage: pnpm -F @shuffle/server exec tsx scripts/smoke.ts

import { Client } from 'colyseus.js';

const URL = process.env.SERVER_URL ?? 'ws://localhost:2567';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ServerSchemaCard { rank: string; suit: string; hidden: boolean }
interface ServerSchemaSeat {
  index: number;
  playerId: string;
  phase: string;
  bet: number;
  stack: number;
  isTurn: boolean;
  handValue: number;
  hand: ServerSchemaCard[];
}
interface ServerSchema {
  phase: string;
  phaseClockMs: number;
  round: number;
  seats: ServerSchemaSeat[];
  dealer: { handValue: number; hand: ServerSchemaCard[] };
}

async function main() {
  const client = new Client(URL);
  const room = await client.joinOrCreate('blackjack', {
    identityId: 'smoke-' + Math.random().toString(36).slice(2, 8),
    displayName: 'Smoke',
  });
  console.log('joined room', room.roomId, 'as', room.sessionId);

  let lastPhase = '';
  let placed = false;
  let dealt = false;
  let won: 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender' | '' = '';

  room.onMessage('handResult', (r) => {
    const mine = r.perSeat.find((p: { playerId: string }) => p.playerId === room.sessionId);
    if (mine) {
      won = mine.outcome;
      console.log('hand result:', mine);
    }
  });

  room.onStateChange((state: ServerSchema) => {
    if (state.phase !== lastPhase) {
      console.log('phase ->', state.phase, 'round', state.round, 'clock', state.phaseClockMs);
      lastPhase = state.phase;
    }
    const seat = state.seats.find((s) => s.playerId === room.sessionId);
    if (!seat) {
      // not seated yet — sit at seat 0
      room.send('action', { type: 'sit', seatIndex: 0, buyIn: 1000 });
      return;
    }
    if (state.phase === 'betting' && !placed) {
      placed = true;
      console.log('placing bet 100');
      room.send('action', { type: 'bet', amount: 100 });
    }
    if (state.phase === 'playing' && seat.isTurn && !dealt) {
      dealt = true;
      console.log('standing immediately with', seat.handValue);
      room.send('action', { type: 'standHand' });
    }
  });

  // Wait up to 60 seconds for a hand to resolve.
  for (let i = 0; i < 120; i++) {
    if (won) break;
    await delay(500);
  }

  if (!won) {
    console.error('TIMED OUT — no hand resolved');
    process.exit(1);
  }
  console.log('OK — vertical slice plays a full hand. outcome =', won);
  await room.leave(true);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
