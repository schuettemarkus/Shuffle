// LiveKit venue connection.
//
// One persistent connection per browser tab. The room is "shuffle-default"
// for now (the whole venue). Audio publishes always (gracefully no-ops in
// insecure contexts where getUserMedia is denied); video publishes on demand
// when the user is seated at a table.
//
// We also own a small Web Audio mixer: each remote participant's audio gets
// a PannerNode whose position the Lobby screen updates from floor presence.

import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';

export type RemoteAudio = {
  participantId: string;
  panner: PannerNode;
  source: MediaStreamAudioSourceNode;
  audioEl: HTMLAudioElement;
};

export interface LiveKitVenue {
  room: Room;
  audioContext: AudioContext;
  destroy(): Promise<void>;
  setListenerPosition(x: number, y: number): void;
  setPeerPosition(participantId: string, x: number, y: number): void;
  publishCamera(stream: MediaStream): Promise<void>;
  unpublishCamera(): Promise<void>;
  onParticipantsChanged(cb: () => void): () => void;
  onTracksChanged(cb: () => void): () => void;
}

interface PeerPos { x: number; y: number }

const SERVER_URL = (() => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const explicit = env?.VITE_SERVER_URL;
  if (explicit) return explicit.replace(/^ws/, 'http');
  return `${location.protocol}//${location.hostname}:2567`;
})();

// Floor units → audio units. Floor is 100×60; map onto roughly ±15 audio units
// so distance falloff feels right with the default rolloff factor.
const AUDIO_SCALE = 0.3;

export async function joinVenue(opts: {
  identityId: string;
  displayName: string;
}): Promise<LiveKitVenue> {
  const res = await fetch(`${SERVER_URL}/livekit/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identityId: opts.identityId,
      displayName: opts.displayName,
    }),
  });
  if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
  const { token, url } = (await res.json()) as { token: string; url: string };

  // Web Audio context — must be created from a user gesture; the Home → Lobby
  // click satisfies that.
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AC();
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  setupListener(audioContext);

  const room = new Room({ adaptiveStream: true, dynacast: true });
  await room.connect(url, token);

  // Best-effort mic publish — silently fails on insecure contexts (iOS HTTP).
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.info('[livekit] mic disabled', err);
  }

  const remoteAudios = new Map<string, RemoteAudio>();
  const peerPositions = new Map<string, PeerPos>();
  let listenerPos: PeerPos = { x: 50, y: 30 };
  const participantListeners = new Set<() => void>();
  const trackListeners = new Set<() => void>();
  const notifyParticipants = () => participantListeners.forEach((cb) => cb());
  const notifyTracks = () => trackListeners.forEach((cb) => cb());

  function attachRemoteAudio(participant: RemoteParticipant, pub: RemoteTrackPublication) {
    if (pub.kind !== Track.Kind.Audio) return;
    const track = pub.audioTrack;
    if (!track) return;
    detachRemoteAudio(participant.identity);
    const ms = new MediaStream();
    if (track.mediaStreamTrack) ms.addTrack(track.mediaStreamTrack);
    // Safari needs an attached <audio> element to actually pull the track
    // from the SFU. We mute its direct output and route audio through the
    // AudioContext panner instead.
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.muted = true;
    audioEl.style.display = 'none';
    audioEl.srcObject = ms;
    document.body.appendChild(audioEl);

    const source = audioContext.createMediaStreamSource(ms);
    const panner = audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.2;
    panner.maxDistance = 30;
    panner.rolloffFactor = 1.4;
    panner.connect(audioContext.destination);
    source.connect(panner);

    const entry: RemoteAudio = {
      participantId: participant.identity,
      panner,
      source,
      audioEl,
    };
    remoteAudios.set(participant.identity, entry);
    const pos = peerPositions.get(participant.identity);
    if (pos) updatePannerPosition(entry, pos);
  }

  function detachRemoteAudio(identity: string) {
    const e = remoteAudios.get(identity);
    if (!e) return;
    try {
      e.source.disconnect();
      e.panner.disconnect();
      e.audioEl.srcObject = null;
      e.audioEl.remove();
    } catch {
      // ignore
    }
    remoteAudios.delete(identity);
  }

  function updatePannerPosition(entry: RemoteAudio, pos: PeerPos) {
    const x = (pos.x - listenerPos.x) * AUDIO_SCALE;
    const y = (pos.y - listenerPos.y) * AUDIO_SCALE;
    const panner = entry.panner;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = 0;
      panner.positionZ.value = y;
    } else {
      panner.setPosition(x, 0, y);
    }
  }

  function refreshAllPanners() {
    for (const [id, entry] of remoteAudios) {
      const pos = peerPositions.get(id);
      if (pos) updatePannerPosition(entry, pos);
    }
  }

  room
    .on(RoomEvent.ParticipantConnected, () => notifyParticipants())
    .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      detachRemoteAudio(p.identity);
      peerPositions.delete(p.identity);
      notifyParticipants();
      notifyTracks();
    })
    .on(RoomEvent.TrackSubscribed, (_track, pub, participant) => {
      attachRemoteAudio(participant, pub as RemoteTrackPublication);
      notifyTracks();
    })
    .on(RoomEvent.TrackUnsubscribed, (_track, pub, participant) => {
      if ((pub as RemoteTrackPublication).kind === Track.Kind.Audio) {
        detachRemoteAudio(participant.identity);
      }
      notifyTracks();
    });

  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      if (pub.isSubscribed) attachRemoteAudio(p, pub as RemoteTrackPublication);
    }
  }

  return {
    room,
    audioContext,
    async destroy() {
      for (const id of Array.from(remoteAudios.keys())) detachRemoteAudio(id);
      try { await room.disconnect(); } catch { /* ignore */ }
      try { await audioContext.close(); } catch { /* ignore */ }
    },
    setListenerPosition(x: number, y: number) {
      listenerPos = { x, y };
      refreshAllPanners();
    },
    setPeerPosition(participantId, x, y) {
      peerPositions.set(participantId, { x, y });
      const entry = remoteAudios.get(participantId);
      if (entry) updatePannerPosition(entry, { x, y });
    },
    async publishCamera(stream: MediaStream) {
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      await room.localParticipant.publishTrack(track, { name: 'camera' });
    },
    async unpublishCamera() {
      const publications = room.localParticipant.videoTrackPublications;
      for (const pub of publications.values()) {
        if (pub.track) await room.localParticipant.unpublishTrack(pub.track);
      }
    },
    onParticipantsChanged(cb) {
      participantListeners.add(cb);
      return () => participantListeners.delete(cb);
    },
    onTracksChanged(cb) {
      trackListeners.add(cb);
      return () => trackListeners.delete(cb);
    },
  };
}

function setupListener(ctx: AudioContext) {
  const listener = ctx.listener;
  if (listener.forwardX) {
    listener.forwardX.value = 0;
    listener.forwardY.value = 0;
    listener.forwardZ.value = -1;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
    listener.positionX.value = 0;
    listener.positionY.value = 0;
    listener.positionZ.value = 0;
  } else {
    listener.setOrientation(0, 0, -1, 0, 1, 0);
    listener.setPosition(0, 0, 0);
  }
}
