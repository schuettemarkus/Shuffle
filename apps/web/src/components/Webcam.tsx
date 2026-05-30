// A small webcam tile. For `mine`, requests the local camera and renders it;
// for remote peers, accepts a MediaStream from the WebRTC mesh.
//
// Phase 3 will replace this with the MediaPipe segmentation pipeline and the
// LiveKit publish path; for Phase 1 we render the raw stream.

import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

interface Props {
  name: string;
  size?: 'sm' | 'md';
  mine?: boolean;
  stream?: MediaStream | null;
}

export function Webcam({ name, size = 'md', mine, stream }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const camStream = useStore((s) => s.camStream);
  const camError = useStore((s) => s.camError);
  const setCam = useStore((s) => s.setCam);

  // Pull the local camera when this is the local tile.
  useEffect(() => {
    if (!mine) return;
    if (camStream || camError) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360 },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setCam(s);
      } catch (err) {
        setCam(null, err instanceof Error ? err.message : 'camera blocked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mine, camStream, camError, setCam]);

  // Attach whichever stream applies to this tile.
  const active = mine ? camStream : stream ?? null;
  useEffect(() => {
    if (ref.current && active) ref.current.srcObject = active;
  }, [active]);

  const dim = size === 'sm' ? 'h-16 w-20 sm:h-20 sm:w-24' : 'h-24 w-32 sm:h-28 sm:w-36';

  return (
    <div
      className={
        'relative overflow-hidden rounded-xl border border-border-hi shadow-brand ' +
        dim +
        ' ' +
        (active
          ? ''
          : 'bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3]')
      }
    >
      {active ? (
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={mine ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="absolute left-1/2 bottom-0 h-3/4 w-1/2 -translate-x-1/2 rounded-t-full bg-black/40" />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/50 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-sunset shadow-[0_0_8px_#FF6A3D]" />
        <span className="truncate">{name || 'Guest'}</span>
      </div>
    </div>
  );
}
