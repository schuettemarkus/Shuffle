// Craps room — server-authoritative dice with commit-reveal seeds, shooter
// rotation, and a felt that mirrors the canonical Vegas layout: line bets on
// the rail, place pads above, hardways and the Field in the middle, props
// stacked on the right.
//
// The shooter is the only player who can roll — everyone else just bets.
// The room itself runs a phase machine (between / comeOut / point) that the
// server hands us via state; we react to roll-result broadcasts to flash
// chips back to seats.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import {
  useStore,
  type CrapsBetView,
  type CrapsSeatView,
  type CrapsTableView,
} from '../lib/store';
import type { BetKind, RollResult } from '@shuffle/shared';
import * as wallet from '../lib/wallet';
import { C2S } from '@shuffle/shared';
import { ChatPanel } from '../components/ChatPanel';
import { RoomEvent, Track } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';

export function Craps() {
  const room = useStore((s) => s.crapsRoom);
  const mySessionId = useStore((s) => s.mySessionId);
  const myDisplayName = useStore((s) => s.myDisplayName);
  const table = useStore((s) => s.crapsTable);
  const setCrapsTable = useStore((s) => s.setCrapsTable);
  const setView = useStore((s) => s.setView);
  const pushToast = useStore((s) => s.pushToast);
  const [chip, setChip] = useState(25);
  const [lastResult, setLastResult] = useState<RollResult | null>(null);
  // Big result ribbon over the felt — fades in after the dice land and out
  // after a few seconds. Mirrors the Blackjack HandResultRibbon.
  const [ribbonResult, setRibbonResult] = useState<RollResult | null>(null);
  const ribbonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ribbonHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (ribbonTimeoutRef.current) clearTimeout(ribbonTimeoutRef.current);
    if (ribbonHideRef.current) clearTimeout(ribbonHideRef.current);
  }, []);

  // Mirror server state.
  useEffect(() => {
    if (!room) {
      setView('lobby');
      return;
    }
    const sync = () => setCrapsTable(toCrapsView(room.state as ServerCrapsSchema));
    room.onStateChange(sync);
    sync();
    room.onMessage('toast', (m: { kind: string; text: string }) => {
      if (m.text) pushToast({ kind: (m.kind as 'info' | 'error') ?? 'info', text: m.text });
    });
    room.onError(() => pushToast({ kind: 'error', text: 'Server hiccup. Retrying…' }));
    room.onLeave(() => {
      pushToast({ kind: 'info', text: 'Left the craps table.' });
      setView('lobby');
    });
    room.onMessage('rollResult', (r: RollResult) => {
      setLastResult(r);
      // Show the big ribbon AFTER the 1.2s dice tumble lands, so the
      // headline matches what the dice show. Same vibe as Blackjack's
      // HandResultRibbon — auto-dismissed after a short window.
      if (ribbonTimeoutRef.current) clearTimeout(ribbonTimeoutRef.current);
      if (ribbonHideRef.current) clearTimeout(ribbonHideRef.current);
      ribbonTimeoutRef.current = setTimeout(() => setRibbonResult(r), 1200);
      ribbonHideRef.current = setTimeout(() => setRibbonResult(null), 1200 + 3200);

      // Persist my P&L into the cross-session wallet — same path Blackjack
      // uses, so the lifetime stats line counts every game.
      const mySeatIndex = (room.state as ServerCrapsSchema).seats?.find(
        (s) => s.playerId === mySessionId,
      )?.index;
      if (mySeatIndex !== undefined) {
        const mine = r.perSeat.find((p) => p.seatIndex === mySeatIndex);
        if (mine && mine.delta !== 0) {
          wallet.recordSwing({ profit: mine.delta });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const mySeat = useMemo(
    () => (table ? table.seats.find((s) => s.playerId === mySessionId) ?? null : null),
    [table, mySessionId],
  );

  // ----- Video / audio plumbing (shared with the LiveKit venue) -----
  const camStream = useStore((s) => s.camStream);
  const setCam = useStore((s) => s.setCam);
  const peerStreams = useStore((s) => s.peerStreams);
  const setPeerStreams = useStore((s) => s.setPeerStreams);
  const venue = useStore((s) => s.venue);
  const setSpeakingLevels = useStore((s) => s.setSpeakingLevels);

  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const toggleMic = useCallback(() => setMicEnabled((v) => !v), []);
  const toggleCam = useCallback(() => setCamEnabled((v) => !v), []);

  // Camera lifecycle.
  useEffect(() => {
    if (!camEnabled) {
      camStream?.getTracks().forEach((t) => t.stop());
      setCam(null);
      venue?.unpublishCamera().catch(() => {});
      return;
    }
    if (camStream) {
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

  // Mic toggle.
  useEffect(() => {
    if (!venue) return;
    venue.room.localParticipant
      .setMicrophoneEnabled(micEnabled)
      .catch((err) => console.info('[livekit] mic toggle failed', err));
  }, [venue, micEnabled]);

  // Remote video streams keyed by identityId.
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

  // Active-speaker levels — one number per identity, used to drive the pulse
  // on each video tile while the player is talking.
  useEffect(() => {
    if (!venue) return;
    let raf = 0;
    let dirty = false;
    const levels = new Map<string, number>();
    const writeLevels = () => {
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
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      venue.room.off(RoomEvent.ActiveSpeakersChanged, schedule);
      setSpeakingLevels(new Map());
    };
  }, [venue, setSpeakingLevels]);

  if (!table) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">
        Walking over to craps…
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex max-w-7xl flex-col gap-3 px-2 pb-32 pt-3 sm:px-6 sm:pt-5 sm:pr-[336px]">
      <header className="flex items-center justify-between">
        <button
          onClick={() => {
            room?.leave();
            setView('lobby');
          }}
          className="rounded-full border border-border-hi bg-black/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft backdrop-blur"
        >
          ← Lobby
        </button>
        <CrapsPhaseBanner table={table} />
        <div className="w-[68px] sm:w-auto" />
      </header>

      <PlayerRail
        table={table}
        mySessionId={mySessionId}
        camStream={camStream}
        peerStreams={peerStreams}
        micEnabled={micEnabled}
        camEnabled={camEnabled}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
      />

      {/* Primary CTAs sit ABOVE the table so the user's main action is the
       *  first thing they see, instead of being buried under the layout. */}
      <CrapsActionBar
        table={table}
        mySeat={mySeat}
        room={room}
        myDisplayName={myDisplayName}
      />

      <CrapsFelt
        table={table}
        mySeat={mySeat}
        mySessionId={mySessionId}
        room={room}
        chip={chip}
        setChip={setChip}
        lastResult={lastResult}
        ribbonResult={ribbonResult}
      />

      {!mySeat && (
        <CrapsLocalPreview
          name={myDisplayName || 'You'}
          stream={camStream}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
        />
      )}

      <CrapsFairness table={table} />

      <ChatPanel room={room} mySessionId={mySessionId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase banner — phase + point + roll number.
// ---------------------------------------------------------------------------

function CrapsPhaseBanner({ table }: { table: CrapsTableView }) {
  const phaseLabel = {
    between: 'Calling bets',
    comeOut: 'Come-out roll',
    point: `Point ${table.point}`,
    paused: 'Paused',
  }[table.phase];
  return (
    <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border border-border-hi bg-black/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink backdrop-blur">
      <span className="text-sunset">Craps</span>
      <span>{phaseLabel}</span>
      <span className="text-ink-mute">{table.name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The felt itself — the visual heart of the game.
// ---------------------------------------------------------------------------

function CrapsFelt({
  table,
  mySeat,
  mySessionId,
  room,
  chip,
  setChip,
  lastResult,
  ribbonResult,
}: {
  table: CrapsTableView;
  mySeat: CrapsSeatView | null;
  mySessionId: string | null;
  room: Room | null;
  chip: number;
  setChip: (n: number) => void;
  lastResult: RollResult | null;
  ribbonResult: RollResult | null;
}) {
  const myBets = useMemo(
    () => table.bets.filter((b) => mySeat && b.seatIndex === mySeat.index),
    [table.bets, mySeat],
  );
  const place = useCallback(
    (kind: BetKind) => {
      if (!mySeat) {
        return;
      }
      if (!room) return;
      room.send(C2S.action, { type: 'placeBet', kind, amount: chip });
    },
    [mySeat, room, chip],
  );
  const remove = useCallback(
    (betId: string) => {
      if (!room) return;
      room.send(C2S.action, { type: 'removeBet', betId });
    },
    [room],
  );
  const point = table.point;
  const last = table.lastRoll;

  // Bets bucketed by kind for fast lookup inside each layout cell.
  const betsByKind = useMemo(() => {
    const m = new Map<string, CrapsBetView[]>();
    for (const b of myBets) {
      const arr = m.get(b.kind) ?? [];
      arr.push(b);
      m.set(b.kind, arr);
    }
    return m;
  }, [myBets]);
  const of = (k: string) => betsByKind.get(k) ?? [];

  return (
    <section className="craps-felt relative overflow-hidden rounded-[36px] border border-white/10 px-3 py-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] sm:px-6 sm:py-7">
      {/* Polished oak rail around the entire layout — that warm wood frame
       *  every real Vegas craps table has. */}
      <CrapsRail />

      {/* Win/lose ribbon — mirrors the Blackjack settling banner. Fades in
       *  after the dice land and disappears a few seconds later. */}
      {ribbonResult && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-3">
          <CrapsResultRibbon r={ribbonResult} mySessionId={mySessionId} />
        </div>
      )}

      {/* Top status row — dice, point puck, shooter */}
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 px-2 sm:px-4">
        <div className="flex flex-col items-start gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">Roll</p>
          <DicePair last={last} roll={lastResult} />
          {last && (
            <p className="text-[10px] uppercase tracking-wider text-ink-mute">
              Roll #{last.rollNumber} · {phaseHint(table)}
            </p>
          )}
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">Point</p>
          <PointPuck point={point} />
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">Shooter</p>
          <ShooterTag table={table} />
        </div>
      </div>

      {/* THE LAYOUT — the real Craps table.
       *  1. Place numbers across the top (4 · 5 · SIX · 8 · NINE · 10)
       *  2. COME bar (full-width)
       *  3. FIELD with all qualifying numbers spelled inline and 2/12 circled
       *  4. Center prop ring (hardways above any-7 / props below)
       *  5. DON'T PASS BAR — full-width strip
       *  6. PASS LINE — the bottom rail, curved and gold-bordered. */}
      <div className="relative z-10 mt-4 rounded-[28px] border border-amber/35 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(43,184,158,.12),transparent_70%)] p-2 sm:p-3">
        {/* 1. PLACE NUMBERS — six tall boxes across the top of the layout */}
        <div className="grid grid-cols-6 gap-1.5">
          {(
            [
              { n: 4, key: 'place4', label: 'FOUR' },
              { n: 5, key: 'place5', label: 'FIVE' },
              { n: 6, key: 'place6', label: 'SIX' },
              { n: 8, key: 'place8', label: 'EIGHT' },
              { n: 9, key: 'place9', label: 'NINE' },
              { n: 10, key: 'place10', label: 'TEN' },
            ] as const
          ).map(({ n, key, label }) => (
            <PlaceBox
              key={n}
              numeral={n}
              wordLabel={label}
              payout={placePayoutLabel(n)}
              isPoint={point === n}
              onClick={() => place(key as BetKind)}
              chips={of(key)}
              onRemove={remove}
            />
          ))}
        </div>

        {/* 2. COME BAR — long full-width strip */}
        <ComeBar
          onClick={() => place('come')}
          disabled={point === 0}
          chips={of('come')}
          onRemove={remove}
        />

        {/* 3. FIELD — wide bar with all qualifying numbers, 2 & 12 circled */}
        <FieldBar onClick={() => place('field')} chips={of('field')} onRemove={remove} />

        {/* 4. CENTER PROP RING — hardways + Any Seven + 1-roll specials.
         *  This is the "stadium" middle that every real craps table has. */}
        <CenterPropRing place={place} of={of} onRemove={remove} />

        {/* 5. DON'T COME / DON'T PASS row — sits above the Pass Line, mirrors
         *  the canonical "Bar 12" stripe at the top of the rail. */}
        <div className="mt-1.5 grid grid-cols-12 gap-1.5">
          <DontComeBox
            onClick={() => place('dontCome')}
            disabled={point === 0}
            chips={of('dontCome')}
            onRemove={remove}
          />
          <DontPassBar
            onClick={() => place('dontPass')}
            chips={of('dontPass')}
            onRemove={remove}
          />
        </div>

        {/* 6. PASS LINE — the curved gold rail along the bottom (the player
         *  side of every real craps table). */}
        <PassLineRail
          onClick={() => place('pass')}
          chips={of('pass')}
          onRemove={remove}
        />
      </div>

      {/* CHIP RAIL — pick a denomination, then click any pad to place.
       *  (Roll button lives in the top action bar above the table now.) */}
      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-3 px-2 sm:px-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber">Chip</p>
        <div className="flex flex-wrap gap-1.5">
          {[table.minBet, 25, 50, 100, 250].filter((v) => v >= table.minBet).map((v) => (
            <ChipButton key={v} value={v} active={chip === v} onClick={() => setChip(v)} />
          ))}
        </div>
        {mySeat && (
          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
            Stack <span className="text-ink">{mySeat.stack}</span>
          </span>
        )}
      </div>
    </section>
  );
}

// Primary action surface, anchored above the felt. Renders the Sit-down CTA
// for spectators and the big Roll button for the shooter, so the user's
// next action is the first thing they see when the page loads.
function CrapsActionBar({
  table,
  mySeat,
  room,
  myDisplayName,
}: {
  table: CrapsTableView;
  mySeat: CrapsSeatView | null;
  room: Room | null;
  myDisplayName: string;
}) {
  const isShooter = mySeat?.isShooter ?? false;
  if (!mySeat) {
    return (
      <SitToBuyIn table={table} room={room} myDisplayName={myDisplayName} />
    );
  }
  if (isShooter) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sunset/55 bg-black/40 px-4 py-3 shadow-[0_0_40px_-6px_rgba(255,106,61,.5)] backdrop-blur">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-sunset">
            You're the shooter
          </p>
          <p className="text-sm text-white/85">
            Roll the dice when you're ready — the table waits for you.
          </p>
        </div>
        <button
          onClick={() => room?.send(C2S.action, { type: 'roll' })}
          className="tap-target rounded-2xl bg-gradient-to-br from-sunset-bright to-sunset px-5 py-3 text-sm font-bold uppercase tracking-[0.2em] text-white shadow-sunset transition hover:-translate-y-0.5"
        >
          Roll the dice →
        </button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vegas-style craps table pieces
// ---------------------------------------------------------------------------

// The rail — a polished wood ring around the entire layout. Inside is the
// felt, outside is the cushioned rim where chips would sit.
// Big result ribbon for Craps — matches the Blackjack HandResultRibbon
// shape (mood-coloured ring + headline + signed delta). The eyebrow trades
// "Round N · Dealer X" for "Roll #N · total (a+b)", and seven-out /
// point-made get their own celebratory headlines for non-betting players.
function CrapsResultRibbon({
  r,
  mySessionId,
}: {
  r: RollResult;
  mySessionId: string | null;
}) {
  // Find my delta by walking back through the room snapshot in store.
  const table = useStore((s) => s.crapsTable);
  const mySeatIndex = table?.seats.find((s) => s.playerId === mySessionId)?.index ?? -1;
  const mine = r.perSeat.find((p) => p.seatIndex === mySeatIndex);
  const delta = mine?.delta ?? 0;
  const mood: 'win' | 'lose' | 'push' =
    delta > 0 ? 'win' : delta < 0 ? 'lose' : 'push';
  const headline =
    delta > 0
      ? r.pointMade
        ? 'Point made!'
        : 'You won'
      : delta < 0
      ? r.sevenOut
        ? 'Seven out'
        : 'You lost'
      : r.pointMade
      ? 'Point made!'
      : r.sevenOut
      ? 'Seven out'
      : 'No action';
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
    mood === 'win' ? 'text-win' : mood === 'lose' ? 'text-[#FF9DAC]' : 'text-amber';
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
            Roll #{r.rollNumber} · {r.roll.total} ({r.roll.a}+{r.roll.b})
          </span>
          <span className={'font-display text-xl font-black leading-tight sm:text-2xl ' + headlineClass}>
            {headline}
          </span>
        </div>
        {mine && (
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-ink-mute">
              Net
            </span>
            <span className={'font-display text-xl font-black tabular-nums leading-tight sm:text-2xl ' + deltaClass}>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function CrapsRail() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[36px] [background:radial-gradient(120%_120%_at_50%_0%,transparent_70%,rgba(0,0,0,.45))]"
      style={{
        boxShadow:
          'inset 0 0 0 6px rgba(70,40,18,.85), inset 0 0 0 8px rgba(255,177,78,.35), inset 0 0 0 14px rgba(38,22,10,.9)',
      }}
    />
  );
}

// A "place" number box — looks like a real layout cell, with the digit huge,
// the spelled-out word below, and the payout at the foot.
function PlaceBox({
  numeral,
  wordLabel,
  payout,
  isPoint,
  onClick,
  chips,
  onRemove,
}: {
  numeral: number;
  wordLabel: string;
  payout: string;
  isPoint: boolean;
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'group relative flex h-24 flex-col items-center justify-between rounded-xl border bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,255,255,.06),rgba(0,0,0,.35))] px-1.5 py-1.5 text-center transition hover:-translate-y-0.5 hover:border-amber/40 ' +
        (isPoint
          ? 'border-amber ring-2 ring-amber/55 shadow-[0_0_24px_-6px_rgba(255,177,78,.55)]'
          : 'border-white/15')
      }
    >
      {/* When the shooter has this number as their point, drop a white "ON"
       *  puck on top of the box — same way a real craps table marks the
       *  point. The puck flops into place via CSS keyframe and persists
       *  until the puck moves elsewhere (or back to OFF). */}
      {isPoint && (
        <span className="point-flop pointer-events-none absolute -top-3 right-1 z-10 grid h-9 w-9 place-items-center rounded-full border-2 border-amber bg-white font-display text-[10px] font-bold uppercase tracking-wider text-black shadow-[0_4px_14px_rgba(255,177,78,.55)]">
          ON
        </span>
      )}
      <span className="font-display text-3xl font-bold leading-none text-ink sm:text-4xl">
        {numeral}
      </span>
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-amber">
        {wordLabel}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/55">
        Pays {payout}
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// COME bar — long horizontal strip with the word "COME" in big spaced
// letters, matching the casino layout. Locks when no point is set.
function ComeBar({
  onClick,
  disabled,
  chips,
  onRemove,
}: {
  onClick: () => void;
  disabled: boolean;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'relative mt-1.5 flex h-14 w-full items-center justify-center rounded-xl border border-white/20 bg-black/30 text-center transition ' +
        (disabled
          ? 'cursor-not-allowed opacity-45'
          : 'hover:-translate-y-0.5 hover:border-amber/40')
      }
    >
      <span className="font-display text-2xl font-bold uppercase tracking-[0.6em] text-white sm:text-3xl">
        Come
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// FIELD bar — wide bar with the qualifying numbers spelled inline and 2/12
// circled in gold (those pay 2:1).
function FieldBar({
  onClick,
  chips,
  onRemove,
}: {
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  const nums: Array<{ n: number; double?: boolean }> = [
    { n: 2, double: true },
    { n: 3 },
    { n: 4 },
    { n: 9 },
    { n: 10 },
    { n: 11 },
    { n: 12, double: true },
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative mt-1.5 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-felt/55 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(43,184,158,.2),rgba(0,0,0,.3))] px-2 py-3 transition hover:-translate-y-0.5 hover:border-amber/40"
    >
      <span className="font-display text-2xl font-bold uppercase tracking-[0.5em] text-[#7AE0CC] sm:text-3xl">
        Field
      </span>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {nums.map(({ n, double }) => (
          <span
            key={n}
            className={
              'inline-flex h-8 w-8 items-center justify-center rounded-full font-display text-base font-bold sm:h-9 sm:w-9 sm:text-lg ' +
              (double
                ? 'border-2 border-amber bg-amber/15 text-amber shadow-[0_0_14px_-4px_rgba(255,177,78,.55)]'
                : 'border border-white/30 text-ink')
            }
          >
            {n}
          </span>
        ))}
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/55">
        Pays 1:1 · 2 &amp; 12 pay 2:1
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// Center prop ring — the "stadium" middle of the craps layout. Four hardway
// boxes around an Any Seven center, with one-roll specials below.
function CenterPropRing({
  place,
  of,
  onRemove,
}: {
  place: (k: BetKind) => void;
  of: (k: string) => CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mt-1.5 rounded-2xl border border-amber/30 bg-[radial-gradient(120%_120%_at_50%_0%,rgba(0,0,0,.35),rgba(0,0,0,.5))] p-2">
      <p className="text-center text-[10px] font-bold uppercase tracking-[0.5em] text-amber/70">
        Center · Proposition
      </p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        <HardBox n={4} payout="7:1" onClick={() => place('hard4')} chips={of('hard4')} onRemove={onRemove} />
        <HardBox n={6} payout="9:1" onClick={() => place('hard6')} chips={of('hard6')} onRemove={onRemove} />
        <AnySevenCenter onClick={() => place('any7')} chips={of('any7')} onRemove={onRemove} />
        <HardBox n={8} payout="9:1" onClick={() => place('hard8')} chips={of('hard8')} onRemove={onRemove} />
        <HardBox n={10} payout="7:1" onClick={() => place('hard10')} chips={of('hard10')} onRemove={onRemove} />
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        <PropBox label="Yo · 11" payout="15:1" onClick={() => place('yo')} chips={of('yo')} onRemove={onRemove} />
        <PropBox label="Ace-Deuce · 3" payout="15:1" onClick={() => place('aceDeuce')} chips={of('aceDeuce')} onRemove={onRemove} />
        <PropBox label="Any Craps" payout="7:1" onClick={() => place('anyCraps')} chips={of('anyCraps')} onRemove={onRemove} />
        <PropBox label="Snake Eyes · 2" payout="30:1" onClick={() => place('snakeEyes')} chips={of('snakeEyes')} onRemove={onRemove} />
        <PropBox label="Box Cars · 12" payout="30:1" onClick={() => place('boxCars')} chips={of('boxCars')} onRemove={onRemove} />
      </div>
    </div>
  );
}

function HardBox({
  n,
  payout,
  onClick,
  chips,
  onRemove,
}: {
  n: number;
  payout: string;
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  // The hardway icon is two dice both showing n/2 pips.
  const pip = n / 2;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-rose/35 bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,92,122,.22),rgba(0,0,0,.4))] px-1 py-1.5 transition hover:-translate-y-0.5 hover:border-amber/45"
    >
      <div className="flex gap-0.5">
        <MiniDice pip={pip} />
        <MiniDice pip={pip} />
      </div>
      <span className="font-display text-[11px] font-bold uppercase tracking-wider text-[#FFB7C5]">
        Hard {n}
      </span>
      <span className="text-[9px] font-bold tracking-wider text-white/55">{payout}</span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

function AnySevenCenter({
  onClick,
  chips,
  onRemove,
}: {
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-amber/60 bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,177,78,.35),rgba(0,0,0,.5))] px-1 py-1.5 transition hover:-translate-y-0.5"
    >
      <span className="font-display text-4xl font-bold text-amber drop-shadow-[0_2px_6px_rgba(255,177,78,.55)]">
        7
      </span>
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-amber">
        Any Seven
      </span>
      <span className="text-[9px] font-bold tracking-wider text-white/55">4:1</span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

function PropBox({
  label,
  payout,
  onClick,
  chips,
  onRemove,
}: {
  label: string;
  payout: string;
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/15 bg-black/30 px-1 py-1 transition hover:-translate-y-0.5 hover:border-amber/40"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </span>
      <span className="text-[9px] font-bold tracking-wider text-amber/85">{payout}</span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// DON'T COME box — small left-aligned box, like the canonical layout.
function DontComeBox({
  onClick,
  disabled,
  chips,
  onRemove,
}: {
  onClick: () => void;
  disabled: boolean;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'col-span-3 relative flex h-12 items-center justify-center rounded-xl border border-white/20 bg-black/30 px-2 transition ' +
        (disabled
          ? 'cursor-not-allowed opacity-45'
          : 'hover:-translate-y-0.5 hover:border-amber/40')
      }
    >
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.3em] text-ink-soft">
        Don't Come
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// DON'T PASS BAR — wide strip with "BAR 12" indicator. Pushes on 12.
function DontPassBar({
  onClick,
  chips,
  onRemove,
}: {
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-9 relative flex h-12 items-center justify-between rounded-xl border border-white/20 bg-black/30 px-4 transition hover:-translate-y-0.5 hover:border-amber/40"
    >
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.4em] text-ink">
        Don't Pass Bar
      </span>
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-amber/55 bg-amber/10 text-[10px] font-bold text-amber">
        12
      </span>
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-ink-soft">
        Pays 1:1
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// PASS LINE — the long curved rail along the bottom. Gold-bordered, with
// curved typography matching real felts.
function PassLineRail({
  onClick,
  chips,
  onRemove,
}: {
  onClick: () => void;
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative mt-1.5 flex h-16 w-full items-center justify-center overflow-hidden rounded-[20px] border-2 border-amber/55 bg-[radial-gradient(120%_140%_at_50%_120%,rgba(255,177,78,.35),rgba(0,0,0,.45))] px-4 transition hover:-translate-y-0.5 hover:border-amber/80"
    >
      <span className="absolute inset-x-6 bottom-1 h-px bg-gradient-to-r from-transparent via-amber/80 to-transparent" />
      <span className="font-display text-2xl font-bold uppercase tracking-[0.6em] text-amber drop-shadow-[0_2px_6px_rgba(255,177,78,.45)] sm:text-3xl">
        Pass Line
      </span>
      {chips.length > 0 && <ChipsCluster chips={chips} onRemove={onRemove} />}
    </button>
  );
}

// Small dice icon (used inside hardway boxes).
function MiniDice({ pip }: { pip: number }) {
  const dots: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  };
  const list = dots[pip] ?? [];
  return (
    <div className="grid h-6 w-6 grid-cols-3 grid-rows-3 gap-0.5 rounded bg-[#FBF3EB] p-0.5">
      {Array.from({ length: 9 }).map((_, i) => {
        const r = Math.floor(i / 3);
        const c = i % 3;
        const on = list.some(([rr, cc]) => rr === r && cc === c);
        return (
          <span
            key={i}
            className={'h-full w-full rounded-full ' + (on ? 'bg-[#14101A]' : 'bg-transparent')}
          />
        );
      })}
    </div>
  );
}

// Chip cluster on a placed bet — small chips with the total visible. Click
// any to pull the bet (where legal).
function ChipsCluster({
  chips,
  onRemove,
}: {
  chips: CrapsBetView[];
  onRemove: (id: string) => void;
}) {
  const total = chips.reduce((s, b) => s + b.amount, 0);
  return (
    <span
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        const last = chips[chips.length - 1];
        if (last) onRemove(last.id);
      }}
      title="Click to pull this bet"
      className="absolute right-1 top-1 inline-flex items-center gap-1 rounded-full border border-amber/55 bg-black/65 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber backdrop-blur"
    >
      <span className="h-2 w-2 rounded-full bg-amber shadow-[0_0_6px_rgba(255,177,78,.7)]" />
      {total}
    </span>
  );
}

function phaseHint(t: CrapsTableView): string {
  if (t.phase === 'comeOut') return 'come-out roll';
  if (t.phase === 'point') return `point ${t.point}`;
  if (t.phase === 'between') return 'calling bets';
  return 'paused';
}

function placePayoutLabel(n: number): string {
  if (n === 4 || n === 10) return '9:5';
  if (n === 5 || n === 9) return '7:5';
  return '7:6';
}

// ---------------------------------------------------------------------------
// Atomic UI pieces
// ---------------------------------------------------------------------------

// DicePair — hides the actual roll until the 3-second tumble lands.
//
// When a new rollNumber arrives, we kick off a 3-second "rolling" sequence:
// the on-screen pips cycle through random values every ~80ms while the CSS
// keyframe spins the dice cubes. At the end of the window we snap to the
// real (server-authoritative) values so the reveal feels like the dice
// actually came to a stop.
function DicePair({
  last,
}: {
  last: CrapsTableView['lastRoll'];
  roll: RollResult | null;
}) {
  const rollNum = last?.rollNumber ?? 0;
  const [display, setDisplay] = useState<{ a: number; b: number } | null>(() =>
    last ? { a: last.a, b: last.b } : null,
  );
  const [rolling, setRolling] = useState(false);
  const lastSeen = useRef(0);

  // Keep the latest `last` available to the timeout via a ref — without this,
  // the effect would have to list `last` as a dep, but `toCrapsView` returns
  // a fresh object every Colyseus state patch. Every patch would clean up the
  // in-flight tumble and the guard `rollNum === lastSeen.current` would skip
  // restarting it, leaving the dice frozen on random pips that don't match
  // the point puck (which updates immediately from state.point).
  const latestRollRef = useRef(last);
  latestRollRef.current = last;

  useEffect(() => {
    if (rollNum === 0 || rollNum === lastSeen.current) return;
    lastSeen.current = rollNum;
    setRolling(true);
    const interval = setInterval(() => {
      setDisplay({
        a: 1 + Math.floor(Math.random() * 6),
        b: 1 + Math.floor(Math.random() * 6),
      });
    }, 70);
    // Shorter tumble (1.2s) so the dice land close to when the point puck
    // updates, instead of staying random for ~3s while the puck already shows
    // the new point.
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setRolling(false);
      const cur = latestRollRef.current;
      if (cur) setDisplay({ a: cur.a, b: cur.b });
    }, 1200);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [rollNum]);

  // Defensive: if `last` has up-to-date values for the current rollNumber and
  // the tumble is done, make sure display matches. Catches the case where the
  // server rolled before we mounted, or a state patch arrived after the
  // initial mount with values that bypassed the animation path.
  useEffect(() => {
    if (rolling || !last) return;
    if (display && display.a === last.a && display.b === last.b) return;
    if (lastSeen.current === last.rollNumber) {
      setDisplay({ a: last.a, b: last.b });
    }
  }, [last, rolling, display]);

  if (!display) {
    return (
      <div className="flex gap-2">
        <DiceFace pip={0} />
        <DiceFace pip={0} />
      </div>
    );
  }
  return (
    <div key={rollNum} className="flex gap-2">
      <DiceFace pip={display.a} animate={rolling} />
      <DiceFace pip={display.b} animate={rolling} />
    </div>
  );
}

function DiceFace({ pip, animate }: { pip: number; animate?: boolean }) {
  // Pip positions in a 3x3 grid for each face.
  const dots: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
  };
  const list = dots[pip] ?? [];
  return (
    <div
      className={
        'relative grid h-14 w-14 grid-cols-3 grid-rows-3 gap-1 rounded-xl border border-black/30 bg-gradient-to-br from-[#FBF3EB] to-[#E5D8C8] p-1.5 shadow-[0_10px_24px_-8px_rgba(0,0,0,.6)] sm:h-16 sm:w-16 ' +
        (animate ? 'dice-tumble' : '')
      }
    >
      {Array.from({ length: 9 }).map((_, idx) => {
        const r = Math.floor(idx / 3);
        const c = idx % 3;
        const on = list.some(([rr, cc]) => rr === r && cc === c);
        return (
          <span
            key={idx}
            className={'h-full w-full rounded-full ' + (on ? 'bg-[#14101A]' : 'bg-transparent')}
          />
        );
      })}
    </div>
  );
}

function PointPuck({ point }: { point: number }) {
  const on = point !== 0;
  // Re-mount the puck whenever the point value changes so the flop / OFF
  // animation plays. Once it's on the number, the pulse keeps the eye on it
  // until the shooter sevens out and it flips back to OFF.
  return (
    <div
      key={point}
      className={
        'point-flop grid h-14 w-14 place-items-center rounded-full border-2 text-lg font-display font-bold sm:h-16 sm:w-16 ' +
        (on
          ? 'point-active border-amber bg-gradient-to-br from-amber to-sunset text-black'
          : 'border-white/20 bg-black/30 text-ink-mute')
      }
    >
      {on ? point : 'OFF'}
    </div>
  );
}

function ShooterTag({ table }: { table: CrapsTableView }) {
  const shooter = table.seats.find((s) => s.isShooter);
  if (!shooter || !shooter.playerId) {
    return (
      <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-mute">
        Waiting for shooter
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="rounded-full border border-amber/55 bg-gradient-to-r from-amber/25 to-sunset/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber">
        🎲 {shooter.displayName || `Seat ${shooter.index + 1}`}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-ink-mute">
        Rolls this hand: {table.rollsThisShooter}
      </span>
    </div>
  );
}

function ChipButton({
  value,
  active,
  onClick,
}: {
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'tap-target relative grid h-12 w-12 place-items-center rounded-full border-2 text-[12px] font-display font-bold transition ' +
        (active
          ? 'border-amber bg-gradient-to-br from-amber to-sunset text-black shadow-[0_0_22px_-6px_rgba(255,177,78,.65)]'
          : 'border-white/20 bg-black/40 text-ink hover:border-amber/55')
      }
    >
      {value}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Roster + sit panel
// ---------------------------------------------------------------------------

// PlayerRail — a horizontal strip of webcam tiles for everyone at the craps
// table. Each tile shows the player's face, name, stack, P/L, and any badges
// (shooter, you). Speaking players pulse green; the shooter is haloed gold.
function PlayerRail({
  table,
  mySessionId,
  camStream,
  peerStreams,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  table: CrapsTableView;
  mySessionId: string | null;
  camStream: MediaStream | null;
  peerStreams: Map<string, MediaStream>;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  const occupied = table.seats.filter((s) => s.playerId);
  if (occupied.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface/60 px-3 py-2 text-xs text-ink-mute backdrop-blur">
        Be the first to step up to the rail.
      </div>
    );
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {occupied.map((s) => {
        const mine = s.playerId === mySessionId;
        const stream = mine ? camStream : peerStreams.get(s.identityId) ?? null;
        return (
          <CrapsSeatTile
            key={s.index}
            seat={s}
            mine={mine}
            stream={stream}
            micEnabled={mine ? micEnabled : undefined}
            camEnabled={mine ? camEnabled : undefined}
            onToggleMic={mine ? onToggleMic : undefined}
            onToggleCam={mine ? onToggleCam : undefined}
          />
        );
      })}
    </div>
  );
}

// One occupied seat at the rail. Cleaner than the blackjack tile because
// craps doesn't need a "hand" — just a face, a name, a stack, and the
// shooter badge.
function CrapsSeatTile({
  seat,
  mine,
  stream,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  seat: CrapsSeatView;
  mine: boolean;
  stream: MediaStream | null;
  micEnabled?: boolean;
  camEnabled?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const showVideo = !!stream && (!mine || camEnabled !== false);
  const speakingLevel = useStore((s) =>
    seat.identityId ? s.speakingLevels.get(seat.identityId) ?? 0 : 0,
  );
  const isSpeaking = speakingLevel > 0.05;
  const speakIntensity = Math.min(1, speakingLevel * 4);
  const speakingStyle: React.CSSProperties = isSpeaking
    ? {
        boxShadow: `0 0 0 ${2 + speakIntensity * 4}px rgba(63,190,147,${0.35 +
          speakIntensity * 0.35}), 0 0 ${20 + speakIntensity * 30}px rgba(63,190,147,${0.25 +
          speakIntensity * 0.35})`,
      }
    : {};
  const netTone =
    seat.netProfit > 0 ? 'text-win' : seat.netProfit < 0 ? 'text-fold' : 'text-ink-mute';
  return (
    <div
      style={speakingStyle}
      className={
        'relative w-[150px] shrink-0 overflow-visible rounded-2xl border bg-gradient-to-b from-surface to-bg-2 p-1.5 sm:w-[164px] ' +
        (seat.isShooter
          ? 'border-amber/65 shadow-[0_0_30px_-6px_rgba(255,177,78,.55)]'
          : isSpeaking
          ? 'border-win/60'
          : mine
          ? 'border-amber/45'
          : 'border-white/10')
      }
    >
      {/* Video tile (portrait) */}
      <div
        className={
          'relative aspect-[3/4] w-full overflow-hidden rounded-xl border ' +
          (mine ? 'border-amber/45' : 'border-white/10') +
          ' ' +
          (showVideo ? 'bg-black' : 'bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3]')
        }
      >
        {/* Shooter badge — sits INSIDE the video tile so the parent's
         *  horizontal overflow scroller can't clip it off. */}
        {seat.isShooter && (
          <span className="absolute left-1/2 top-1.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber/65 bg-gradient-to-r from-amber to-sunset px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black shadow-[0_4px_14px_rgba(255,177,78,.6)]">
            🎲 Shooter
          </span>
        )}
        {showVideo ? (
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{
              transform: `scale(1.55) translateY(-2%)${mine ? ' scaleX(-1)' : ''}`,
              transformOrigin: 'center 32%',
            }}
          />
        ) : (
          <div className="grid h-full place-items-center font-display text-4xl font-bold text-white/85">
            {initialsOf(seat.displayName)}
          </div>
        )}

        {/* Bottom gradient with name */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-5">
          <p className="truncate font-display text-[12px] font-bold leading-tight text-white">
            {seat.displayName || `Seat ${seat.index + 1}`}
          </p>
        </div>

        {/* Mic / cam controls — local tile only. Anchored bottom-right so
         *  they never collide with the shooter badge at the top of the
         *  video tile. */}
        {mine && (onToggleMic || onToggleCam) && (
          <div className="absolute bottom-1.5 right-1.5 flex gap-1">
            {onToggleMic && (
              <button
                onClick={onToggleMic}
                title={micEnabled ? 'Mute mic' : 'Unmute mic'}
                className={
                  'tap-target grid h-6 w-6 place-items-center rounded-full border text-[10px] backdrop-blur transition ' +
                  (micEnabled
                    ? 'border-white/25 bg-black/55 text-white hover:bg-black/70'
                    : 'border-fold/40 bg-fold/50 text-white animate-pulseSunset')
                }
              >
                {micEnabled ? '🎤' : '🔇'}
              </button>
            )}
            {onToggleCam && (
              <button
                onClick={onToggleCam}
                title={camEnabled ? 'Stop video' : 'Start video'}
                className={
                  'tap-target grid h-6 w-6 place-items-center rounded-full border text-[10px] backdrop-blur transition ' +
                  (camEnabled
                    ? 'border-white/25 bg-black/55 text-white hover:bg-black/70'
                    : 'border-fold/40 bg-fold/50 text-white animate-pulseSunset')
                }
              >
                {camEnabled ? '📹' : '🎥'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stack + net P/L */}
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
        <span className="inline-flex items-center gap-1">
          <CrapsChipIcon tone={chipToneForStack(seat.stack)} />
          <span className="font-display text-sm font-bold leading-none text-ink">
            {seat.stack}
            <span className="ml-0.5 text-[9px] font-medium uppercase tracking-wider text-ink-mute">
              chips
            </span>
          </span>
        </span>
        {seat.handsRolled > 0 && (
          <span className={'text-[11px] font-bold tabular-nums ' + netTone}>
            {seat.netProfit > 0 ? '+' : ''}
            {seat.netProfit}
          </span>
        )}
      </div>
    </div>
  );
}

// Compact chip icon for the tile's chip count line. Same brand palette as
// the Blackjack chip glyph, lighter weight (the count is the hero, not the
// icon).
type CrapsChipTone = 'white' | 'red' | 'green' | 'black' | 'purple';
function chipToneForStack(stack: number): CrapsChipTone {
  if (stack < 200) return 'white';
  if (stack < 500) return 'red';
  if (stack < 1500) return 'green';
  if (stack < 5000) return 'black';
  return 'purple';
}
function chipPalette(tone: CrapsChipTone) {
  switch (tone) {
    case 'white':  return { rim: '#F5EBE0', ring: '#FBF3EB', center: '#FFFFFF', accent: '#E0556B' };
    case 'red':    return { rim: '#E0556B', ring: '#FF5C7A', center: '#FBF3EB', accent: '#FFFFFF' };
    case 'green':  return { rim: '#0E5C57', ring: '#14706A', center: '#FBF3EB', accent: '#FFB14E' };
    case 'black':  return { rim: '#14101A', ring: '#211A2B', center: '#FBF3EB', accent: '#FFB14E' };
    case 'purple': return { rim: '#4A2E78', ring: '#7A4FA3', center: '#FBF3EB', accent: '#FFB14E' };
  }
}
function CrapsChipIcon({ tone }: { tone: CrapsChipTone }) {
  const { rim, ring, center, accent } = chipPalette(tone);
  return (
    <svg viewBox="0 0 32 32" width={18} height={18} className="shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,.4)]">
      <circle cx="16" cy="16" r="15" fill={rim} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <rect
          key={deg}
          x="14.8"
          y="1.5"
          width="2.4"
          height="5"
          rx="0.5"
          fill={accent}
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
      <circle cx="16" cy="16" r="10.5" fill={ring} stroke="rgba(255,255,255,.18)" strokeWidth="0.8" />
      <circle cx="16" cy="16" r="7.5" fill={center} />
    </svg>
  );
}

// Floating local preview when the user hasn't picked up the dice — lets
// them frame their camera and toggle mic before sitting.
function CrapsLocalPreview({
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
          'relative h-28 w-24 overflow-hidden rounded-2xl border border-amber/60 shadow-[0_20px_50px_-18px_rgba(0,0,0,.7)] sm:h-32 sm:w-28 ' +
          (showVideo ? 'bg-black' : 'bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3]')
        }
      >
        {showVideo ? (
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{
              transform: 'scale(1.55) translateY(-2%) scaleX(-1)',
              transformOrigin: 'center 32%',
            }}
          />
        ) : (
          <div className="grid h-full place-items-center font-display text-3xl font-bold text-white/85">
            {initialsOf(name)}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
          {!micEnabled && <span className="mr-1 text-fold">🚫</span>}
          <span className="truncate">{name}</span>
        </div>
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
          <button
            onClick={onToggleMic}
            title={micEnabled ? 'Mute mic' : 'Unmute mic'}
            className={
              'grid h-6 w-6 place-items-center rounded-full border text-[10px] backdrop-blur transition ' +
              (micEnabled
                ? 'border-white/25 bg-black/55 text-white'
                : 'border-fold/40 bg-fold/50 text-white animate-pulseSunset')
            }
          >
            {micEnabled ? '🎤' : '🔇'}
          </button>
          <button
            onClick={onToggleCam}
            title={camEnabled ? 'Stop video' : 'Start video'}
            className={
              'grid h-6 w-6 place-items-center rounded-full border text-[10px] backdrop-blur transition ' +
              (camEnabled
                ? 'border-white/25 bg-black/55 text-white'
                : 'border-fold/40 bg-fold/50 text-white animate-pulseSunset')
            }
          >
            {camEnabled ? '📹' : '🎥'}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase().slice(0, 2);
}

function SitToBuyIn({
  table,
  room,
  myDisplayName,
}: {
  table: CrapsTableView;
  room: Room | null;
  myDisplayName: string;
}) {
  const openSeat = table.seats.find((s) => !s.playerId);
  if (!openSeat) return null;
  const buyIn = 1000;
  return (
    <div className="rounded-2xl border border-amber/45 bg-amber/10 px-4 py-3 backdrop-blur">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber">
        Step up to the rail
      </p>
      <p className="mt-1 text-sm text-ink">
        {myDisplayName || 'You'} — buy in for {buyIn} chips and get a seat at the felt.
      </p>
      <button
        onClick={() =>
          room?.send(C2S.action, { type: 'sit', seatIndex: openSeat.index, buyIn })
        }
        className="mt-3 inline-flex rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-2.5 text-sm font-bold text-white shadow-sunset"
      >
        Take seat {openSeat.index + 1} →
      </button>
    </div>
  );
}

function CrapsFairness({ table }: { table: CrapsTableView }) {
  if (!table.commitHash) return null;
  return (
    <details className="rounded-xl border border-border bg-bg-2/40 px-3 py-2 text-[10px] text-ink-mute">
      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
        Provably fair · next roll committed
      </summary>
      <p className="mt-1 font-mono break-all">commit: {table.commitHash.slice(0, 32)}…</p>
      {table.revealedSeed && (
        <p className="mt-1 font-mono break-all">
          last seed: {table.revealedSeed.slice(0, 32)}…
        </p>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Schema -> view transform
// ---------------------------------------------------------------------------

interface ServerCrapsSeat {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  buyIn: number;
  connected: boolean;
  graceMs: number;
  isShooter: boolean;
  handsRolled: number;
  netProfit: number;
  longestRoll: number;
}
interface ServerCrapsBet {
  id: string;
  seatIndex: number;
  kind: string;
  amount: number;
  point: number;
}
interface ServerCrapsRoll {
  a: number;
  b: number;
  total: number;
  isHard: boolean;
  isCraps: boolean;
  isNatural: boolean;
  commitHash: string;
  seed: string;
  rollNumber: number;
  ts: number;
}
interface ServerCrapsSchema {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: string;
  phaseClockMs: number;
  point: number;
  shooterSeat: number;
  rollsThisShooter: number;
  lastRoll: ServerCrapsRoll;
  commitHash: string;
  revealedSeed: string;
  hostId: string;
  seats: ServerCrapsSeat[];
  bets: ServerCrapsBet[];
}

function toCrapsView(s: ServerCrapsSchema): CrapsTableView {
  const seats = s.seats
    ? Array.from(s.seats).filter(Boolean).map((seat) => ({
        index: seat.index,
        playerId: seat.playerId ?? '',
        identityId: seat.identityId ?? '',
        displayName: seat.displayName ?? '',
        stack: seat.stack ?? 0,
        buyIn: seat.buyIn ?? 0,
        connected: seat.connected ?? true,
        graceMs: seat.graceMs ?? 0,
        isShooter: !!seat.isShooter,
        handsRolled: seat.handsRolled ?? 0,
        netProfit: seat.netProfit ?? 0,
        longestRoll: seat.longestRoll ?? 0,
      }))
    : [];
  const bets = s.bets
    ? Array.from(s.bets).filter(Boolean).map((b) => ({
        id: b.id ?? '',
        seatIndex: b.seatIndex ?? 0,
        kind: b.kind ?? '',
        amount: b.amount ?? 0,
        point: b.point ?? 0,
      }))
    : [];
  // lastRoll comes through always (DiceRollSchema is always created on
  // server). When total is 0 nothing has rolled yet.
  const last =
    s.lastRoll && s.lastRoll.total > 0
      ? {
          a: s.lastRoll.a,
          b: s.lastRoll.b,
          total: s.lastRoll.total,
          isHard: !!s.lastRoll.isHard,
          isCraps: !!s.lastRoll.isCraps,
          isNatural: !!s.lastRoll.isNatural,
          commitHash: s.lastRoll.commitHash ?? '',
          seed: s.lastRoll.seed ?? '',
          rollNumber: s.lastRoll.rollNumber ?? 0,
          ts: s.lastRoll.ts ?? 0,
        }
      : null;
  return {
    tableId: s.tableId ?? '',
    name: s.name ?? '',
    minBet: s.minBet ?? 5,
    maxBet: s.maxBet ?? 500,
    maxSeats: s.maxSeats ?? 8,
    phase: (s.phase ?? 'between') as CrapsTableView['phase'],
    phaseClockMs: s.phaseClockMs ?? 0,
    point: s.point ?? 0,
    shooterSeat: s.shooterSeat ?? -1,
    rollsThisShooter: s.rollsThisShooter ?? 0,
    lastRoll: last,
    commitHash: s.commitHash ?? '',
    revealedSeed: s.revealedSeed ?? '',
    hostId: s.hostId ?? '',
    seats,
    bets,
  };
}
