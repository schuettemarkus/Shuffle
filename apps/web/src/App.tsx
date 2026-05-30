import { useEffect } from 'react';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { Toasts } from './components/Toasts';
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
  const pushToast = useStore((s) => s.pushToast);

  useEffect(() => {
    const id = getIdentityId();
    const name = getDisplayName();
    setIdentity(id, name);
    // If a name is already saved, auto-route to lobby.
    if (name) useStore.getState().setView('lobby');
  }, [setIdentity]);

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

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="atmosphere" />
      <div className="grain" />
      <div className="relative z-10 min-h-screen">
        {view === 'home' && <Home />}
        {view === 'lobby' && <Lobby />}
        {view === 'table' && <Table />}
      </div>
      <Toasts />
    </div>
  );
}
