// Table chat. A small slide-out panel anchored to the bottom-right. Sends
// short messages over the Colyseus table room; the server stamps id + ts and
// broadcasts to everyone seated or spectating.

import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import { C2S, type ChatMessage } from '@shuffle/shared';

interface Props {
  room: Room | null;
  mySessionId: string | null;
}

export function ChatPanel({ room, mySessionId }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!room) return;
    const onChat = (m: ChatMessage) => {
      setMessages((prev) => {
        // Dedupe by id (chat history replay sends each message individually).
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m].slice(-200);
      });
      if (!open && m.from !== mySessionId) setUnread((n) => n + 1);
    };
    room.onMessage('chat', onChat);
    // colyseus.js doesn't expose `.off` per handler; the room is owned by
    // <Table/> and torn down on unmount, so all listeners go with it.
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

  return (
    <div className="fixed bottom-3 right-3 z-30 sm:bottom-6 sm:right-6">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 rounded-full border border-border-hi bg-surface px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-ink shadow-brand"
        >
          💬 Chat
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-sunset px-1.5 text-[10px] font-bold text-white">
              {Math.min(unread, 99)}
            </span>
          )}
        </button>
      )}
      {open && (
        <div className="flex w-[min(92vw,340px)] flex-col rounded-2xl border border-border-hi bg-surface shadow-brand">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
              Table chat
            </p>
            <button
              onClick={() => setOpen(false)}
              className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft"
            >
              Close
            </button>
          </header>
          <div
            ref={scroller}
            className="max-h-72 min-h-32 overflow-y-auto px-3 py-2 text-sm"
          >
            {messages.length === 0 && (
              <p className="text-xs text-ink-mute">No chatter yet — say hi.</p>
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
        </div>
      )}
    </div>
  );
}
