// Floating settings — name editor + a few session-level toggles.
//
// Shuffle is session-based, not account-based: the user's identity lives in
// localStorage as a UUID + a display name, with no login. This panel lets
// them tweak the few things that matter (their display name, motion comfort,
// whether to start fresh) without ever introducing a profile.

import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { setDisplayName } from '../lib/identity';

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Open settings"
        className="fixed right-3 bottom-3 z-40 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/25 text-ink-mute/70 backdrop-blur-sm transition hover:border-white/25 hover:bg-black/40 hover:text-ink-soft sm:right-5 sm:bottom-5"
      >
        <GearIcon />
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const myDisplayName = useStore((s) => s.myDisplayName);
  const myIdentityId = useStore((s) => s.myIdentityId);
  const setIdentity = useStore((s) => s.setIdentity);
  const [name, setName] = useState(myDisplayName);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(MOTION_KEY) === '1';
  });

  // Apply / unapply the reduced-motion class on <html> whenever the toggle
  // changes. We listen rather than only writing once so the toggle takes
  // effect mid-session.
  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add('shuffle-reduce-motion');
      window.localStorage.setItem(MOTION_KEY, '1');
    } else {
      root.classList.remove('shuffle-reduce-motion');
      window.localStorage.removeItem(MOTION_KEY);
    }
  }, [reducedMotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveName = () => {
    const clean = name.trim().slice(0, 24);
    if (!clean) return;
    setDisplayName(clean);
    setIdentity(myIdentityId, clean);
  };

  const resetSession = () => {
    if (!confirm('Reset your session? You\'ll get a fresh identity, name, and lobby. Live seats and chips stay where they are.')) {
      return;
    }
    try {
      window.localStorage.clear();
    } catch {
      // ignore quota / private mode
    }
    // Drop the URL params so the next visit mints a fresh lobby.
    const u = new URL(window.location.href);
    u.search = '';
    window.location.href = u.toString();
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
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-sunset/25 blur-3xl" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/45 text-ink-soft backdrop-blur transition hover:border-white/30 hover:bg-black/60 hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sunset">
            Settings
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-tight">
            Your seat at the felt
          </h2>
          <p className="mt-2 text-sm text-ink-mute">
            Session-only — no profile, no login. Changes live for as long as
            this browser remembers you.
          </p>

          {/* Display name */}
          <div className="mt-5 rounded-2xl border border-border bg-bg-2/50 p-4">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
              Display name
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                }}
                maxLength={24}
                placeholder="Maya"
                className="flex-1 rounded-lg border border-border bg-bg-2 px-3 py-2 text-base text-ink outline-none ring-sunset/40 focus:ring-2"
              />
              <button
                onClick={saveName}
                className="rounded-lg bg-gradient-to-br from-sunset-bright to-sunset px-3 py-2 text-sm font-bold text-white shadow-sunset disabled:opacity-50"
                disabled={!name.trim() || name.trim() === myDisplayName}
              >
                Save
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-mute">
              Active seats keep your old name until the next hand starts.
            </p>
          </div>

          {/* Motion toggle */}
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-2/50 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
                Reduce motion
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Quiets the deal, dice, and chip-flight animations.
              </p>
            </div>
            <ToggleSwitch on={reducedMotion} onChange={setReducedMotion} />
          </div>

          {/* Theme — still dark-only; the toggle is wired for the future. */}
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-bg-2/50 p-4 opacity-70">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
                Theme
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                Sunset Lounge (dark) — light mode is on the roadmap.
              </p>
            </div>
            <span className="rounded-full border border-amber/40 bg-amber/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber">
              Dark
            </span>
          </div>

          {/* Danger zone — reset */}
          <div className="mt-3 rounded-2xl border border-fold/30 bg-fold/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fold/85">
              Reset session
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Forget this device's identity, display name, and current lobby.
              Useful for a quick "hand the phone to a friend" handoff.
            </p>
            <button
              onClick={resetSession}
              className="mt-2 rounded-lg border border-fold/45 bg-fold/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#FF9DAC] transition hover:bg-fold/25"
            >
              Reset & start fresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={
        'relative h-7 w-12 rounded-full transition ' +
        (on ? 'bg-sunset' : 'bg-bg-2 border border-border-hi')
      }
    >
      <span
        className={
          'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ' +
          (on ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}

const MOTION_KEY = 'shuffle:reduce-motion';
