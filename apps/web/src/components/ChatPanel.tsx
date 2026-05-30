// Table chat — persistent live feed.
//
// Desktop (sm+): docked open on the right side, always visible, scrollable.
// Mobile: collapsed by default into a button at the bottom-right; tapping it
// pops the same panel as an overlay so the felt stays unobstructed.

import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S, type ChatMessage } from '@shuffle/shared';

interface Props {
  room: Room | null;
  mySessionId: string | null;
}

const DESKTOP_QUERY = '(min-width: 640px)';

export function ChatPanel({ room, mySessionId }: Props) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  // Mobile starts collapsed; desktop is always-open.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const open = isDesktop || mobileOpen;

  useEffect(() => {
    if (!room) return;
    const onChat = (m: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m].slice(-200);
      });
      if (!open && m.from !== mySessionId) setUnread((n) => n + 1);
    };
    room.onMessage('chat', onChat);
  }, [room, open, mySessionId]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    if (open && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [messages, open]);

  const send = () => {
    const text = draft.trim();
    if (!text || !room) return;
    room.send(C2S.chat, { text });
    setDraft('');
  };

  // ----------- mobile button -----------
  if (!isDesktop && !mobileOpen) {
    return (
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-3 right-3 z-30 flex items-center gap-2 rounded-full border border-border-hi bg-surface px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-ink shadow-brand"
      >
        💬 Chat
        {unread > 0 && (
          <span className="min-w-[18px] rounded-full bg-sunset px-1.5 text-[10px] font-bold text-white">
            {Math.min(unread, 99)}
          </span>
        )}
      </button>
    );
  }

  // ----------- panel (mobile overlay or desktop dock) -----------
  const desktopChrome =
    'sm:right-4 sm:top-20 sm:bottom-4 sm:w-80 sm:rounded-2xl sm:shadow-brand';
  const mobileChrome =
    'right-3 left-3 bottom-3 max-h-[70vh] rounded-2xl shadow-brand';
  return (
    <aside
      className={
        'fixed z-30 flex flex-col border border-border-hi bg-surface/95 backdrop-blur ' +
        mobileChrome +
        ' ' +
        desktopChrome
      }
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Table chat
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-sunset" />
        </div>
        {!isDesktop && (
          <button
            onClick={() => setMobileOpen(false)}
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft"
          >
            Close
          </button>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
        {messages.length === 0 && (
          <p className="py-2 text-xs text-ink-mute">No chatter yet — say hi.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="mb-1.5">
            <span
              className={
                'mr-1.5 text-[11px] font-bold ' +
                (m.from === mySessionId ? 'text-sunset' : 'text-ink')
              }
            >
              {m.name}
            </span>
            <span className="text-ink-soft">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 border-t border-border p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          maxLength={280}
          placeholder="Say something nice"
          className="flex-1 rounded-lg border border-border bg-bg-2 px-2.5 py-1.5 text-sm text-ink outline-none"
        />
        <button
          onClick={send}
          className="rounded-lg bg-gradient-to-br from-sunset-bright to-sunset px-3 text-sm font-bold text-white"
        >
          Send
        </button>
      </div>
    </aside>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
