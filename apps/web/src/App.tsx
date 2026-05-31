import { useEffect } from 'react';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { Craps } from './screens/Craps';
import { Holdem } from './screens/Holdem';
import { Toasts } from './components/Toasts';
import { SettingsButton } from './components/SettingsPanel';
import { useStore } from './lib/store';
import { getDisplayName, getIdentityId } from './lib/identity';
import { joinVenue } from './lib/livekit';

export function App() {
  const view = useStore((s) => s.view);
  const setIdentity = useStore((s) => s.setIdentity);
  const setVenue = useStore((s) => s.setVenue);
  const venue = useStore((s) => s.venue);
  const myIdentityId = useStore((s) => s.myIdentityId);
  const myDisplayName = useStore((s) => s.myDisplayName);
  const currentLobbyId = useStore((s) => s.currentLobbyId);
  const setLobbyId = useStore((s) => s.setLobbyId);
  const pushToast = useStore((s) => s.pushToast);

  // On first paint, settle identity and the lobby this browser belongs to.
  //
  // Lobby rules:
  //   • If the URL carries `?lobby=<slug>`, that's the lobby they're joining
  //     (likely from an invite link).
  //   • Otherwise we mint a fresh slug from the user's display name — so
  //     "Maya" lands in `?lobby=maya-xxxx`, and once Maya renames it to
  //     "Skoville" the share link reads as her lobby. A short random suffix
  //     prevents two Mayas from accidentally landing in the same room.
  //
  // The legacy `?table=` param is stripped — invites are scoped to the
  // lobby now, not a specific table.
  useEffect(() => {
    const id = getIdentityId();
    const name = getDisplayName();
    setIdentity(id, name);

    const url = new URL(window.location.href);
    let lobbyId = url.searchParams.get('lobby') ?? '';
    if (!lobbyId) {
      lobbyId = lobbySlugFor(name);
      url.searchParams.set('lobby', lobbyId);
    }
    if (url.searchParams.has('table')) {
      url.searchParams.delete('table');
    }
    window.history.replaceState({}, '', url.toString());
    setLobbyId(lobbyId);

    if (name) useStore.getState().setView('lobby');
  }, [setIdentity, setLobbyId]);

  // One persistent LiveKit venue connection — survives screen changes so
  // spatial audio is continuous as you walk floor → table → floor.
  useEffect(() => {
    if (!myIdentityId || !myDisplayName) return;
    if (venue) return;
    let cancelled = false;
    let opened: Awaited<ReturnType<typeof joinVenue>> | null = null;
    (async () => {
      try {
        opened = await joinVenue({ identityId: myIdentityId, displayName: myDisplayName });
        if (cancelled) {
          await opened.destroy();
          return;
        }
        setVenue(opened);
      } catch (err) {
        console.warn('[livekit] venue join failed', err);
        pushToast({ kind: 'error', text: 'Audio/video unavailable.' });
      }
    })();
    return () => {
      cancelled = true;
      if (opened) opened.destroy();
      setVenue(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myIdentityId, myDisplayName]);

  // Quiet the "unused currentLobbyId" lint while still keeping it in scope.
  void currentLobbyId;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="atmosphere" />
      <div className="grain" />
      <div className="relative z-10 min-h-screen">
        {view === 'home' && <Home />}
        {view === 'lobby' && <Lobby />}
        {view === 'table' && <Table />}
        {view === 'craps' && <Craps />}
        {view === 'holdem' && <Holdem />}
      </div>
      {/* Floating settings — always reachable except on Home where the name
       *  capture serves the same purpose. */}
      {view !== 'home' && <SettingsButton />}
      <Toasts />
    </div>
  );
}

// Build a lobby slug that reads like the host's name. We slugify the first
// word of their display name and append a 4-char base36 suffix to keep
// concurrent "Maya" lobbies from accidentally merging.
function lobbySlugFor(displayName: string): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  const slug = first
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
  const suffix = Math.random().toString(36).slice(2, 6);
  return slug ? `${slug}-${suffix}` : `lobby-${suffix}`;
}
