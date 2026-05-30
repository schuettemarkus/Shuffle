// LiveKit helpers — token minting + room name.
//
// The LiveKit server SDK signs JWTs that the client presents to LiveKit Cloud
// when joining a room. We give every player a join-grant for a single venue
// room ("shuffle-default" for Phase 2.5); rooms-per-venue land later.

import { AccessToken } from 'livekit-server-sdk';

export const VENUE_ROOM = 'shuffle-default';

export function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL ?? '';
  const apiKey = process.env.LIVEKIT_API_KEY ?? '';
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  return { url, apiKey, apiSecret, enabled: !!(url && apiKey && apiSecret) };
}

export async function mintToken(opts: {
  identityId: string;
  displayName: string;
  room?: string;
}): Promise<string> {
  const { apiKey, apiSecret } = getLiveKitConfig();
  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit is not configured on the server.');
  }
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identityId,
    name: opts.displayName.slice(0, 24),
    ttl: 60 * 60, // 1 hour, matches Phase 1 session
  });
  at.addGrant({
    room: opts.room ?? VENUE_ROOM,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  return at.toJwt();
}
