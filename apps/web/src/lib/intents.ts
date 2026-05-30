// Wires gamepad intents -> Colyseus table actions, with the right context
// awareness. Both the on-screen control surface and the gamepad call into
// the same handler so behavior is identical regardless of input method.

import type { Room } from 'colyseus.js';
import type { TableAction, Emote } from '@shuffle/shared';
import { C2S } from '@shuffle/shared';

export function sendAction(room: Room | null, action: TableAction) {
  if (!room) return;
  room.send(C2S.action, action);
}

export function sendReaction(room: Room | null, emote: Emote) {
  if (!room) return;
  room.send(C2S.reaction, { emote });
}

export function sendChipToss(room: Room | null) {
  if (!room) return;
  room.send(C2S.chipToss, {});
}
