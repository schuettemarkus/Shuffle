// Tiny WebRTC mesh. Each connected client opens a peer connection to every
// other player at the table and shares its local stream. Signaling is relayed
// through the Colyseus table room.
//
// This is the Phase 1 stand-in for LiveKit. With ≤6 seats and ≤32 clients
// total, full mesh is fine on bandwidth and CPU. Phase 2 / 3 swap this for a
// LiveKit SFU (the room concept and per-peer track API mirror cleanly).
//
// Glare avoidance uses the "perfect negotiation" pattern from MDN: the peer
// with the lexicographically-smaller sessionId is "polite" and rolls back on
// SDP collisions; the other side is "impolite" and ignores.

import type { Room } from 'colyseus.js';
import { C2S, S2C, type WebRTCSignalKind } from '@shuffle/shared';

interface SignalIn {
  from: string;
  kind: WebRTCSignalKind;
  data: unknown;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream | null;
}

export interface MeshHandle {
  stop: () => void;
  onChange: (cb: () => void) => () => void;
  remoteStreams: () => Map<string, MediaStream>;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function startWebRTCMesh(opts: {
  room: Room;
  mySessionId: string;
  localStream: MediaStream | null;
}): MeshHandle {
  const { room, mySessionId } = opts;
  let localStream = opts.localStream;
  const peers = new Map<string, PeerEntry>();
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((cb) => cb());

  function ensurePeer(peerId: string): PeerEntry {
    const existing = peers.get(peerId);
    if (existing) return existing;
    const polite = mySessionId < peerId;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry: PeerEntry = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      stream: null,
    };
    peers.set(peerId, entry);

    // Add local tracks (if we have a stream).
    if (localStream) {
      for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      entry.stream = stream;
      notify();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      room.send(C2S.webrtcSignal, { to: peerId, kind: 'ice', data: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        room.send(C2S.webrtcSignal, {
          to: peerId,
          kind: 'offer',
          data: pc.localDescription,
        });
      } catch (err) {
        console.warn('[webrtc] negotiation failed', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        // Drop on hard failure; clients will re-announce ready and reconnect.
        if (pc.connectionState === 'failed') dropPeer(peerId);
      }
    };
    return entry;
  }

  function dropPeer(peerId: string) {
    const entry = peers.get(peerId);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch {
      // ignore
    }
    peers.delete(peerId);
    notify();
  }

  async function handleSignal(msg: SignalIn) {
    const entry = ensurePeer(msg.from);
    const { pc } = entry;
    try {
      if (msg.kind === 'offer') {
        const desc = msg.data as RTCSessionDescriptionInit;
        const collision =
          desc.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        if (collision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(desc),
          ]);
        } else {
          await pc.setRemoteDescription(desc);
        }
        await pc.setLocalDescription();
        room.send(C2S.webrtcSignal, {
          to: msg.from,
          kind: 'answer',
          data: pc.localDescription,
        });
      } else if (msg.kind === 'answer') {
        await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
      } else if (msg.kind === 'ice') {
        try {
          await pc.addIceCandidate(msg.data as RTCIceCandidateInit);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('[webrtc] signal handling error', err);
    }
  }

  // Wire room handlers.
  const offSignal = room.onMessage(S2C.webrtcSignal, (m: SignalIn) => handleSignal(m));
  const offReady = room.onMessage(S2C.webrtcPeerReady, ({ sessionId }: { sessionId: string }) => {
    if (sessionId === mySessionId) return;
    // Only the impolite peer initiates to avoid both sides making offers.
    const entry = ensurePeer(sessionId);
    if (!entry.polite && localStream) {
      // Trigger negotiation by re-adding tracks if not already added.
      if (entry.pc.getSenders().length === 0) {
        for (const t of localStream.getTracks()) entry.pc.addTrack(t, localStream);
      }
    }
  });
  const offGone = room.onMessage(S2C.webrtcPeerGone, ({ sessionId }: { sessionId: string }) => {
    dropPeer(sessionId);
  });

  // Announce ourselves so existing peers begin negotiation.
  // Small delay lets the client finish room.onStateChange wiring first.
  setTimeout(() => room.send(C2S.webrtcReady, {}), 100);

  return {
    stop() {
      offSignal?.();
      offReady?.();
      offGone?.();
      for (const id of Array.from(peers.keys())) dropPeer(id);
      listeners.clear();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    remoteStreams() {
      const out = new Map<string, MediaStream>();
      for (const [id, entry] of peers) {
        if (entry.stream) out.set(id, entry.stream);
      }
      return out;
    },
  };
}
