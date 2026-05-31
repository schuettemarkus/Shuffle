import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useStore,
  selectMySeat,
  selectPot,
  type TableView,
  type SeatView,
  type ChipFlight,
} from '../lib/store';
import type { Card, HandResult, RoyalMatchOutcome, SeatVibe } from '@shuffle/shared';
import { BET_WINDOW_MS, SETTLE_MS } from '@shuffle/shared';
import { Seat } from '../components/Seat';
import { DealerSlot } from '../components/DealerSlot';
import { PlayingCard, HandValueBadge } from '../components/PlayingCard';
import { FeltActionPanel } from '../components/TableControls';
import { PhaseBanner } from '../components/PhaseBanner';
import { ChatPanel } from '../components/ChatPanel';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { TableHostPanel } from '../components/TableHostPanel';
import { ShareInvitePanel } from '../components/ShareInvitePanel';
import { sendAction, sendReaction, sendChipToss } from '../lib/intents';
import * as wallet from '../lib/wallet';
import { rumble, startGamepadLoop, type GamepadIntent } from '../lib/gamepad';
import { RoomEvent, Track } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';

export function Table() {
  const tableRoom = useStore((s) => s.tableRoom);
  const mySessionId = useStore((s) => s.mySessionId);
  const setTable = useStore((s) => s.setTable);
  const table = useStore((s) => s.table);
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);
  const myDisplayName = useStore((s) => s.myDisplayName);
  const pushReaction = useStore((s) => s.pushReaction);
  const setLastResult = useStore((s) => s.setLastResult);
  const lastResult = useStore((s) => s.lastResult);
  const reactions = useStore((s) => s.reactions);
  const pushSeatFlash = useStore((s) => s.pushSeatFlash);
  const pushChipFlight = useStore((s) => s.pushChipFlight);
  const betDraft = useStore((s) => s.betDraft);
  const setBetDraft = useStore((s) => s.setBetDraft);
  const camStream = useStore((s) => s.camStream);
  const setCam = useStore((s) => s.setCam);
  const peerStreams = useStore((s) => s.peerStreams);
  const setPeerStreams = useStore((s) => s.setPeerStreams);
  const venue = useStore((s) => s.venue);
  const shareOpen = useStore((s) => s.shareOpen);
  const setShareOpen = useStore((s) => s.setShareOpen);

  // Local mic / camera toggle state. Defaults: both on; the user can pause
  // either from the local video tile.
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  // Subscribe to state from Colyseus and mirror into Zustand.
  useEffect(() => {
    if (!tableRoom) {
      setView('lobby');
      return;
    }
    const sync = () => setTable(toView(tableRoom.state as ServerSchema));
    tableRoom.onStateChange(sync);
    sync();
    const onToast = (msg: { kind: string; text: string }) => {
      if (!msg.text) return;
      pushToast({ kind: (msg.kind as 'info' | 'error') ?? 'info', text: msg.text });
    };
    tableRoom.onMessage('toast', onToast);
    const onError = (_e: unknown) => pushToast({ kind: 'error', text: 'Server hiccup. Retrying…' });
    tableRoom.onError(onError);
    const onLeave = () => {
      pushToast({ kind: 'info', text: 'Disconnected from the table.' });
      setView('lobby');
    };
    tableRoom.onLeave(onLeave);
    tableRoom.onMessage('reaction', (m: { from: string; emote: string }) => {
      pushReaction({ from: m.from, emote: m.emote });
    });
    tableRoom.onMessage('chipToss', (m: { from: string }) => {
      pushReaction({ from: m.from, emote: 'chip' });
    });
    tableRoom.onMessage('handResult', (r: HandResult) => {
      setLastResult(r);
      // Per-seat flash + payout chip-flight back to each seat.
      for (const ps of r.perSeat) {
        const total = ps.delta + (ps.splitDelta ?? 0);
        const kind =
          ps.outcome === 'blackjack'
            ? 'blackjack'
            : total > 0
            ? 'win'
            : total < 0
            ? 'lose'
            : 'push';
        pushSeatFlash({ seatIndex: ps.seatIndex, kind, delta: total });
        if (total > 0) {
          // Fly the winnings from the pot back to the seat.
          pushChipFlight({
            fromKey: 'pot',
            toKey: `seat-${ps.seatIndex}`,
            amount: total,
            variant: 'payout',
          });
        }
      }
      const mine = r.perSeat.find((p) => p.playerId === tableRoom.sessionId);
      if (mine) {
        const total = mine.delta + (mine.splitDelta ?? 0);
        const royal = mine.royalMatchDelta ?? 0;
        const profit = total + royal;
        if (total > 0) {
          pushToast({ kind: 'win', text: `+${total} · ${mine.outcome}` });
          rumble(180, 0.7);
          setTimeout(() => rumble(120, 0.7), 220);
        } else if (total < 0) {
          pushToast({ kind: 'lose', text: `${total} · ${mine.outcome}` });
        } else {
          pushToast({ kind: 'info', text: `Push · stack returned` });
        }
        // Persist this hand into the lifetime stats so the user's running
        // W/L line carries across sessions (no profile needed — keyed off
        // their localStorage identityId).
        const outcome = mine.outcome;
        wallet.recordHand({
          won: total > 0 && outcome !== 'push',
          lost: total < 0,
          pushed: outcome === 'push',
          blackjack: outcome === 'blackjack',
          profit,
        });
      }
    });
    tableRoom.onMessage('shuffleReveal', (m: { seed: string; commitHash: string }) => {
      // Provably-fair scaffold — log the reveal so a player can verify.
      console.info(
        `[shuffle] round verified — commit=${m.commitHash.slice(0, 12)}… seed=${m.seed.slice(0, 12)}…`,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRoom]);

  const mySeat = useMemo(() => selectMySeat(table, mySessionId), [table, mySessionId]);

  // Buzz when it becomes my turn.
  useEffect(() => {
    if (mySeat?.isTurn) rumble(220, 0.6);
  }, [mySeat?.isTurn]);

  // Track previous bets per seat so we can fire "chip-into-pot" flights only
  // on transitions from no-bet → some-bet (or an increase). The server is
  // authoritative; we just observe.
  const prevBets = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    if (!table) return;
    for (const seat of table.seats) {
      const prev = prevBets.current.get(seat.index) ?? 0;
      const total = seat.bet + seat.splitBet;
      if (total > prev) {
        pushChipFlight({
          fromKey: `seat-${seat.index}`,
          toKey: 'pot',
          amount: total - prev,
          variant: 'bet',
        });
      }
      prevBets.current.set(seat.index, total);
    }
  }, [table, pushChipFlight]);

  // Camera lifecycle (request -> publish -> unpublish -> stop) keyed off
  // camEnabled. When the user toggles cam off the track stops, the LiveKit
  // publication is removed, and other clients see the avatar fallback.
  useEffect(() => {
    if (!camEnabled) {
      // Stop any existing local stream and unpublish from LiveKit.
      camStream?.getTracks().forEach((t) => t.stop());
      setCam(null);
      venue?.unpublishCamera().catch(() => {});
      return;
    }
    if (camStream) {
      // Already have a stream — make sure it's published.
      if (venue) venue.publishCamera(camStream).catch(() => {});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setCam(s);
        if (venue) await venue.publishCamera(s);
      } catch (err) {
        setCam(null, err instanceof Error ? err.message : 'camera blocked');
        setCamEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camEnabled, venue]);

  // Mic toggle — proxied to LiveKit; safe to call repeatedly.
  useEffect(() => {
    if (!venue) return;
    venue.room.localParticipant
      .setMicrophoneEnabled(micEnabled)
      .catch((err) => console.info('[livekit] mic toggle failed', err));
  }, [venue, micEnabled]);

  const toggleMic = useCallback(() => setMicEnabled((v) => !v), []);
  const toggleCam = useCallback(() => setCamEnabled((v) => !v), []);

  // Refresh peerStreams whenever a remote video track joins / leaves.
  useEffect(() => {
    if (!venue) return;
    const refresh = () => {
      const map = new Map<string, MediaStream>();
      for (const p of venue.room.remoteParticipants.values()) {
        for (const pub of p.videoTrackPublications.values()) {
          const track = pub.videoTrack;
          if (!track?.mediaStreamTrack) continue;
          map.set(p.identity, new MediaStream([track.mediaStreamTrack]));
        }
      }
      setPeerStreams(map);
    };
    refresh();
    const onSub = (_t: unknown, pub: unknown) => {
      if ((pub as RemoteTrackPublication).kind === Track.Kind.Video) refresh();
    };
    venue.room
      .on(RoomEvent.TrackSubscribed, onSub)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh);
    return () => {
      venue.room
        .off(RoomEvent.TrackSubscribed, onSub)
        .off(RoomEvent.TrackUnsubscribed, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh);
    };
  }, [venue, setPeerStreams]);

  // Audio levels — keyed by LiveKit participant identity (which is the same
  // string the server stores as `seat.identityId`). The seat component watches
  // this and pulses while the player is speaking.
  const setSpeakingLevels = useStore((s) => s.setSpeakingLevels);
  useEffect(() => {
    if (!venue) return;
    let raf = 0;
    let dirty = false;
    const levels = new Map<string, number>();

    const writeLevels = () => {
      // Local participant levels too — so your own pulse fires while you talk.
      levels.set(
        venue.room.localParticipant.identity,
        venue.room.localParticipant.audioLevel ?? 0,
      );
      for (const p of venue.room.remoteParticipants.values()) {
        levels.set(p.identity, p.audioLevel ?? 0);
      }
      setSpeakingLevels(levels);
    };

    const schedule = () => {
      if (dirty) return;
      dirty = true;
      raf = requestAnimationFrame(() => {
        dirty = false;
        writeLevels();
      });
    };

    venue.room.on(RoomEvent.ActiveSpeakersChanged, schedule);
    // ActiveSpeakersChanged also fires when a speaker drops below threshold,
    // so we cover both the "started" and "stopped" transitions for free.
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      venue.room.off(RoomEvent.ActiveSpeakersChanged, schedule);
      setSpeakingLevels(new Map());
    };
  }, [venue, setSpeakingLevels]);

  // Wire the gamepad loop -> table actions.
  useEffect(() => {
    if (!table) return;
    const ctx = () => (mySeat ? ('table' as const) : ('floor' as const));
    const stop = startGamepadLoop({
      context: ctx,
      onConnect: () => pushToast({ kind: 'info', text: 'Controller connected.' }),
      onDisconnect: () => pushToast({ kind: 'info', text: 'Controller disconnected.' }),
      onIntent: (intent: GamepadIntent) => handleGamepadIntent(intent),
    });
    return stop;

    function handleGamepadIntent(intent: GamepadIntent) {
      if (!table) return;
      switch (intent) {
        case 'sit': {
          const target = useStore.getState().selectedSeatIndex;
          const idx = target ?? table.seats.find((s) => s.phase === 'empty')?.index;
          if (idx != null) sendAction(tableRoom, { type: 'sit', seatIndex: idx, buyIn: 1000 });
          return;
        }
        case 'leave':
          sendAction(tableRoom, { type: 'leave' });
          return;
        case 'browseTables':
          setView('lobby');
          return;
        case 'hitOrCall':
          if (table.phase === 'playing' && mySeat?.isTurn) sendAction(tableRoom, { type: 'hit' });
          return;
        case 'fold':
          if (table.phase === 'playing' && mySeat?.isTurn)
            sendAction(tableRoom, { type: 'surrender' });
          else sendAction(tableRoom, { type: 'leave' });
          return;
        case 'betMode':
          if (table.phase === 'playing' && mySeat?.isTurn)
            sendAction(tableRoom, { type: 'double' });
          else if (table.phase === 'betting')
            sendAction(tableRoom, { type: 'bet', amount: useStore.getState().betDraft });
          return;
        case 'cyclePresetUp':
          setBetDraft(Math.min(table.maxBet, betDraft + 50));
          return;
        case 'cyclePresetDown':
          setBetDraft(Math.max(table.minBet, betDraft - 50));
          return;
        case 'fineTuneUp':
          setBetDraft(Math.min(table.maxBet, betDraft + 25));
          return;
        case 'fineTuneDown':
          setBetDraft(Math.max(table.minBet, betDraft - 25));
          return;
        case 'tossChip':
          sendChipToss(tableRoom);
          return;
        case 'emoteCheers':
          sendReaction(tableRoom, 'cheers');
          return;
        case 'emoteFacepalm':
          sendReaction(tableRoom, 'facepalm');
          return;
        case 'emoteClap':
          sendReaction(tableRoom, 'clap');
          return;
        case 'emoteTaunt':
          sendReaction(tableRoom, 'taunt');
          return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, mySeat?.isTurn, mySeat?.phase, tableRoom, betDraft]);

  if (!table) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">
        Walking over to the table…
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex max-w-7xl flex-col gap-3 px-2 pb-32 pt-3 sm:px-6 sm:pt-5 sm:pr-[336px]">
      <header className="flex items-center justify-between">
        <button
          onClick={() => setView('lobby')}
          className="rounded-full border border-border-hi bg-black/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft backdrop-blur"
        >
          ← Lobby
        </button>
        <PhaseBanner table={table} />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-sunset/60 bg-sunset/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-sunset backdrop-blur transition hover:bg-sunset/20"
            title="Invite friends to this table"
          >
            <span>＋</span>
            <span className="hidden sm:inline">Invite</span>
          </button>
        </div>
      </header>

      {!mySeat && <SpectatorBadge table={table} />}

      {/* The felt is the screen now — it carries the dealer, six seats with
       *  embedded webcam tiles, the pot, AND the action surface. */}
      <FeltSurface
        table={table}
        mySeat={mySeat}
        room={tableRoom}
        mySessionId={mySessionId}
        peerStreams={peerStreams}
        camStream={camStream}
        micEnabled={micEnabled}
        camEnabled={camEnabled}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        lastResult={lastResult}
      />

      {/* Tiny floating local preview when the user hasn't sat down yet — so
       *  they can frame their camera and toggle mic before joining. Once they
       *  sit, the seat itself owns these controls. */}
      {!mySeat && (
        <LocalPreviewBubble
          name={myDisplayName || 'You'}
          stream={camStream}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
        />
      )}

      <Fairness table={table} />

      <ReactionsLayer reactions={reactions} table={table} />

      <ChipFlightsLayer />

      <ChatPanel room={tableRoom} mySessionId={mySessionId} />
      <HandHistoryPanel room={tableRoom} />
      {tableRoom && table.hostId === mySessionId && (
        <TableHostPanel room={tableRoom} table={table} mySessionId={mySessionId} />
      )}
      {shareOpen && (
        <ShareInvitePanel
          lobbyName={useStore.getState().lobbyName}
          lobbyId={useStore.getState().currentLobbyId}
          seatsOpen={table.seats.filter((s) => s.phase === 'empty').length}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

function FeltSurface({
  table,
  mySeat,
  room,
  mySessionId,
  peerStreams,
  camStream,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
  lastResult,
}: {
  table: TableView;
  mySeat: SeatView | null;
  room: import('colyseus.js').Room | null;
  mySessionId: string | null;
  peerStreams: Map<string, MediaStream>;
  camStream: MediaStream | null;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  lastResult: HandResult | null;
}) {
  const pot = selectPot(table);
  // Flanking layout — the felt sits at the top, and three seats run down each
  // side so the view reads like "everyone gathered around one table". Falls
  // back to a 3+3 stacked grid on phones where the columns get too thin.
  const leftSeats = table.seats.slice(0, 3);
  const rightSeats = table.seats.slice(3, 6);

  const streamFor = (s: SeatView): MediaStream | null => {
    if (s.playerId === mySessionId) return camStream;
    return peerStreams.get(s.identityId) ?? null;
  };

  const viewerSeated = !!mySeat;
  const seatProps = (s: SeatView) => {
    const mine = s.playerId === mySessionId;
    return {
      seat: s,
      isMine: mine,
      isDealerButton: table.dealerButtonSeat === s.index,
      stream: streamFor(s),
      viewerSeated,
      onSit: () => useStore.getState().setSelectedSeat(s.index),
      onLeave: mine
        ? () => sendAction(room, { type: 'leave' })
        : undefined,
      micEnabled: mine ? micEnabled : undefined,
      camEnabled: mine ? camEnabled : undefined,
      onToggleMic: mine ? onToggleMic : undefined,
      onToggleCam: mine ? onToggleCam : undefined,
    };
  };

  return (
    <section className="relative mx-auto w-full max-w-5xl">
      {/* MOBILE — felt at top, 3+3 grid below so the columns don't squeeze. */}
      <div className="sm:hidden">
        <FeltCenter table={table} mySeat={mySeat} room={room} pot={pot} lastResult={lastResult} mySessionId={mySessionId} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {table.seats.map((s) => (
            <Seat key={s.index} {...seatProps(s)} />
          ))}
        </div>
      </div>

      {/* DESKTOP — felt at the top, three seats stacked down each side. */}
      <div className="hidden gap-3 sm:grid sm:grid-cols-[170px_minmax(0,1fr)_170px] md:grid-cols-[190px_minmax(0,1fr)_190px]">
        <div className="flex flex-col gap-3">
          {leftSeats.map((s) => (
            <Seat key={s.index} {...seatProps(s)} />
          ))}
        </div>
        <FeltCenter table={table} mySeat={mySeat} room={room} pot={pot} lastResult={lastResult} mySessionId={mySessionId} />
        <div className="flex flex-col gap-3">
          {rightSeats.map((s) => (
            <Seat key={s.index} {...seatProps(s)} />
          ))}
        </div>
      </div>

      <p className="mt-4 text-center font-display text-[10px] tracking-[0.5em] text-white/30">
        shuffle
      </p>
    </section>
  );
}

// The center of the perimeter layout: a smaller felt that holds the dealer,
// pot, and the **prominent** action panel. Action gets its own bold framing
// here (this is where eyes go when it's your turn).
function FeltCenter({
  table,
  mySeat,
  room,
  pot,
  lastResult,
  mySessionId,
}: {
  table: TableView;
  mySeat: SeatView | null;
  room: import('colyseus.js').Room | null;
  pot: number;
  lastResult: HandResult | null;
  mySessionId: string | null;
}) {
  return (
    <div className="felt relative overflow-hidden rounded-[24px] border border-white/8 px-3 py-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] sm:px-4 sm:py-4">
      {/* Subtle inner curves for the table outline. */}
      <div className="pointer-events-none absolute inset-2 rounded-[240px_/_140px] border border-white/10" />
      <div className="pointer-events-none absolute inset-4 rounded-[160px_/_110px] border border-white/5" />

      {/* Win/lose banner sits dead-centre over the felt during the settling
       *  window only. `lastResult` is the PREVIOUS hand's outcome — if we
       *  also showed it during the next hand's `dealer` phase, every draw
       *  the dealer makes would flash a stale "You won / You lost" pill. */}
      {lastResult && table.phase === 'settling' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-3">
          <HandResultRibbon r={lastResult} mySessionId={mySessionId} />
        </div>
      )}

      <div className="relative flex flex-col items-center gap-1.5 sm:gap-2">
        <DealerSign />
        <DealerSlot table={table} />
        <PhaseCountdown table={table} />

        {/* Bet slip — anchored HIGH on the felt, just under the dealer area,
         *  so the active action surface is the centerpiece. */}
        <div className="relative z-10 w-full max-w-md">
          <ProminentActionPanel table={table} mySeat={mySeat} room={room} />
        </div>

        <PotChips pot={pot} />

        {/* Local player's hand mirrors the dealer above — big xl cards on the
         *  bottom half of the felt so the player's own cards are as readable
         *  as the dealer's. Everyone else sees each other's cards inside
         *  their own seat tile (handled by <Seat>). */}
        <LocalPlayerHand mySeat={mySeat} />

        <TableVibe table={table} />
      </div>
    </div>
  );
}

// Single table-vibe indicator. Reads the public Hi-Lo true count and
// summarises it as a glanceable mood — players still get the counting signal
// (single-deck, counting allowed) without a wall of running/true/decks-left
// numbers cluttering the felt.
function TableVibe({ table }: { table: TableView }) {
  const totalCards = table.deckCount * 52;
  const remainingCards = Math.max(0, totalCards - table.cardsDealt);
  const decksRemaining = remainingCards / 52;
  const trueCount =
    decksRemaining > 0 ? table.runningCount / decksRemaining : table.runningCount;
  const vibe =
    trueCount >= 2.5
      ? { label: 'Hot table', glyph: '🔥', cls: 'border-sunset/55 bg-sunset/15 text-sunset' }
      : trueCount >= 1
      ? { label: 'Warming up', glyph: '☀️', cls: 'border-amber/55 bg-amber/15 text-amber' }
      : trueCount <= -2.5
      ? { label: 'Ice cold', glyph: '🧊', cls: 'border-[#69BBE0]/55 bg-[#69BBE0]/15 text-[#9DD3EE]' }
      : trueCount <= -1
      ? { label: 'Cooling off', glyph: '❄️', cls: 'border-[#69BBE0]/40 bg-[#69BBE0]/10 text-[#9DD3EE]' }
      : { label: 'Even keel', glyph: '⚖️', cls: 'border-white/15 bg-black/40 text-ink-soft' };
  return (
    <div
      className={
        'mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] backdrop-blur ' +
        vibe.cls
      }
      title={`Hi-Lo true count ${trueCount >= 0 ? '+' : ''}${trueCount.toFixed(1)}`}
    >
      <span className="text-sm leading-none">{vibe.glyph}</span>
      <span>{vibe.label}</span>
    </div>
  );
}

// Big, glanceable countdown on the felt — "Place your bets · 12s" in tiny
// header copy doesn't compete with a chip stack the user is sliding around,
// so we render a ring + bold number right under the dealer sign whenever a
// clock is actively running.
function PhaseCountdown({ table }: { table: TableView }) {
  const totalMs =
    table.phase === 'betting'
      ? BET_WINDOW_MS
      : table.phase === 'settling'
      ? SETTLE_MS
      : 0;
  if (totalMs <= 0) return null;
  const remainingMs = Math.max(0, table.phaseClockMs);
  if (remainingMs <= 0) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  const pct = Math.min(1, Math.max(0, remainingMs / totalMs));
  // Stroke-dash ring: circumference of a 56-radius circle ≈ 351.86. The full
  // ring is dashed by the remaining fraction so it visibly drains as the
  // clock runs down.
  const circumference = 2 * Math.PI * 56;
  const dashOffset = circumference * (1 - pct);
  const tone =
    remainingMs <= 4000
      ? 'text-fold'
      : remainingMs <= 8000
      ? 'text-amber'
      : 'text-sunset';
  const ringColor =
    remainingMs <= 4000 ? '#E0556B' : remainingMs <= 8000 ? '#FFB14E' : '#FF6A3D';
  const label = table.phase === 'betting' ? 'Bet' : 'Settle';
  return (
    <div className="relative grid h-28 w-28 place-items-center sm:h-32 sm:w-32">
      <svg
        viewBox="0 0 128 128"
        className="absolute inset-0 h-full w-full -rotate-90 drop-shadow-[0_6px_24px_rgba(255,106,61,.45)]"
        aria-hidden
      >
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="rgba(0,0,0,.4)"
          stroke="rgba(255,255,255,.1)"
          strokeWidth="6"
        />
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="none"
          stroke={ringColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 220ms linear' }}
        />
      </svg>
      <div className="pointer-events-none flex flex-col items-center justify-center leading-none">
        <span className={'font-display text-4xl font-black tabular-nums sm:text-5xl ' + tone}>
          {seconds}
        </span>
        <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
          {label}
        </span>
      </div>
    </div>
  );
}

// Local player's hand rendered at xl across the bottom half of the felt —
// mirrors the dealer slot above so the user's own cards read as the second
// hero of the table. Other players still see this user's cards inside their
// own seat tile (the seat-tile hand still renders for everyone else; just
// the local player's seat hand is hidden to avoid duplication).
function LocalPlayerHand({ mySeat }: { mySeat: SeatView | null }) {
  if (!mySeat || mySeat.hand.length === 0) return null;
  const splitting = mySeat.splitBet > 0;
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <span className="rounded-full border border-amber/45 bg-black/40 px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.3em] text-amber backdrop-blur">
        Your hand
      </span>
      <div className="flex items-end justify-center gap-4">
        <LocalPlayerHandColumn
          hand={mySeat.hand}
          handValue={mySeat.handValue}
          isSoft={mySeat.isSoft}
          active={!splitting || !mySeat.splitActive}
          label={splitting ? 'Hand 1' : undefined}
        />
        {splitting && (
          <LocalPlayerHandColumn
            hand={mySeat.splitHand}
            handValue={mySeat.splitHandValue}
            isSoft={mySeat.splitIsSoft}
            active={mySeat.splitActive}
            label="Hand 2"
          />
        )}
      </div>
    </div>
  );
}

function LocalPlayerHandColumn({
  hand,
  handValue,
  isSoft,
  active,
  label,
}: {
  hand: Card[];
  handValue: number;
  isSoft: boolean;
  active: boolean;
  label?: string;
}) {
  if (hand.length === 0) return null;
  return (
    <div className={'flex flex-col items-center gap-1.5 ' + (active ? '' : 'opacity-55')}>
      <div className="flex min-h-[140px] items-end justify-center gap-2 sm:min-h-[172px]">
        {hand.map((c, i) => (
          <PlayingCard key={i} card={c} index={i} size="xl" />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <HandValueBadge value={handValue} soft={isSoft} size="xl" />
        {label && (
          <span className="rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-mute">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

// Lightweight "you're watching" affordance when the viewer hasn't bought
// in. Reads spectator count from table.spectators (a snapshot of room
// clients minus seated players, computed server-side).
function SpectatorBadge({ table }: { table: TableView }) {
  const others = Math.max(0, (table.spectators ?? 1) - 1);
  return (
    <div className="mx-auto -mt-1 flex w-fit items-center gap-2 rounded-full border border-amber/35 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber backdrop-blur">
      <span>👁 Watching</span>
      {others > 0 && (
        <>
          <span className="text-white/30">·</span>
          <span className="text-ink-soft">
            {others} other{others === 1 ? '' : 's'} watching
          </span>
        </>
      )}
      <span className="text-white/30">·</span>
      <span className="text-ink-soft">tap an empty seat to play</span>
    </div>
  );
}

// "DEALER" sign above the dealer's hand.
function DealerSign() {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-amber/45 bg-black/40 px-5 py-1.5 shadow-[0_0_24px_-6px_rgba(255,177,78,.5)] backdrop-blur">
      <span className="h-1 w-6 bg-gradient-to-r from-transparent via-amber to-transparent" />
      <span className="font-display text-[13px] font-bold uppercase tracking-[0.5em] text-amber">
        Dealer
      </span>
      <span className="h-1 w-6 bg-gradient-to-r from-transparent via-amber to-transparent" />
    </div>
  );
}

// Prominent action panel — the inverse of the previous "subtle" rail. It now
// frames the FeltActionPanel in a sunset-lit chrome with a clear "your move"
// signal so the betting / acting options pop visually.
function ProminentActionPanel({
  table,
  mySeat,
  room,
}: {
  table: TableView;
  mySeat: SeatView | null;
  room: import('colyseus.js').Room | null;
}) {
  const isActing = mySeat?.isTurn && table.phase === 'playing';
  const isBetting = !!mySeat && table.phase === 'betting';
  const frame = isActing
    ? 'border-sunset/80 bg-gradient-to-b from-sunset/15 to-black/40 shadow-[0_0_40px_-8px_rgba(255,106,61,.65)] ring-1 ring-sunset/40'
    : isBetting
    ? 'border-amber/60 bg-gradient-to-b from-amber/10 to-black/40 shadow-[0_0_30px_-8px_rgba(255,177,78,.5)]'
    : 'border-white/15 bg-black/35';
  return (
    <div className={'relative rounded-2xl border p-2.5 backdrop-blur-md transition sm:p-3 ' + frame}>
      <FeltActionPanel table={table} mySeat={mySeat} room={room} />
    </div>
  );
}

// Pot pile — a small chip stack anchored under the dealer that grows with
// total wagered chips. Also serves as the DOM anchor point for chip flights.
// Pulses gently each time the pot value changes so the eye catches the bump.
function PotChips({ pot }: { pot: number }) {
  const prev = useRef(pot);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (pot !== prev.current) {
      prev.current = pot;
      setPulseKey((k) => k + 1);
    }
  }, [pot]);
  return (
    <div className="mt-2 flex justify-center" data-chip-anchor="pot">
      <div
        key={pulseKey}
        className={
          'inline-flex items-center gap-2 rounded-full border border-amber/40 bg-black/40 px-3 py-1.5 text-[11px] font-bold tracking-wide backdrop-blur ' +
          (pot > 0 ? 'shadow-[0_0_24px_rgba(255,177,78,.35)] animate-potPulse' : 'opacity-40')
        }
      >
        <span className="inline-flex">
          <ChipDot tone="amber" />
          <ChipDot tone="sunset" offset />
          <ChipDot tone="rose" offset />
        </span>
        <span className="text-amber">Pot</span>
        <span className="font-display text-white tabular-nums">{pot}</span>
      </div>
    </div>
  );
}

function ChipDot({ tone, offset }: { tone: 'amber' | 'sunset' | 'rose'; offset?: boolean }) {
  const color =
    tone === 'amber' ? 'bg-amber' : tone === 'sunset' ? 'bg-sunset' : 'bg-rose';
  return (
    <span
      className={
        'inline-block h-3 w-3 rounded-full border border-black/30 shadow-inner ' +
        color +
        (offset ? ' -ml-1.5' : '')
      }
    />
  );
}

// Tiny floating local-preview shown only when the user hasn't sat down yet.
// Lets them frame their camera and toggle mic/cam before picking a seat.
// Once they sit, the seat itself owns these controls.
function LocalPreviewBubble({
  name,
  stream,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  name: string;
  stream: MediaStream | null;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const showVideo = !!stream && camEnabled;
  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 z-30 sm:bottom-6 sm:left-6">
      <div
        className={
          'relative h-24 w-32 overflow-hidden rounded-2xl border border-amber/60 shadow-[0_20px_50px_-18px_rgba(0,0,0,.7)] sm:h-28 sm:w-40 ' +
          (showVideo
            ? 'bg-black'
            : 'bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3]')
        }
      >
        {showVideo ? (
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        ) : (
          <div className="grid h-full place-items-center font-display text-2xl font-bold text-white/85">
            {initials(name)}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
          {!micEnabled && <span className="text-fold">🚫</span>}
          <span className="truncate">{name}</span>
        </div>
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5">
          <button
            onClick={onToggleMic}
            title={micEnabled ? 'Mute mic' : 'Unmute mic'}
            className={
              'grid h-7 w-7 place-items-center rounded-full border text-xs backdrop-blur transition ' +
              (micEnabled
                ? 'border-white/20 bg-black/55 text-white'
                : 'border-fold/40 bg-fold/40 text-white animate-pulseSunset')
            }
          >
            {micEnabled ? '🎤' : '🔇'}
          </button>
          <button
            onClick={onToggleCam}
            title={camEnabled ? 'Stop video' : 'Start video'}
            className={
              'grid h-7 w-7 place-items-center rounded-full border text-xs backdrop-blur transition ' +
              (camEnabled
                ? 'border-white/20 bg-black/55 text-white'
                : 'border-fold/40 bg-fold/40 text-white animate-pulseSunset')
            }
          >
            {camEnabled ? '📹' : '🎥'}
          </button>
        </div>
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

function Fairness({ table }: { table: TableView }) {
  if (!table.commitHash) return null;
  return (
    <details className="rounded-xl border border-border bg-bg-2/40 px-3 py-2 text-[10px] text-ink-mute">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
        Provably fair · round {table.round}
      </summary>
      <p className="mt-2">
        Shuffle was committed before the hand and revealed after. Hash the seed to verify.
      </p>
      <p className="mt-1 font-mono break-all">commit: {table.commitHash.slice(0, 32)}…</p>
      {table.revealedSeed && (
        <p className="mt-1 font-mono break-all">seed: {table.revealedSeed.slice(0, 32)}…</p>
      )}
    </details>
  );
}

function HandResultRibbon({ r, mySessionId }: { r: HandResult; mySessionId: string | null }) {
  const mine = mySessionId ? r.perSeat.find((s) => s.playerId === mySessionId) : null;
  // Spectators (no seat) still see a small "Round N · Dealer X" pill so they
  // know what just happened — but they don't need a giant banner.
  if (!mine) {
    return (
      <div className="rounded-full border border-border-hi bg-black/60 px-4 py-2 text-xs backdrop-blur">
        <span className="font-bold text-ink">Round {r.round}</span>
        <span className="mx-2 text-ink-mute">·</span>
        <span className="text-ink">Dealer {r.dealerValue}</span>
      </div>
    );
  }
  const delta =
    mine.delta + (mine.splitDelta ?? 0) + (mine.royalMatchDelta ?? 0);
  const isBlackjack = mine.outcome === 'blackjack';
  const mood: 'win' | 'lose' | 'push' =
    isBlackjack || delta > 0 ? 'win' : delta < 0 ? 'lose' : 'push';

  const headline = isBlackjack
    ? 'Blackjack!'
    : mood === 'win'
    ? 'You won'
    : mood === 'lose'
    ? mine.outcome === 'bust'
      ? 'Busted'
      : mine.outcome === 'surrender'
      ? 'Surrendered'
      : 'You lost'
    : 'Push';

  const ringClass =
    mood === 'win'
      ? 'border-win/70 shadow-[0_0_60px_-10px_rgba(63,190,147,.7)]'
      : mood === 'lose'
      ? 'border-fold/70 shadow-[0_0_60px_-10px_rgba(255,124,150,.6)]'
      : 'border-amber/55 shadow-[0_0_60px_-12px_rgba(255,177,78,.45)]';
  const glowClass =
    mood === 'win'
      ? 'from-win/35 via-win/10 to-transparent'
      : mood === 'lose'
      ? 'from-fold/30 via-fold/10 to-transparent'
      : 'from-amber/25 via-amber/8 to-transparent';
  const headlineClass =
    mood === 'win'
      ? 'text-win'
      : mood === 'lose'
      ? 'text-[#FF9DAC]'
      : 'text-amber';
  const deltaClass =
    delta > 0 ? 'text-win' : delta < 0 ? 'text-[#FF9DAC]' : 'text-amber';

  return (
    <div
      className={
        'pointer-events-none relative overflow-hidden rounded-xl border bg-black/80 px-4 py-2 backdrop-blur-md animate-rise ' +
        ringClass
      }
    >
      <div className={'pointer-events-none absolute inset-0 bg-gradient-to-b ' + glowClass} />
      <div className="relative flex items-center gap-3">
        <div className="flex flex-col">
          <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-ink-mute">
            Round {r.round} · Dealer {r.dealerValue}
          </span>
          <span className={'font-display text-xl font-black leading-tight sm:text-2xl ' + headlineClass}>
            {headline}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Net
          </span>
          <span className={'font-display text-xl font-black tabular-nums leading-tight sm:text-2xl ' + deltaClass}>
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        </div>
      </div>
    </div>
  );
}

// Manages reaction lifetimes for the entire table. Reactions whose sender is
// SEATED render over their seat (inside <Seat>); the layer renders any
// orphan reactions — typically spectators — in the screen center as a
// fallback. Dismissal timers live here so reactions clean up regardless of
// where they ended up displayed.
function ReactionsLayer({
  reactions,
  table,
}: {
  reactions: Array<{ id: number; from: string; emote: string }>;
  table: TableView;
}) {
  const dismissReaction = useStore((s) => s.dismissReaction);
  useEffect(() => {
    const timers = reactions.map((r) =>
      setTimeout(() => dismissReaction(r.id), 1800),
    );
    return () => timers.forEach(clearTimeout);
  }, [reactions, dismissReaction]);

  // Anything emitted by a seated player is already drawn over that seat —
  // skip it here so we don't render the same emoji twice.
  const seatedIds = new Set(
    table.seats.filter((s) => s.playerId).map((s) => s.playerId),
  );
  const orphans = reactions.filter((r) => !seatedIds.has(r.from));
  if (orphans.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 text-5xl">
      {orphans.map((r) => (
        <span
          key={r.id}
          className="mx-1 inline-block animate-reaction"
          style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.5))' }}
        >
          {emoteGlyph(r.emote)}
        </span>
      ))}
    </div>
  );
}

// Chips fly between anchor elements (seats <-> pot). The animation is purely
// presentational; the server is authoritative for the underlying chip move.
function ChipFlightsLayer() {
  const flights = useStore((s) => s.chipFlights);
  const dismiss = useStore((s) => s.dismissChipFlight);
  // Track DOM positions for each flight so we can re-measure on resize.
  const [positions, setPositions] = useState<Record<number, { from: Rect; to: Rect } | null>>({});

  useLayoutEffect(() => {
    const next: Record<number, { from: Rect; to: Rect } | null> = {};
    for (const f of flights) {
      const from = anchorRect(f.fromKey);
      const to = anchorRect(f.toKey);
      next[f.id] = from && to ? { from, to } : null;
    }
    setPositions(next);
  }, [flights]);

  useEffect(() => {
    const timers = flights.map((f) =>
      setTimeout(() => dismiss(f.id), f.variant === 'payout' ? 900 : 750),
    );
    return () => timers.forEach(clearTimeout);
  }, [flights, dismiss]);

  if (flights.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {flights.map((f) => (
        <ChipFlightView key={f.id} flight={f} pos={positions[f.id]} />
      ))}
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
}

function anchorRect(key: string): Rect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-chip-anchor="${key}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function ChipFlightView({ flight, pos }: { flight: ChipFlight; pos: { from: Rect; to: Rect } | null | undefined }) {
  if (!pos) return null;
  const isPayout = flight.variant === 'payout';
  const colorClass = isPayout
    ? 'from-amber/95 via-sunset/95 to-rose/95'
    : 'from-amber/95 via-amber/80 to-sunset/95';
  const ringClass = isPayout ? 'ring-amber/70' : 'ring-amber/50';
  const dx = pos.to.x - pos.from.x;
  const dy = pos.to.y - pos.from.y;
  const duration = isPayout ? 900 : 750;
  return (
    <div
      className="absolute"
      style={{
        left: pos.from.x,
        top: pos.from.y,
        transform: `translate(-50%, -50%)`,
      }}
    >
      <div
        className={
          'chip-flight relative -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br shadow-[0_8px_24px_rgba(0,0,0,.55)] ring-2 ' +
          colorClass +
          ' ' +
          ringClass
        }
        style={
          {
            '--dx': `${dx}px`,
            '--dy': `${dy}px`,
            '--dur': `${duration}ms`,
            width: isPayout ? '22px' : '18px',
            height: isPayout ? '22px' : '18px',
          } as React.CSSProperties
        }
      >
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-amber tabular-nums">
          {isPayout ? '+' : ''}
          {flight.amount}
        </span>
      </div>
    </div>
  );
}

function emoteGlyph(emote: string): string {
  switch (emote) {
    case 'chip': return '🪙';
    case 'cheers': return '🥂';
    case 'facepalm': return '🤦';
    case 'clap': return '👏';
    case 'taunt': return '😏';
    default: return '✨';
  }
}

// ---------- schema -> view transform ----------

interface ServerSchemaCard {
  rank: string;
  suit: string;
  hidden: boolean;
}
interface ServerSchemaVibe {
  key: string;
  label: string;
  icon: string;
  tint: string;
  streak: number;
}
interface ServerSchemaSeat {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  bet: number;
  hand: ServerSchemaCard[];
  handValue: number;
  isSoft: boolean;
  phase: string;
  isTurn: boolean;
  turnClockMs: number;
  connected: boolean;
  graceMs: number;
  splitHand: ServerSchemaCard[];
  splitHandValue: number;
  splitIsSoft: boolean;
  splitBet: number;
  splitPhase: string;
  splitActive: boolean;
  royalMatchBet: number;
  royalMatchOutcome: string;
  royalMatchPayout: number;
  vibe: ServerSchemaVibe;
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
  blackjacks: number;
  netProfit: number;
  biggestWin: number;
  biggestLoss: number;
  buyIn: number;
}
interface ServerSchema {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: string;
  phaseClockMs: number;
  seats: ServerSchemaSeat[];
  dealer: { hand: ServerSchemaCard[]; handValue: number; isSoft: boolean };
  commitHash: string;
  revealedSeed: string;
  hostId: string;
  round: number;
  dealerButtonSeat: number;
  deckCount: number;
  cardsDealt: number;
  runningCount: number;
  spectators?: number;
}

function toCard(c: ServerSchemaCard): Card {
  return { rank: c.rank as Card['rank'], suit: c.suit as Card['suit'], hidden: c.hidden };
}

function toVibe(v: ServerSchemaVibe | undefined): SeatVibe {
  if (!v) {
    return { key: 'rookie', label: '', icon: '🌅', tint: 'mute', streak: 0 };
  }
  return {
    key: (v.key ?? 'rookie') as SeatVibe['key'],
    label: v.label ?? '',
    icon: v.icon ?? '🌅',
    tint: (v.tint ?? 'mute') as SeatVibe['tint'],
    streak: v.streak ?? 0,
  };
}

function toView(s: ServerSchema): TableView {
  // Defensive: during Colyseus state patches, nested schemas can briefly be
  // undefined on the client between encoder ticks. Tolerate it and re-render
  // on the next change.
  const dealer = s.dealer ?? { hand: [], handValue: 0, isSoft: false };
  const dealerHand = dealer.hand ? Array.from(dealer.hand).map(toCard) : [];
  const seats = s.seats
    ? Array.from(s.seats).filter(Boolean).map((seat) => ({
        index: seat.index,
        playerId: seat.playerId ?? '',
        identityId: seat.identityId ?? '',
        displayName: seat.displayName ?? '',
        stack: seat.stack ?? 0,
        bet: seat.bet ?? 0,
        hand: seat.hand ? Array.from(seat.hand).map(toCard) : [],
        handValue: seat.handValue ?? 0,
        isSoft: !!seat.isSoft,
        phase: (seat.phase ?? 'empty') as SeatView['phase'],
        isTurn: !!seat.isTurn,
        turnClockMs: seat.turnClockMs ?? 0,
        connected: seat.connected ?? true,
        graceMs: seat.graceMs ?? 0,
        splitHand: seat.splitHand ? Array.from(seat.splitHand).map(toCard) : [],
        splitHandValue: seat.splitHandValue ?? 0,
        splitIsSoft: !!seat.splitIsSoft,
        splitBet: seat.splitBet ?? 0,
        splitPhase: (seat.splitPhase ?? 'empty') as SeatView['splitPhase'],
        splitActive: !!seat.splitActive,
        royalMatchBet: seat.royalMatchBet ?? 0,
        royalMatchOutcome: (seat.royalMatchOutcome ?? 'none') as RoyalMatchOutcome,
        royalMatchPayout: seat.royalMatchPayout ?? 0,
        vibe: toVibe(seat.vibe),
        handsPlayed: seat.handsPlayed ?? 0,
        handsWon: seat.handsWon ?? 0,
        handsLost: seat.handsLost ?? 0,
        handsPushed: seat.handsPushed ?? 0,
        blackjacks: seat.blackjacks ?? 0,
        netProfit: seat.netProfit ?? 0,
        biggestWin: seat.biggestWin ?? 0,
        biggestLoss: seat.biggestLoss ?? 0,
        buyIn: seat.buyIn ?? 0,
      }))
    : [];
  // The UI builds a fixed 6-seat perimeter layout, so always materialize a
  // length-6 array even when the server hasn't pushed the initial state yet.
  // Anything missing becomes an "empty" placeholder seat the renderer treats
  // as a sit-down slot.
  const padded: SeatView[] = [];
  for (let i = 0; i < 6; i++) {
    padded.push(seats[i] ?? emptySeatView(i));
  }
  return {
    tableId: s.tableId ?? '',
    name: s.name ?? '',
    minBet: s.minBet ?? 25,
    maxBet: s.maxBet ?? 500,
    maxSeats: s.maxSeats ?? 6,
    phase: (s.phase ?? 'waiting') as TableView['phase'],
    phaseClockMs: s.phaseClockMs ?? 0,
    commitHash: s.commitHash ?? '',
    revealedSeed: s.revealedSeed ?? '',
    hostId: s.hostId ?? '',
    round: s.round ?? 0,
    dealerButtonSeat: s.dealerButtonSeat ?? -1,
    deckCount: s.deckCount ?? 1,
    cardsDealt: s.cardsDealt ?? 0,
    runningCount: s.runningCount ?? 0,
    spectators: s.spectators ?? undefined,
    dealer: {
      hand: dealerHand,
      handValue: dealer.handValue ?? 0,
      isSoft: !!dealer.isSoft,
    },
    seats: padded,
  };
}

function emptySeatView(index: number): SeatView {
  return {
    index,
    playerId: '',
    identityId: '',
    displayName: '',
    stack: 0,
    bet: 0,
    hand: [],
    handValue: 0,
    isSoft: false,
    phase: 'empty',
    isTurn: false,
    turnClockMs: 0,
    connected: true,
    graceMs: 0,
    splitHand: [],
    splitHandValue: 0,
    splitIsSoft: false,
    splitBet: 0,
    splitPhase: 'empty',
    splitActive: false,
    royalMatchBet: 0,
    royalMatchOutcome: 'none',
    royalMatchPayout: 0,
    vibe: { key: 'rookie', label: '', icon: '🌅', tint: 'mute', streak: 0 },
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    netProfit: 0,
    biggestWin: 0,
    biggestLoss: 0,
    buyIn: 0,
  };
}
