import { useEffect } from 'react';
import { useStore } from '../lib/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 4500));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  // Stack the toast feed on the right edge (out of the way of the table) and
  // slightly narrower so it reads as a notification log rather than a
  // headline. On mobile we keep the bottom-centered layout since there's no
  // sidebar space to spare.
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 flex flex-col items-center gap-1.5 sm:bottom-auto sm:left-auto sm:right-4 sm:top-20 sm:max-w-[280px] sm:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-full max-w-[420px] rounded-lg border border-border-hi bg-surface/90 px-3 py-1.5 text-xs shadow-brand backdrop-blur sm:max-w-none"
          style={{
            borderColor:
              t.kind === 'error'
                ? 'rgba(224,85,107,.4)'
                : t.kind === 'win'
                ? 'rgba(63,190,147,.4)'
                : 'rgba(255,228,210,.18)',
          }}
        >
          <p className="text-ink">{t.text}</p>
        </div>
      ))}
    </div>
  );
}
