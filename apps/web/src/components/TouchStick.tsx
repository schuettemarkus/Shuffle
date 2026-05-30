// Virtual analog stick for touch devices — the primary walking input on
// phones per the spec's mobile section. Drag the inner knob; magnitude /
// direction is forwarded to walking.ts via setTouchStick.

import { useEffect, useRef, useState } from 'react';
import { setTouchStick } from '../lib/walking';

const RADIUS = 56;
const KNOB = 28;

export function TouchStick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => () => setTouchStick({ dx: 0, dy: 0 }), []);

  function pointerToVec(clientX: number, clientY: number) {
    const r = baseRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const mag = Math.hypot(dx, dy);
    const max = RADIUS - KNOB / 2;
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    return { x: dx, y: dy };
  }

  function emit(x: number, y: number) {
    const max = RADIUS - KNOB / 2;
    setTouchStick({ dx: x / max, dy: y / max });
  }

  return (
    <div
      ref={baseRef}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
        const v = pointerToVec(e.clientX, e.clientY);
        setPos(v);
        emit(v.x, v.y);
      }}
      onPointerMove={(e) => {
        if (!active) return;
        const v = pointerToVec(e.clientX, e.clientY);
        setPos(v);
        emit(v.x, v.y);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setActive(false);
        setPos({ x: 0, y: 0 });
        emit(0, 0);
      }}
      onPointerCancel={() => {
        setActive(false);
        setPos({ x: 0, y: 0 });
        emit(0, 0);
      }}
      className="tap-target relative grid h-32 w-32 place-items-center rounded-full border border-border-hi bg-black/30 backdrop-blur"
      style={{ touchAction: 'none' }}
    >
      <div
        className={
          'absolute rounded-full bg-gradient-to-br from-sunset-bright to-sunset shadow-sunset transition-[transform] duration-75 ' +
          (active ? 'scale-105' : 'scale-100')
        }
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
        }}
      />
      <span className="pointer-events-none absolute bottom-1 text-[9px] font-bold uppercase tracking-[0.18em] text-ink-mute">
        walk
      </span>
    </div>
  );
}
