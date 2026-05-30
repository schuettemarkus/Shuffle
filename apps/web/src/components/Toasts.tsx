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
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-md flex-col items-center gap-2 px-4 sm:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-full rounded-xl border border-border-hi bg-surface px-4 py-2.5 text-sm shadow-brand"
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
