// Universal walking input.
//
// Aggregates keyboard (WASD / arrows), a touch joystick, and the left analog
// stick on a connected gamepad into a single normalized vector that the Lobby
// screen forwards to the server at MOVE_SEND_HZ.

import { MOVE_SEND_HZ } from '@shuffle/shared';

export interface WalkInput {
  dx: number;
  dy: number;
}

type Listener = (v: WalkInput) => void;

const STEP_MS = Math.round(1000 / MOVE_SEND_HZ);

const KEY_VECTORS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function startWalking(send: Listener): () => void {
  const held = new Set<string>();
  let stick: WalkInput = { dx: 0, dy: 0 }; // virtual touch joystick
  let last: WalkInput = { dx: 0, dy: 0 };
  let timer: number | null = null;

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (!(e.code in KEY_VECTORS)) return;
    if (e.repeat) return;
    if (down) held.add(e.code);
    else held.delete(e.code);
    pump();
    e.preventDefault();
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // Drop held keys when the tab blurs so the avatar stops moving.
  const onBlur = () => {
    held.clear();
    stick = { dx: 0, dy: 0 };
    pump();
  };
  window.addEventListener('blur', onBlur);

  function aggregateGamepad(): WalkInput {
    const pad = navigator.getGamepads?.()[0];
    if (!pad) return { dx: 0, dy: 0 };
    const dx = applyDeadzone(pad.axes[0] ?? 0);
    const dy = applyDeadzone(pad.axes[1] ?? 0);
    return { dx, dy };
  }

  function applyDeadzone(v: number, dz = 0.18): number {
    return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
  }

  function combine(): WalkInput {
    let dx = 0;
    let dy = 0;
    for (const code of held) {
      const v = KEY_VECTORS[code]!;
      dx += v[0]!;
      dy += v[1]!;
    }
    const pad = aggregateGamepad();
    if (pad.dx || pad.dy) {
      dx += pad.dx;
      dy += pad.dy;
    }
    if (stick.dx || stick.dy) {
      dx += stick.dx;
      dy += stick.dy;
    }
    // Normalize to magnitude ≤ 1.
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    return { dx, dy };
  }

  function pump() {
    const v = combine();
    if (v.dx === last.dx && v.dy === last.dy && v.dx === 0 && v.dy === 0) return;
    last = v;
    send(v);
  }

  // Constant input pump so the server still gets the latest stick reading at
  // MOVE_SEND_HZ even when the value isn't changing — needed for the analog
  // stick which only emits via getGamepads polling.
  timer = window.setInterval(() => {
    const v = combine();
    if (v.dx === last.dx && v.dy === last.dy) {
      if (v.dx === 0 && v.dy === 0) return;
    }
    last = v;
    send(v);
  }, STEP_MS);

  // Public hook for the touch joystick to set its state.
  (window as unknown as { __shuffleStick?: (v: WalkInput) => void }).__shuffleStick = (v) => {
    stick = v;
    pump();
  };

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (timer != null) clearInterval(timer);
    delete (window as unknown as { __shuffleStick?: unknown }).__shuffleStick;
  };
}

export function setTouchStick(v: WalkInput) {
  const f = (window as unknown as { __shuffleStick?: (v: WalkInput) => void }).__shuffleStick;
  f?.(v);
}
