// Share & invite modal — scoped to the lobby. Drops a friendly URL in your
// friends' hands; they paste it, land in the same named lobby, and pick a
// game from there.

import { useEffect, useMemo, useState } from 'react';

interface Props {
  lobbyName: string;
  lobbyId: string;
  seatsOpen: number;
  onClose: () => void;
}

export function ShareInvitePanel({ lobbyName, lobbyId, seatsOpen, onClose }: Props) {
  const url = useMemo(() => buildLobbyURL(lobbyId), [lobbyId]);
  const qr = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&color=14101A&bgcolor=FBF3EB&data=${encodeURIComponent(url)}`,
    [url],
  );
  const [copied, setCopied] = useState(false);

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

  const shareNative = async () => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: `Shuffle · ${lobbyName}`,
          text: `Come hang out at ${lobbyName} — pick Blackjack or Craps.`,
          url,
        });
        return;
      } catch {
        /* user cancelled — fall through */
      }
    }
    copy();
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
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-border-hi bg-black/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute backdrop-blur"
        >
          Close
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
            <span className="text-ink">{lobbyName}</span>
            {seatsOpen > 0 && (
              <>
                . {seatsOpen} {seatsOpen === 1 ? 'seat is' : 'seats are'} still open.
              </>
            )}
          </p>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <img
              src={qr}
              alt={`QR code linking to ${lobbyName}`}
              className="h-32 w-32 rounded-2xl border border-border-hi bg-ink p-1 shadow-brand"
            />
            <div className="flex-1">
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

          <p className="mt-4 rounded-xl border border-border bg-bg-2/50 px-3 py-2 text-[11px] text-ink-mute">
            Play-money & social only — Shuffle never deals in real money.
          </p>
        </div>
      </div>
    </div>
  );
}

function buildLobbyURL(lobbyId: string): string {
  if (typeof window === 'undefined') return '';
  const u = new URL(window.location.origin + window.location.pathname);
  if (lobbyId) u.searchParams.set('lobby', lobbyId);
  return u.toString();
}
