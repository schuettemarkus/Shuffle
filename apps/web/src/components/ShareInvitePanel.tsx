// Share & invite modal — scoped to the lobby. Friends paste the link and land
// in the same named lobby; we show them a personalized preview card so the
// host knows what their share will look like.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  lobbyName: string;
  lobbyId: string;
  seatsOpen: number;
  onClose: () => void;
}

export function ShareInvitePanel({ lobbyName, lobbyId, seatsOpen, onClose }: Props) {
  const url = useMemo(() => buildLobbyURL(lobbyId), [lobbyId]);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const input = document.getElementById('shuffle-invite-link') as HTMLInputElement | null;
      input?.select();
    }
  };

  // Native share — and where the platform supports it, attach the personalized
  // preview as a PNG so iMessage / WhatsApp / etc. show the lobby name baked
  // into the artwork instead of relying on the recipient's link unfurler.
  const shareNative = async () => {
    if (typeof navigator === 'undefined' || !('share' in navigator)) {
      copy();
      return;
    }
    const baseShare = {
      title: `Shuffle · ${lobbyName || 'Lobby'}`,
      text: lobbyName
        ? `Come hang out at ${lobbyName} on Shuffle.`
        : 'Come hang out on Shuffle.',
      url,
    };
    try {
      const file = await renderPreviewFile(previewRef.current, lobbyName);
      if (
        file &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ ...baseShare, files: [file] })
      ) {
        await navigator.share({ ...baseShare, files: [file] });
        return;
      }
      await navigator.share(baseShare);
    } catch {
      /* user cancelled — fall through */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border-hi bg-gradient-to-br from-surface to-bg-2 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]"
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-sunset/30 blur-3xl" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close invite"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/45 text-ink-soft backdrop-blur transition hover:border-white/30 hover:bg-black/60 hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sunset">
            Invite friends to
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-tight">
            {lobbyName || 'this lobby'}
          </h2>
          <p className="mt-2 text-sm text-ink-mute">
            One link, one tap — your friends land right here at{' '}
            <span className="text-ink">{lobbyName || 'this lobby'}</span>
            {seatsOpen > 0 && (
              <>
                . {seatsOpen} {seatsOpen === 1 ? 'seat is' : 'seats are'} still open.
              </>
            )}
          </p>

          {/* Beautiful preview card — exactly what their friends will see. */}
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_40px_-18px_rgba(0,0,0,.65)]">
            <InvitePreviewCard ref={previewRef} lobbyName={lobbyName || 'Lobby'} />
          </div>

          <div className="mt-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
              Share link
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="shuffle-invite-link"
                readOnly
                value={url}
                className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm text-ink outline-none"
              />
              <button
                onClick={copy}
                className="rounded-lg bg-gradient-to-br from-sunset-bright to-sunset px-3 py-2 text-sm font-bold text-white shadow-sunset"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={shareNative}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border-hi bg-elevated/60 px-3 py-1.5 text-xs font-semibold text-ink-soft"
            >
              <span>📤</span> Share via…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The card we render for the host to preview — and serialise to a PNG when
// the host taps "Share via…" so the recipient sees the lobby name baked into
// the artwork no matter where the link lands.
//
// This is intentionally an SVG (vector + accessible text) so it stays sharp at
// any size and so we can serialise it to PNG with one canvas hop. Shape mirrors
// the lobby hero artwork — gold ribbon, chip, light rays, sparkles — but with
// the lobby name in place of the game title.
const InvitePreviewCard = forwardRef<SVGSVGElement, { lobbyName: string }>(function InvitePreviewCard(
  { lobbyName },
  ref,
) {
  const longTitle = lobbyName.length >= 8;
  const size = longTitle ? 44 : 56;
  const letterSpacing = longTitle ? 1.5 : 3;
  return (
    <svg
      ref={ref}
      viewBox="0 0 1200 630"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      className="block h-full w-full"
      style={{ aspectRatio: '1200 / 630' }}
      role="img"
      aria-label={`Invite preview for ${lobbyName}`}
    >
      <defs>
        <radialGradient id="bg" cx="50%" cy="35%" r="120%">
          <stop offset="0%" stopColor="#352A45" />
          <stop offset="55%" stopColor="#1A1422" />
          <stop offset="100%" stopColor="#070310" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="22%" r="60%">
          <stop offset="0%" stopColor="rgba(255,106,61,.55)" />
          <stop offset="60%" stopColor="rgba(255,92,122,.2)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id="spot" cx="50%" cy="0%" r="60%">
          <stop offset="0%" stopColor="rgba(255,236,200,.35)" />
          <stop offset="80%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <linearGradient id="ribbon" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFF3C8" />
          <stop offset="18%" stopColor="#FFE08A" />
          <stop offset="48%" stopColor="#FFB14E" />
          <stop offset="78%" stopColor="#A36818" />
          <stop offset="100%" stopColor="#5A3A0E" />
        </linearGradient>
        <linearGradient id="ribbonFold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#A06B1F" />
          <stop offset="100%" stopColor="#3A2410" />
        </linearGradient>
        <linearGradient id="wordmark" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFB14E" />
          <stop offset="40%" stopColor="#FF6A3D" />
          <stop offset="80%" stopColor="#FF5C7A" />
        </linearGradient>
        <linearGradient id="ribbonText" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1A0F08" />
          <stop offset="50%" stopColor="#14101A" />
          <stop offset="100%" stopColor="#0A0610" />
        </linearGradient>
        <radialGradient id="chipFace" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor="#F7E9D9" />
          <stop offset="100%" stopColor="#D6B89E" />
        </radialGradient>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodOpacity=".55" />
        </filter>
        <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="8" floodOpacity=".65" />
        </filter>
      </defs>

      <rect width="1200" height="630" fill="url(#bg)" />
      <rect width="1200" height="630" fill="url(#glow)" />
      <rect width="1200" height="630" fill="url(#spot)" />

      {/* sweeping light rays */}
      <g opacity="0.18">
        {[-32, -18, 0, 18, 32].map((deg) => (
          <path
            key={deg}
            d="M 600 0 L 500 760 L 700 760 Z"
            fill="rgba(255,236,200,.55)"
            transform={`rotate(${deg} 600 0)`}
          />
        ))}
      </g>

      {/* shuffle wordmark at the top */}
      <text
        x="600"
        y="135"
        textAnchor="middle"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontWeight="800"
        fontSize="80"
        letterSpacing="-3"
        fill="url(#wordmark)"
      >
        shuffle<tspan fill="#FF6A3D">.</tspan>
      </text>
      <text
        x="600"
        y="175"
        textAnchor="middle"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontWeight="700"
        fontSize="20"
        letterSpacing="8"
        fill="#FFB14E"
      >
        VIRTUAL CASINO
      </text>

      {/* chip behind the cards */}
      <g transform="translate(600 330)" filter="url(#softShadow)">
        <circle r="148" fill="#E0556B" stroke="#7A2B12" strokeWidth="4" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="-20"
            y="-156"
            width="40"
            height="36"
            rx="4"
            fill="#FBF3EB"
            transform={`rotate(${deg})`}
          />
        ))}
        <circle r="118" fill="url(#chipFace)" />
        <circle r="98" fill="none" stroke="#E0556B" strokeWidth="4" strokeDasharray="4 8" />
        <circle r="74" fill="none" stroke="#7A2B12" strokeWidth="2" opacity="0.5" />
      </g>

      {/* fanned cards */}
      <g filter="url(#cardShadow)">
        <g transform="translate(490 256) rotate(-13)">
          <rect width="150" height="210" rx="18" fill="#FFFFFF" stroke="#2C2552" strokeWidth="3" />
          <text x="20" y="56" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="46" fill="#14101A">J</text>
          <text x="20" y="96" fontFamily="Bricolage Grotesque" fontSize="42" fill="#14101A">♣</text>
          <text x="75" y="142" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="80" textAnchor="middle" fill="#14101A">♣</text>
        </g>
        <g transform="translate(615 244) rotate(11)">
          <rect width="150" height="210" rx="18" fill="#FFFFFF" stroke="#2C2552" strokeWidth="3" />
          <text x="20" y="56" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="46" fill="#14101A">A</text>
          <text x="20" y="96" fontFamily="Bricolage Grotesque" fontSize="42" fill="#14101A">♠</text>
          <text x="75" y="142" fontFamily="Bricolage Grotesque" fontWeight="900" fontSize="80" textAnchor="middle" fill="#14101A">♠</text>
        </g>
      </g>

      {/* sparkles */}
      {[
        { x: 160, y: 120, r: 8 },
        { x: 1040, y: 150, r: 10 },
        { x: 100, y: 280, r: 6 },
        { x: 1100, y: 320, r: 7 },
        { x: 320, y: 80, r: 6 },
        { x: 880, y: 70, r: 8 },
      ].map(({ x, y, r }, i) => (
        <g key={i} transform={`translate(${x} ${y})`} opacity="0.85">
          <path
            d={`M 0 -${r * 3} L ${r * 0.7} -${r * 0.7} L ${r * 3} 0 L ${r * 0.7} ${r * 0.7} L 0 ${r * 3} L -${r * 0.7} ${r * 0.7} L -${r * 3} 0 L -${r * 0.7} -${r * 0.7} Z`}
            fill="rgba(255,236,200,.85)"
          />
        </g>
      ))}

      {/* gold ribbon banner with the lobby name */}
      <g filter="url(#softShadow)">
        <path d="M 60 510 L 165 470 L 195 540 L 90 580 Z" fill="url(#ribbonFold)" />
        <path d="M 1140 510 L 1035 470 L 1005 540 L 1110 580 Z" fill="url(#ribbonFold)" />
        <path
          d="M 100 480 Q 600 415 1100 480 L 1100 580 Q 600 515 100 580 Z"
          fill="url(#ribbon)"
          stroke="#3a2412"
          strokeWidth="3"
        />
        <path
          d="M 130 498 Q 600 440 1070 498"
          stroke="#FFF8DC"
          strokeWidth="2"
          fill="none"
          opacity="0.9"
        />
        <text
          x="600"
          y="552"
          textAnchor="middle"
          fontFamily="Bricolage Grotesque, sans-serif"
          fontWeight="900"
          fontSize={size * 2}
          letterSpacing={letterSpacing * 2}
          fill="url(#ribbonText)"
          stroke="#000000"
          strokeWidth="1"
        >
          {lobbyName.toUpperCase()}
        </text>
      </g>

      {/* tagline below */}
      <text
        x="600"
        y="610"
        textAnchor="middle"
        fontFamily="Hanken Grotesk, sans-serif"
        fontWeight="600"
        fontSize="16"
        letterSpacing="3"
        fill="rgba(255,228,210,.7)"
      >
        PULL UP A CHAIR
      </text>
    </svg>
  );
});

// Serialize the inline SVG preview to a PNG file so the native share sheet
// can attach it. Returns null when the browser can't paint the image (e.g.
// stricter CORS policies or older Safari).
async function renderPreviewFile(
  svg: SVGSVGElement | null,
  lobbyName: string,
): Promise<File | null> {
  if (!svg || typeof window === 'undefined') return null;
  try {
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml' });
    const svgURL = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const ready = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
    img.src = svgURL;
    await ready;
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(svgURL);
      return null;
    }
    ctx.drawImage(img, 0, 0, 1200, 630);
    URL.revokeObjectURL(svgURL);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return null;
    const safe = lobbyName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'lobby';
    return new File([blob], `shuffle-${safe}.png`, { type: 'image/png' });
  } catch {
    return null;
  }
}

function buildLobbyURL(lobbyId: string): string {
  if (typeof window === 'undefined') return '';
  const u = new URL(window.location.origin + window.location.pathname);
  if (lobbyId) u.searchParams.set('lobby', lobbyId);
  return u.toString();
}
