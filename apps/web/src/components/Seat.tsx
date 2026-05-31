import { useEffect, useMemo, useRef } from 'react';
import { useStore, type SeatView } from '../lib/store';
import { PlayingCard, HandValueBadge } from './PlayingCard';

interface Props {
  seat: SeatView;
  isMine: boolean;
  isDealerButton?: boolean;
  onSit?: () => void;
  stream?: MediaStream | null;
  micEnabled?: boolean;
  camEnabled?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
  // True when the viewer already holds a seat at this table. We use it to
  // quiet empty seats so a seated player can't accidentally double-sit.
  viewerSeated?: boolean;
  // Fires when the viewer clicks the in-tile "Leave seat" pill.
  onLeave?: () => void;
}

// Each seat is a "tile" that reads like a webcam frame with the player's face
// as the hero, and the chips / vibe / hand stacked beneath. That's the look
// of friends sitting around the same table.
export function Seat({
  seat,
  isMine,
  isDealerButton,
  onSit,
  stream,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
  viewerSeated,
  onLeave,
}: Props) {
  const empty = seat.phase === 'empty';
  const flash = useStore((s) => s.seatFlashes.find((f) => f.seatIndex === seat.index));
  const dismissFlash = useStore((s) => s.dismissSeatFlash);
  const speakingLevel = useStore((s) =>
    seat.identityId ? s.speakingLevels.get(seat.identityId) ?? 0 : 0,
  );
  const isSpeaking = !empty && speakingLevel > 0.05;

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => dismissFlash(seat.index), 1700);
    return () => clearTimeout(t);
  }, [flash, dismissFlash, seat.index]);

  const flashClasses = flash
    ? flash.kind === 'blackjack'
      ? 'animate-flashWin ring-2 ring-amber/70'
      : flash.kind === 'win'
      ? 'animate-flashWin ring-2 ring-win/70'
      : flash.kind === 'lose'
      ? 'animate-flashLose ring-2 ring-fold/70'
      : 'animate-flashPush ring-2 ring-ink-mute/60'
    : '';

  const speakIntensity = Math.min(1, speakingLevel * 4);
  const speakingStyle: React.CSSProperties = isSpeaking
    ? {
        boxShadow: `0 0 0 ${2 + speakIntensity * 4}px rgba(63,190,147,${0.35 +
          speakIntensity * 0.35}), 0 0 ${20 + speakIntensity * 30}px rgba(63,190,147,${0.25 +
          speakIntensity * 0.35})`,
      }
    : {};

  const showVideo = !empty && !!stream && (!isMine || camEnabled !== false);

  return (
    <div
      data-chip-anchor={`seat-${seat.index}`}
      style={speakingStyle}
      className={
        // Compact tile — video keeps its full column width (so it stays the
        // same on-screen size) while a tight min-height locks empty + filled
        // tiles at matching heights so the felt doesn't jump when someone
        // buys in.
        'group relative flex min-h-[220px] flex-col gap-1.5 overflow-visible rounded-2xl border bg-gradient-to-b from-surface to-bg-2 p-2 transition sm:min-h-[240px] sm:p-2.5 ' +
        (seat.isTurn
          ? 'border-sunset/70 shadow-sunset animate-pulseSunset'
          : isSpeaking
          ? 'border-win/60 animate-speakingPulse'
          : isMine
          ? 'border-amber/40'
          : empty
          ? 'border-dashed border-border bg-black/20'
          : 'border-white/10') +
        ' ' +
        flashClasses
      }
    >
      {isDealerButton && !empty && <DealerButton />}
      {!empty && flash && <FlashRibbon kind={flash.kind} delta={flash.delta} />}
      {!empty && <SeatReactions playerId={seat.playerId} />}

      {empty ? (
        viewerSeated ? (
          // Viewer is already seated elsewhere — quiet placeholder, no CTA.
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl px-3 py-4 text-xs font-bold text-ink-mute">
            <span className="text-[11px] uppercase tracking-[0.18em] text-ink-mute/80">
              Seat {seat.index + 1}
            </span>
            <span className="text-sm text-ink-mute/70">Open</span>
          </div>
        ) : (
          <button
            onClick={onSit}
            className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl px-3 py-4 text-xs font-bold text-ink-soft transition hover:text-sunset"
          >
            <span className="text-[11px] uppercase tracking-[0.18em] text-ink-mute">
              Seat {seat.index + 1}
            </span>
            <span className="text-sm">Sit down →</span>
          </button>
        )
      ) : (
        <>
          {/* HERO video — fills most of the tile. Name + vibe overlay the
           *  bottom of the video so the player's face is uninterrupted. */}
          <SeatVideo
            name={seat.displayName}
            stream={stream ?? null}
            mine={isMine}
            showVideo={showVideo}
            connected={seat.connected}
            seat={seat}
            micEnabled={micEnabled}
            camEnabled={camEnabled}
            onToggleMic={onToggleMic}
            onToggleCam={onToggleCam}
          />

          {/* The "stat strip" — chip count + phase status + public stats all
           *  share one tight panel so the tile has no dead space between
           *  cards. The phase chip is folded into the chip line. */}
          <SeatStatStrip seat={seat} />

          <RoyalMatchBadge seat={seat} />

          {/* Hide the inline mini-hand for the local player — their cards
           *  render BIG on the felt below the dealer. Everyone else's tile
           *  still shows their hand so we can read the table at a glance. */}
          {!isMine && <SeatHands seat={seat} />}

          {isMine && onLeave && (
            <button
              onClick={onLeave}
              className="tap-target mt-1 self-stretch rounded-xl border border-fold/35 bg-fold/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF9DAC] transition hover:bg-fold/20"
            >
              Leave seat · cash out
            </button>
          )}
        </>
      )}
    </div>
  );
}

// The hero video element — fills the tile width and a generous height. We
// use object-fit: cover with a gentle face-zoom so portraits read tight even
// with loose webcam framing. Mic/cam toggles float in the top-right; just the
// player's name reads across the bottom gradient.
function SeatVideo({
  name,
  stream,
  mine,
  showVideo,
  connected,
  seat,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  name: string;
  stream: MediaStream | null;
  mine: boolean;
  showVideo: boolean;
  connected: boolean;
  seat: SeatView;
  micEnabled?: boolean;
  camEnabled?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div
      className={
        'relative aspect-square w-full overflow-hidden rounded-xl border shadow-[0_14px_30px_-12px_rgba(0,0,0,.75)] ' +
        (mine ? 'border-amber/55' : 'border-white/10') +
        ' ' +
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
          // Tight face-zoom — most webcams frame loose, so we bump scale and
          // anchor above midline so eyes/mouth fill the portrait window.
          style={{
            transform: `scale(1.55) translateY(-2%)${mine ? ' scaleX(-1)' : ''}`,
            transformOrigin: 'center 32%',
          }}
        />
      ) : (
        <div className="grid h-full place-items-center font-display text-6xl font-bold text-white/85 sm:text-7xl">
          {initials(name)}
        </div>
      )}

      {/* Glass gradient at the bottom carries just the player name. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-2 pt-6 sm:px-2.5">
        <p className="truncate font-display text-sm font-bold leading-tight text-white sm:text-base">
          {name || `Seat ${seat.index + 1}`}
        </p>
        {!connected && (
          <span className="rounded-full bg-fold/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fold">
            AFK
          </span>
        )}
      </div>

      {/* Mic / cam controls live OUTSIDE the face — pinned to the top-right
       *  corner of the tile, never overlapping the player. */}
      {mine && (onToggleMic || onToggleCam) && (
        <div className="pointer-events-auto absolute right-1.5 top-1.5 flex gap-1">
          {onToggleMic && (
            <button
              onClick={onToggleMic}
              title={micEnabled ? 'Mute mic' : 'Unmute mic'}
              className={
                'tap-target grid h-7 w-7 place-items-center rounded-full border text-[11px] backdrop-blur transition ' +
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
                'tap-target grid h-7 w-7 place-items-center rounded-full border text-[11px] backdrop-blur transition ' +
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
  );
}

// Combined chip + bet + status strip — one tight card under the video.
//
// Layout: [chip icon] [stack]   [phase / bet status]
//         [public stats line, larger, legible across the table]
//
// No dead space between cards: stats are vertically tucked into the same
// rounded panel as the chip count.
function SeatStatStrip({ seat }: { seat: SeatView }) {
  const heroTone =
    seat.netProfit > 0 ? 'text-win' : seat.netProfit < 0 ? 'text-fold' : 'text-ink';
  const chipColor = chipColorForStack(seat.stack);
  const wager = seat.bet + seat.splitBet;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <PokerChipIcon tone={chipColor} />
        <div className="flex flex-1 items-baseline gap-1">
          <span className={'font-display text-lg font-bold leading-none tabular-nums ' + heroTone}>
            {seat.stack}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
            chips
          </span>
        </div>
        {wager > 0 && (
          <span className="rounded-full bg-amber/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber">
            Bet {wager}
          </span>
        )}
      </div>
      {seat.handsPlayed > 0 && <PublicStats seat={seat} />}
    </div>
  );
}

// Public-facing per-session stats line. Larger numerals so it reads from
// across the table.
function PublicStats({ seat }: { seat: SeatView }) {
  const winRate = seat.handsPlayed > 0 ? Math.round((seat.handsWon / seat.handsPlayed) * 100) : 0;
  const netTone =
    seat.netProfit > 0 ? 'text-win' : seat.netProfit < 0 ? 'text-fold' : 'text-ink-mute';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/8 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
      <span className={'text-[12px] font-bold tabular-nums ' + netTone}>
        {seat.netProfit > 0 ? '+' : ''}
        {seat.netProfit}
      </span>
      <span className="text-ink-mute/70">·</span>
      <span className="tabular-nums">
        <span className="text-win">{seat.handsWon}</span>W{' '}
        <span className="text-fold">{seat.handsLost}</span>L
        {seat.handsPushed > 0 && (
          <>
            {' '}
            <span className="text-ink-soft">{seat.handsPushed}</span>P
          </>
        )}
      </span>
      <span className="text-ink-mute/70">·</span>
      <span className="tabular-nums" title="Win rate">
        {winRate}%
      </span>
      {seat.blackjacks > 0 && (
        <>
          <span className="text-ink-mute/70">·</span>
          <span className="tabular-nums" title="Blackjacks">
            <span className="text-amber">{seat.blackjacks}</span>★
          </span>
        </>
      )}
    </div>
  );
}

// Poker-chip icon. SVG so it scales crisply and matches the brand palette.
// Six wedge stripes around the rim, a recessed center disc, a faint dollar
// glyph in the middle — looks like a $25 casino chip, not a flat circle.
function PokerChipIcon({ tone }: { tone: ChipTone }) {
  const { rim, ring, center, accent } = chipPalette(tone);
  return (
    <svg viewBox="0 0 32 32" width={26} height={26} className="shrink-0 drop-shadow-[0_2px_4px_rgba(0,0,0,.45)]">
      <defs>
        <radialGradient id="chip-shade" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="rgba(255,255,255,.45)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Outer rim */}
      <circle cx="16" cy="16" r="15" fill={rim} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      {/* Wedge stripes — 6 light wedges around the rim */}
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <rect
          key={deg}
          x="14.5"
          y="1.5"
          width="3"
          height="6"
          rx="0.5"
          fill={accent}
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
      {/* Inner ring */}
      <circle cx="16" cy="16" r="10.5" fill={ring} stroke="rgba(255,255,255,.18)" strokeWidth="0.8" />
      {/* Centre disc */}
      <circle cx="16" cy="16" r="7.5" fill={center} />
      {/* Highlight */}
      <circle cx="16" cy="16" r="14.5" fill="url(#chip-shade)" />
      {/* '$' glyph */}
      <text
        x="16"
        y="20"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontWeight="900"
        fontSize="10"
        textAnchor="middle"
        fill="rgba(0,0,0,.55)"
      >
        $
      </text>
    </svg>
  );
}

type ChipTone = 'white' | 'red' | 'green' | 'black' | 'purple';

function chipColorForStack(stack: number): ChipTone {
  if (stack < 200) return 'white';
  if (stack < 500) return 'red';
  if (stack < 1500) return 'green';
  if (stack < 5000) return 'black';
  return 'purple';
}

function chipPalette(tone: ChipTone) {
  switch (tone) {
    case 'white':
      return { rim: '#F5EBE0', ring: '#FBF3EB', center: '#FFFFFF', accent: '#E0556B' };
    case 'red':
      return { rim: '#E0556B', ring: '#FF5C7A', center: '#FBF3EB', accent: '#FFFFFF' };
    case 'green':
      return { rim: '#0E5C57', ring: '#14706A', center: '#FBF3EB', accent: '#FFB14E' };
    case 'black':
      return { rim: '#14101A', ring: '#211A2B', center: '#FBF3EB', accent: '#FFB14E' };
    case 'purple':
      return { rim: '#4A2E78', ring: '#7A4FA3', center: '#FBF3EB', accent: '#FFB14E' };
  }
}

function SeatHands({ seat }: { seat: SeatView }) {
  if (seat.splitBet > 0) {
    return (
      <div className="flex w-full gap-2">
        <SeatHandColumn
          label="Hand 1"
          cards={seat.hand}
          value={seat.handValue}
          soft={seat.isSoft}
          phase={seat.phase}
          active={seat.isTurn && !seat.splitActive}
        />
        <SeatHandColumn
          label="Hand 2"
          cards={seat.splitHand}
          value={seat.splitHandValue}
          soft={seat.splitIsSoft}
          phase={seat.splitPhase}
          active={seat.isTurn && seat.splitActive}
        />
      </div>
    );
  }
  // Cards only — no duplicate "placing bet" / "waiting" placeholder. The
  // chip-row pill is the single source of truth for phase status.
  if (seat.hand.length === 0) return null;
  return (
    <>
      <div className="flex min-h-[72px] items-end justify-center gap-1 sm:min-h-[96px]">
        {seat.hand.map((c, i) => (
          <PlayingCard key={i} card={c} index={i} />
        ))}
      </div>
      <HandValueBadge value={seat.handValue} soft={seat.isSoft} />
    </>
  );
}

function SeatHandColumn({
  label,
  cards,
  value,
  soft,
  phase,
  active,
}: {
  label: string;
  cards: SeatView['hand'];
  value: number;
  soft: boolean;
  phase: SeatView['phase'];
  active: boolean;
}) {
  return (
    <div
      className={
        'flex flex-1 flex-col items-center gap-1 rounded-lg p-1 transition ' +
        (active ? 'bg-sunset/10 ring-1 ring-sunset/40' : '')
      }
    >
      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-mute">
        {label}
      </span>
      <div className="flex min-h-[64px] items-end justify-center gap-1">
        {cards.map((c, i) => (
          <PlayingCard key={i} card={c} index={i} />
        ))}
      </div>
      {cards.length > 0 && <HandValueBadge value={value} soft={soft} />}
      <SplitPhasePill phase={phase} />
    </div>
  );
}

// Tiny phase indicator used inside the split-hand columns where space is
// tight (kept here even though the main tile's phase pill is gone — split
// hands still need a per-hand signal so the user can tell hand 1 from hand 2).
function SplitPhasePill({ phase }: { phase: SeatView['phase'] }) {
  const label =
    phase === 'playing'
      ? 'Acting'
      : phase === 'standing'
      ? 'Stand'
      : phase === 'busted'
      ? 'Bust'
      : phase === 'blackjack'
      ? '21!'
      : '';
  if (!label) return null;
  const color =
    phase === 'busted'
      ? 'text-fold bg-fold/15'
      : phase === 'blackjack'
      ? 'text-win bg-win/15'
      : phase === 'playing'
      ? 'text-sunset bg-sunset/15'
      : 'text-ink-mute bg-ink-mute/10';
  return (
    <span className={'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ' + color}>
      {label}
    </span>
  );
}

function DealerButton() {
  return (
    <div
      title="Dealer button"
      className="dealer-button absolute -top-3 -left-3 z-10 grid h-8 w-8 place-items-center rounded-full border-2 border-white/80 bg-gradient-to-br from-amber to-sunset text-[12px] font-bold text-black shadow-[0_4px_14px_rgba(255,177,78,.6)]"
    >
      D
    </div>
  );
}

function FlashRibbon({
  kind,
  delta,
}: {
  kind: 'win' | 'lose' | 'push' | 'blackjack';
  delta: number;
}) {
  const label =
    kind === 'blackjack'
      ? `Blackjack +${delta}`
      : kind === 'win'
      ? `Won +${delta}`
      : kind === 'lose'
      ? `Lost ${delta}`
      : 'Push';
  const color =
    kind === 'win' || kind === 'blackjack'
      ? 'bg-win/85 text-black'
      : kind === 'lose'
      ? 'bg-fold/85 text-white'
      : 'bg-ink-mute/70 text-black';
  return (
    <div className="pointer-events-none absolute -top-3 left-1/2 z-10 -translate-x-1/2">
      <span
        className={
          'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-md animate-flashRibbon ' +
          color
        }
      >
        {label}
      </span>
    </div>
  );
}


function RoyalMatchBadge({ seat }: { seat: SeatView }) {
  const outcome = seat.royalMatchOutcome;
  if (outcome === 'none') return null;
  if (seat.royalMatchBet === 0 && seat.royalMatchPayout === 0) return null;
  const delta = seat.royalMatchPayout - seat.royalMatchBet;
  if (outcome === 'royal') {
    return (
      <span className="self-center inline-flex items-center gap-1 rounded-full border border-amber/60 bg-gradient-to-r from-amber/30 to-sunset/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber shadow-[0_0_18px_-4px_rgba(255,177,78,.7)]">
        <span>👑</span> Royal Match
        <span className="text-win">+{delta}</span>
      </span>
    );
  }
  if (outcome === 'easy') {
    return (
      <span className="self-center inline-flex items-center gap-1 rounded-full border border-amber/45 bg-amber/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber">
        <span>♥</span> Easy Match
        <span className="text-win">+{delta}</span>
      </span>
    );
  }
  return (
    <span className="self-center inline-flex items-center gap-1 rounded-full border border-fold/40 bg-fold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fold/90">
      <span>👑</span> Royal Match
      <span>{delta}</span>
    </span>
  );
}

// Reactions overlay anchored to a seat — emojis fly above the player who
// emitted them instead of floating in the middle of the screen.
function SeatReactions({ playerId }: { playerId: string }) {
  // Select the stable array reference and filter in a memo — otherwise the
  // selector returns a new `.filter()` array on every store tick and zustand's
  // useSyncExternalStore snapshot is never cached, triggering an infinite
  // re-render loop.
  const allReactions = useStore((s) => s.reactions);
  const reactions = useMemo(
    () => (playerId ? allReactions.filter((r) => r.from === playerId) : []),
    [allReactions, playerId],
  );
  if (reactions.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-12 z-20 flex items-end justify-center gap-1 text-3xl sm:-top-14 sm:text-4xl">
      {reactions.map((r) => (
        <span
          key={r.id}
          className="inline-block animate-reaction"
          style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.55))' }}
        >
          {emoteGlyph(r.emote)}
        </span>
      ))}
    </div>
  );
}

function emoteGlyph(emote: string): string {
  switch (emote) {
    case 'chip':
      return '🪙';
    case 'cheers':
      return '🥂';
    case 'facepalm':
      return '🤦';
    case 'clap':
      return '👏';
    case 'taunt':
      return '😏';
    default:
      return '✨';
  }
}

function initials(name: string): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase().slice(0, 2);
}
