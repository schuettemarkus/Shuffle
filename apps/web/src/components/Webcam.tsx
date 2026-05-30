// A small webcam tile. Requests the camera once; if the user declines, we just
// render an avatar tile — the spec demands the app works without a camera.
//
// Phase 3 will replace this with the MediaPipe segmentation pipeline and the
// LiveKit publish path; for Phase 1 we render the raw stream locally.

import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

interface Props {
  name: string;
  size?: 'sm' | 'md';
  mine?: boolean;
}

export function Webcam({ name, size = 'md', mine }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const camStream = useStore((s) => s.camStream);
  const camError = useStore((s) => s.camError);
  const setCam = useStore((s) => s.setCam);

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

  useEffect(() => {
    if (ref.current && camStream && mine) {
      ref.current.srcObject = camStream;
    }
  }, [camStream, mine]);

  const dim = size === 'sm' ? 'h-16 w-20 sm:h-20 sm:w-24' : 'h-24 w-32 sm:h-28 sm:w-36';

  return (
    <div
      className={
        'relative overflow-hidden rounded-xl border border-border-hi shadow-brand ' +
        dim +
        ' ' +
        (mine && camStream
          ? ''
          : 'bg-gradient-to-br from-[#FF9D52] via-[#FF5C7A] to-[#7A4FA3]')
      }
    >
      {mine && camStream ? (
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
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
