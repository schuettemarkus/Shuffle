// Pure presentational video tile. The Table screen owns the local-camera
// lifecycle and LiveKit publish — this component just renders a stream (own
// or remote) and, for the local tile, exposes mic/cam toggle controls.

import { useEffect, useRef } from 'react';

interface Props {
  name: string;
  stream?: MediaStream | null;
  mine?: boolean;
  isHost?: boolean;
  // Local-tile-only controls.
  micEnabled?: boolean;
  camEnabled?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
}

export function Webcam({
  name,
  stream,
  mine,
  isHost,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
    if (ref.current && !stream) ref.current.srcObject = null;
  }, [stream]);

  const showVideo = !!stream && (!mine || camEnabled !== false);

  return (
    <div
      className={
        'group relative h-28 w-36 shrink-0 overflow-hidden rounded-xl border shadow-brand sm:h-36 sm:w-52 ' +
        (mine ? 'border-sunset/60' : 'border-border-hi') +
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
          style={mine ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="grid h-full place-items-center text-3xl font-display font-bold text-white/80">
          {initials(name)}
        </div>
      )}

      {/* Nameplate */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
        {micEnabled === false ? (
          <span title="muted" className="text-fold">🚫🎤</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-sunset shadow-[0_0_8px_#FF6A3D]" />
        )}
        <span className="truncate">{name || 'Guest'}</span>
        {isHost && (
          <span className="ml-auto rounded bg-amber/80 px-1 text-[9px] font-bold uppercase tracking-wider text-black">
            host
          </span>
        )}
      </div>

      {/* Local-tile toggles. Larger, fingertip-friendly. */}
      {mine && (
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5">
          {onToggleMic && (
            <ToggleButton
              on={!!micEnabled}
              onClick={onToggleMic}
              labelOn="Mute mic"
              labelOff="Unmute mic"
              iconOn="🎤"
              iconOff="🔇"
            />
          )}
          {onToggleCam && (
            <ToggleButton
              on={!!camEnabled}
              onClick={onToggleCam}
              labelOn="Stop video"
              labelOff="Start video"
              iconOn="📹"
              iconOff="🎥"
              dim
            />
          )}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  on,
  onClick,
  labelOn,
  labelOff,
  iconOn,
  iconOff,
  dim,
}: {
  on: boolean;
  onClick: () => void;
  labelOn: string;
  labelOff: string;
  iconOn: string;
  iconOff: string;
  dim?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={on ? labelOn : labelOff}
      className={
        'tap-target grid h-8 w-8 place-items-center rounded-full border text-sm backdrop-blur transition ' +
        (on
          ? 'border-white/20 bg-black/55 text-white hover:bg-black/70'
          : 'border-fold/40 bg-fold/30 text-white animate-pulseSunset')
      }
    >
      {on ? iconOn : iconOff}
      {dim && on && (
        <span className="sr-only">cam on</span>
      )}
    </button>
  );
}

function initials(name: string): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (a + b).toUpperCase().slice(0, 2);
}
