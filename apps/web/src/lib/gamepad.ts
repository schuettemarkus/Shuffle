// Gamepad API abstraction.
//
// Polls connected gamepads on each rAF, normalizes button transitions, and
// hands them to a context-sensitive handler. Buttons are mapped per the
// spec's "default controller mapping" section. The on-screen control surface
// (TableControls.tsx) mirrors the same intents 1:1.

export type GamepadIntent =
  // Floor / lobby
  | 'sit'
  | 'leave'
  | 'browseTables'
  | 'toggleMic'
  // Table
  | 'hitOrCall'
  | 'fold'
  | 'betMode'
  | 'cyclePresetUp'
  | 'cyclePresetDown'
  | 'fineTuneUp'
  | 'fineTuneDown'
  | 'confirmBet'
  | 'tossChip'
  | 'emoteCheers'
  | 'emoteFacepalm'
  | 'emoteClap'
  | 'emoteTaunt'
  | 'history'
  | 'menu';

const XBOX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  L3: 10,
  R3: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;

type Ctx = 'floor' | 'table';

const FLOOR_MAP: Record<number, GamepadIntent> = {
  [XBOX.A]: 'sit',
  [XBOX.B]: 'leave',
  [XBOX.Y]: 'browseTables',
  [XBOX.X]: 'toggleMic',
};

const TABLE_MAP: Record<number, GamepadIntent> = {
  [XBOX.A]: 'hitOrCall',
  [XBOX.B]: 'fold',
  [XBOX.X]: 'betMode',
  [XBOX.LB]: 'cyclePresetDown',
  [XBOX.RB]: 'cyclePresetUp',
  [XBOX.LT]: 'fineTuneDown',
  [XBOX.RT]: 'fineTuneUp',
  [XBOX.R3]: 'tossChip',
  [XBOX.Up]: 'emoteCheers',
  [XBOX.Down]: 'emoteFacepalm',
  [XBOX.Left]: 'emoteClap',
  [XBOX.Right]: 'emoteTaunt',
  [XBOX.View]: 'history',
  [XBOX.Menu]: 'menu',
};

export interface GamepadOptions {
  context: () => Ctx;
  onIntent: (intent: GamepadIntent) => void;
  onConnect?: (gp: Gamepad) => void;
  onDisconnect?: () => void;
}

export function startGamepadLoop(opts: GamepadOptions): () => void {
  let raf = 0;
  const prev: Record<number, boolean[]> = {};
  let connected = false;

  function readPads() {
    return Array.from(navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
  }

  function loop() {
    const pads = readPads();
    if (pads.length > 0 && !connected) {
      connected = true;
      opts.onConnect?.(pads[0]!);
    } else if (pads.length === 0 && connected) {
      connected = false;
      opts.onDisconnect?.();
    }
    for (const gp of pads) {
      const last = prev[gp.index] ?? [];
      const map = opts.context() === 'table' ? TABLE_MAP : FLOOR_MAP;
      for (let i = 0; i < gp.buttons.length; i++) {
        const pressed = !!gp.buttons[i]?.pressed;
        const wasPressed = !!last[i];
        if (pressed && !wasPressed) {
          const intent = map[i];
          if (intent) opts.onIntent(intent);
        }
        last[i] = pressed;
      }
      prev[gp.index] = last;
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

export function rumble(durationMs = 200, intensity = 0.5) {
  const gp = (navigator.getGamepads?.()[0] ?? null) as Gamepad | null;
  if (!gp) return;
  // Vendor-specific rumble API — guard it.
  const v = gp as unknown as {
    vibrationActuator?: {
      playEffect: (type: string, opts: Record<string, unknown>) => Promise<unknown>;
    };
  };
  v.vibrationActuator?.playEffect('dual-rumble', {
    duration: durationMs,
    strongMagnitude: intensity,
    weakMagnitude: intensity * 0.7,
  });
}
