import { useEffect } from 'react';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { Toasts } from './components/Toasts';
import { useStore } from './lib/store';
import { getDisplayName, getIdentityId } from './lib/identity';

export function App() {
  const view = useStore((s) => s.view);
  const setIdentity = useStore((s) => s.setIdentity);

  useEffect(() => {
    const id = getIdentityId();
    const name = getDisplayName();
    setIdentity(id, name);
    // If a name is already saved, auto-route to lobby.
    if (name) useStore.getState().setView('lobby');
  }, [setIdentity]);

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
