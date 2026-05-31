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
  //
  // Two distinct anchorings, picked off the matchMedia hook so we never ship
  // conflicting left/right rules to the same viewport. Building a single
  // className with both mobile *and* desktop position utilities causes the
  // mobile `left-3` to stick on desktop (Tailwind has no `sm:left-auto` in
  // the mobile block), which is what was overlaying the felt on the left.
  // On desktop we anchor the chat so its top + bottom match the table area —
  // header is ~56px tall (button + padding) and the table container reserves
  // 128px of bottom padding, so this lines the chat up with the felt instead
  // of running floor-to-ceiling.
  const chrome = isDesktop
    ? 'right-4 top-[72px] bottom-[140px] w-80 rounded-2xl bg-surface/35 shadow-[0_18px_50px_-20px_rgba(0,0,0,.6)] hover:bg-surface/55 focus-within:bg-surface/70 transition-colors'
    : 'right-3 left-3 bottom-3 max-h-[70vh] rounded-2xl shadow-brand bg-surface/95';
  return (
    <aside
      className={
        'fixed z-30 flex flex-col border border-white/10 backdrop-blur-md ' +
        chrome
      }
    >
      <header className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
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
        {messages.map((m) => {
          if (m.from === '__system__') {
            return (
              <div key={m.id} className="my-1.5 flex justify-center">
                <span className="rounded-full border border-amber/35 bg-amber/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber">
                  {m.text}
                </span>
              </div>
            );
          }
          return (
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
          );
        })}
      </div>

      <div className="flex gap-1.5 border-t border-white/5 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          maxLength={280}
          placeholder="Say something nice"
          className="flex-1 rounded-lg border border-white/10 bg-bg-2/60 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-mute focus:bg-bg-2"
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
