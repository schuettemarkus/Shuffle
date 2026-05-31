// LiveKit helpers — token minting + per-lobby room naming.
//
// Each Shuffle lobby gets its own LiveKit room so friend groups never bleed
// audio/video into each other. The lobbyId (also the invite token) is the
// shared secret — knowing it = invited to the lobby.

import { AccessToken } from 'livekit-server-sdk';

export function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL ?? '';
  const apiKey = process.env.LIVEKIT_API_KEY ?? '';
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  return { url, apiKey, apiSecret, enabled: !!(url && apiKey && apiSecret) };
}

export function roomNameFor(lobbyId: string): string {
  // Keep room names alphanumeric + short — LiveKit accepts more but this is
  // friendlier for dashboards / logs.
  const safe = lobbyId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `shuffle-${safe || 'default'}`;
}

export async function mintToken(opts: {
  identityId: string;
  displayName: string;
  lobbyId: string;
}): Promise<{ token: string; room: string }> {
  const { apiKey, apiSecret } = getLiveKitConfig();
  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit is not configured on the server.');
  }
  const room = roomNameFor(opts.lobbyId);
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identityId,
    name: opts.displayName.slice(0, 24),
    ttl: 60 * 60, // 1 hour, matches Phase 1 session
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  return { token: await at.toJwt(), room };
}
