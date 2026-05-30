// Client-side Zustand store. Mirrors the server schema into plain JS so React
// renders cheaply, and holds connection + UI state (selected seat, toasts).

import { create } from 'zustand';
import type { Room } from 'colyseus.js';
import type {
  Card,
  HandResult,
  SeatPhase,
  TablePhase,
} from '@shuffle/shared';

export interface FloorPlayer {
  sessionId: string;
  identityId: string;
  displayName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  host: boolean;
  connected: boolean;
  walkingTo: string;
  hasTarget: boolean;
}

export interface FloorTable {
  tableId: string;
  name: string;
  game: string;
  x: number;
  y: number;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatsTaken: number;
  inHand: boolean;
  heat: number;
  heatState: string;
  stakesLocked: boolean;
  paused: boolean;
}

export interface SeatView {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  bet: number;
  hand: Card[];
  handValue: number;
  isSoft: boolean;
  phase: SeatPhase;
  isTurn: boolean;
  turnClockMs: number;
  connected: boolean;
  graceMs: number;
}

export interface TableView {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: TablePhase;
  phaseClockMs: number;
  seats: SeatView[];
  dealer: { hand: Card[]; handValue: number; isSoft: boolean };
  commitHash: string;
  revealedSeed: string;
  hostId: string;
  round: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'win' | 'lose' | 'error';
  text: string;
}

interface State {
  // Routing
  view: 'home' | 'lobby' | 'table';
  // Connection
  lobbyRoom: Room | null;
  tableRoom: Room | null;
  table: TableView | null;
  mySessionId: string | null;
  myIdentityId: string;
  myDisplayName: string;
  // UI
  selectedSeatIndex: number | null;
  betDraft: number;
  toasts: Toast[];
  lastResult: HandResult | null;
  reactions: Array<{ id: number; from: string; emote: string }>;
  // Cam
  camStream: MediaStream | null;
  camError: string | null;
  // Peer video — sessionId -> remote MediaStream from WebRTC mesh
  peerStreams: Map<string, MediaStream>;

  setView: (v: State['view']) => void;
  setLobbyRoom: (r: Room | null) => void;
  setTableRoom: (r: Room | null, sessionId: string | null) => void;
  setTable: (t: TableView | null) => void;
  setIdentity: (id: string, name: string) => void;
  setSelectedSeat: (i: number | null) => void;
  setBetDraft: (n: number) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setLastResult: (r: HandResult | null) => void;
  pushReaction: (r: { from: string; emote: string }) => void;
  dismissReaction: (id: number) => void;
  setCam: (s: MediaStream | null, err?: string | null) => void;
  setPeerStreams: (m: Map<string, MediaStream>) => void;
}

export const useStore = create<State>((set) => ({
  view: 'home',
  lobbyRoom: null,
  tableRoom: null,
  table: null,
  mySessionId: null,
  myIdentityId: '',
  myDisplayName: '',
  selectedSeatIndex: null,
  betDraft: 50,
  toasts: [],
  lastResult: null,
  reactions: [],
  camStream: null,
  camError: null,
  peerStreams: new Map(),

  setView: (v) => set({ view: v }),
  setLobbyRoom: (r) => set({ lobbyRoom: r }),
  setTableRoom: (r, sessionId) => set({ tableRoom: r, mySessionId: sessionId }),
  setTable: (t) => set({ table: t }),
  setIdentity: (id, name) => set({ myIdentityId: id, myDisplayName: name }),
  setSelectedSeat: (i) => set({ selectedSeatIndex: i }),
  setBetDraft: (n) => set({ betDraft: n }),
  pushToast: (t) =>
    set((s) => ({ toasts: [...s.toasts, { ...t, id: Date.now() + Math.random() }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setLastResult: (r) => set({ lastResult: r }),
  pushReaction: (r) =>
    set((s) => ({
      reactions: [...s.reactions.slice(-9), { id: Date.now() + Math.random(), ...r }],
    })),
  dismissReaction: (id) =>
    set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })),
  setCam: (s, err = null) => set({ camStream: s, camError: err }),
  setPeerStreams: (m) => set({ peerStreams: new Map(m) }),
}));

// Derived selector — find my seat (if any).
export function selectMySeat(table: TableView | null, sessionId: string | null): SeatView | null {
  if (!table || !sessionId) return null;
  return table.seats.find((s) => s.playerId === sessionId) ?? null;
}
