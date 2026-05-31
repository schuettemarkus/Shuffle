import { useState } from 'react';
import { useStore } from '../lib/store';
import { setDisplayName } from '../lib/identity';

export function Home() {
  const setView = useStore((s) => s.setView);
  const setIdentity = useStore((s) => s.setIdentity);
  const myIdentityId = useStore((s) => s.myIdentityId);
  const [name, setName] = useState('');
  // If the user arrived via an invite URL, show them what they're walking
  // into so the name-entry step doesn't feel like a tax. The param survives
  // through App-level auto-join after we set the name.
  const inviteTable =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('table')
      : null;

  const submit = () => {
    const clean = name.trim().slice(0, 24);
    if (!clean) return;
    setDisplayName(clean);
    setIdentity(myIdentityId, clean);
    setView('lobby');
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      {inviteTable && (
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.34em] text-sunset opacity-90 animate-rise">
          Someone saved you a chair
        </p>
      )}
      <h1 className="wordmark text-[clamp(72px,16vw,160px)] leading-[.9] animate-rise">
        shuffle<span className="wordmark-dot">.</span>
      </h1>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.34em] text-sunset opacity-90 animate-rise">
        Virtual casino
      </p>
      {inviteTable && (
        <p className="mt-4 max-w-md text-base text-ink-soft sm:text-lg animate-rise">
          You've been invited to a Blackjack table. Tell us your name and we'll walk you over.
        </p>
      )}

      <div className="mt-10 w-full rounded-brand border border-border bg-surface p-5 shadow-brand animate-rise">
        <label className="block text-left text-xs font-semibold uppercase tracking-[0.18em] text-ink-mute">
          What should we call you?
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Maya"
          className="mt-2 w-full rounded-xl border border-border bg-bg-2 px-4 py-3 text-lg text-ink outline-none ring-sunset/40 focus:ring-2"
          maxLength={24}
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="mt-4 w-full rounded-xl bg-gradient-to-br from-sunset-bright to-sunset px-4 py-3 text-base font-bold text-white shadow-sunset transition disabled:opacity-40"
        >
          {inviteTable ? 'Take my seat →' : 'Pull up a chair →'}
        </button>
      </div>
    </div>
  );
}
