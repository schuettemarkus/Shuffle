// Client-side Zustand store. Mirrors the server schema into plain JS so React
// renders cheaply, and holds connection + UI state (selected seat, toasts).

import { create } from 'zustand';
import type { Room } from 'colyseus.js';
import type {
  Card,
  HandResult,
  RoyalMatchOutcome,
  SeatPhase,
  SeatVibe,
  TablePhase,
} from '@shuffle/shared';
import type { LiveKitVenue } from './livekit';

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
  // Split hand (empty when not split).
  splitHand: Card[];
  splitHandValue: number;
  splitIsSoft: boolean;
  splitBet: number;
  splitPhase: SeatPhase;
  splitActive: boolean;
  // Royal Match side bet — resolved immediately after the deal.
  royalMatchBet: number;
  royalMatchOutcome: RoyalMatchOutcome;
  royalMatchPayout: number;
  vibe: SeatVibe;
  // Public stats — anyone seated at the table can read them.
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
  blackjacks: number;
  netProfit: number;
  biggestWin: number;
  biggestLoss: number;
  buyIn: number;
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
  dealerButtonSeat: number;
  // Single-deck Blackjack with public Hi-Lo counting.
  deckCount: number;
  cardsDealt: number;
  runningCount: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'win' | 'lose' | 'error';
  text: string;
}

// A short-lived "result happened on this seat" marker. Drives the per-seat
// win/loss flash that lives on the felt for ~1.6s after settle so eyes don't
// have to chase the toast.
export interface SeatFlash {
  seatIndex: number;
  kind: 'win' | 'lose' | 'push' | 'blackjack';
  delta: number;
  spawnedAt: number;
}

// A single chip in flight from `fromKey` -> `toKey`. Both keys are DOM
// `data-chip-anchor` ids set on the seat tile and the pot tile. The renderer
// reads each anchor's bounding rect at frame time so animations stay correct
// across resizes.
export interface ChipFlight {
  id: number;
  fromKey: string;
  toKey: string;
  amount: number;
  variant: 'bet' | 'payout';
  spawnedAt: number;
}

// Craps table view — mirrored from the server's Colyseus state.
export interface CrapsBetView {
  id: string;
  seatIndex: number;
  kind: string;
  amount: number;
  point: number;
}

export interface CrapsSeatView {
  index: number;
  playerId: string;
  identityId: string;
  displayName: string;
  stack: number;
  buyIn: number;
  connected: boolean;
  graceMs: number;
  isShooter: boolean;
  handsRolled: number;
  netProfit: number;
  longestRoll: number;
}

export interface CrapsTableView {
  tableId: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  phase: 'between' | 'comeOut' | 'point' | 'paused';
  phaseClockMs: number;
  point: number;
  shooterSeat: number;
  rollsThisShooter: number;
  lastRoll: {
    a: number;
    b: number;
    total: number;
    isHard: boolean;
    isCraps: boolean;
    isNatural: boolean;
    commitHash: string;
    seed: string;
    rollNumber: number;
    ts: number;
  } | null;
  commitHash: string;
  revealedSeed: string;
  hostId: string;
  seats: CrapsSeatView[];
  bets: CrapsBetView[];
}

interface State {
  // The lobby this browser is currently bound to. Set on first visit (or
  // when arriving via an invite link with ?lobby=…) and persisted in the
  // URL so refreshes land back in the same friend group.
  currentLobbyId: string;
  // Live display name of the current lobby (host can rename it). Mirrors
  // the server's LobbyState.name field.
  lobbyName: string;
  // SessionId of the current lobby's host. Used to gate the rename UI.
  lobbyHostId: string;
  // Routing
  view: 'home' | 'lobby' | 'table' | 'craps' | 'holdem';
  // Connection
  lobbyRoom: Room | null;
  tableRoom: Room | null;
  table: TableView | null;
  // Craps room + view live alongside the blackjack ones — they share toasts,
  // chat, and the LiveKit venue.
  crapsRoom: Room | null;
  crapsTable: CrapsTableView | null;
  // Hold'em room — same pattern as Craps.
  holdemRoom: Room | null;
  mySessionId: string | null;
  myIdentityId: string;
  myDisplayName: string;
  // UI
  selectedSeatIndex: number | null;
  betDraft: number;
  toasts: Toast[];
  lastResult: HandResult | null;
  reactions: Array<{ id: number; from: string; emote: string }>;
  // Per-seat flash overlay (cleared by the consumer after the animation).
  seatFlashes: SeatFlash[];
  // Chip-flight animations (cleared by the consumer after the animation).
  chipFlights: ChipFlight[];
  // First-time-host coachmark — true until the user opens the host panel once.
  hostCoachmark: boolean;
  // Share modal toggle (clicked from the top-bar or onboarding).
  shareOpen: boolean;
  // Cam
  camStream: MediaStream | null;
  camError: string | null;
  // Peer video — sessionId -> remote MediaStream from LiveKit
  peerStreams: Map<string, MediaStream>;
  // LiveKit venue connection (persistent across screens)
  venue: LiveKitVenue | null;
  // identityId -> 0..1 audio level, refreshed off the LiveKit
  // ActiveSpeakersChanged event. Used to drive the "speaking" pulse on each
  // occupied seat — we key by identityId because that's the value the server
  // mirrors onto SeatSchema.identityId.
  speakingLevels: Map<string, number>;

  setView: (v: State['view']) => void;
  setLobbyRoom: (r: Room | null) => void;
  setTableRoom: (r: Room | null, sessionId: string | null) => void;
  setTable: (t: TableView | null) => void;
  setCrapsRoom: (r: Room | null, sessionId: string | null) => void;
  setCrapsTable: (t: CrapsTableView | null) => void;
  setHoldemRoom: (r: Room | null, sessionId: string | null) => void;
  setIdentity: (id: string, name: string) => void;
  setSelectedSeat: (i: number | null) => void;
  setBetDraft: (n: number) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setLastResult: (r: HandResult | null) => void;
  pushReaction: (r: { from: string; emote: string }) => void;
  dismissReaction: (id: number) => void;
  pushSeatFlash: (f: Omit<SeatFlash, 'spawnedAt'>) => void;
  dismissSeatFlash: (seatIndex: number) => void;
  pushChipFlight: (f: Omit<ChipFlight, 'id' | 'spawnedAt'>) => void;
  dismissChipFlight: (id: number) => void;
  setHostCoachmark: (v: boolean) => void;
  setShareOpen: (v: boolean) => void;
  setLobbyId: (id: string) => void;
  setLobbyName: (n: string) => void;
  setLobbyHostId: (id: string) => void;
  setCam: (s: MediaStream | null, err?: string | null) => void;
  setPeerStreams: (m: Map<string, MediaStream>) => void;
  setVenue: (v: LiveKitVenue | null) => void;
  setSpeakingLevels: (m: Map<string, number>) => void;
}

export const useStore = create<State>((set) => ({
  currentLobbyId: '',
  lobbyName: '',
  lobbyHostId: '',
  view: 'home',
  lobbyRoom: null,
  tableRoom: null,
  table: null,
  crapsRoom: null,
  crapsTable: null,
  holdemRoom: null,
  mySessionId: null,
  myIdentityId: '',
  myDisplayName: '',
  selectedSeatIndex: null,
  betDraft: 50,
  toasts: [],
  lastResult: null,
  reactions: [],
  seatFlashes: [],
  chipFlights: [],
  hostCoachmark: !readHostSeen(),
  shareOpen: false,
  camStream: null,
  camError: null,
  peerStreams: new Map(),
  venue: null,
  speakingLevels: new Map(),

  setView: (v) => set({ view: v }),
  setLobbyRoom: (r) => set({ lobbyRoom: r }),
  setTableRoom: (r, sessionId) => set({ tableRoom: r, mySessionId: sessionId }),
  setTable: (t) => set({ table: t }),
  setCrapsRoom: (r, sessionId) => set({ crapsRoom: r, mySessionId: sessionId }),
  setCrapsTable: (t) => set({ crapsTable: t }),
  setHoldemRoom: (r, sessionId) => set({ holdemRoom: r, mySessionId: sessionId }),
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
  pushSeatFlash: (f) =>
    set((s) => ({
      seatFlashes: [
        ...s.seatFlashes.filter((x) => x.seatIndex !== f.seatIndex),
        { ...f, spawnedAt: Date.now() },
      ],
    })),
  dismissSeatFlash: (seatIndex) =>
    set((s) => ({ seatFlashes: s.seatFlashes.filter((f) => f.seatIndex !== seatIndex) })),
  pushChipFlight: (f) =>
    set((s) => ({
      chipFlights: [
        ...s.chipFlights,
        { ...f, id: Date.now() + Math.random(), spawnedAt: Date.now() },
      ],
    })),
  dismissChipFlight: (id) =>
    set((s) => ({ chipFlights: s.chipFlights.filter((f) => f.id !== id) })),
  setHostCoachmark: (v) => {
    if (!v) markHostSeen();
    set({ hostCoachmark: v });
  },
  setShareOpen: (v) => set({ shareOpen: v }),
  setLobbyId: (id) => set({ currentLobbyId: id }),
  setLobbyName: (n) => set({ lobbyName: n }),
  setLobbyHostId: (id) => set({ lobbyHostId: id }),
  setCam: (s, err = null) => set({ camStream: s, camError: err }),
  setPeerStreams: (m) => set({ peerStreams: new Map(m) }),
  setVenue: (v) => set({ venue: v }),
  setSpeakingLevels: (m) => set({ speakingLevels: new Map(m) }),
}));

// Derived selector — find my seat (if any).
export function selectMySeat(table: TableView | null, sessionId: string | null): SeatView | null {
  if (!table || !sessionId) return null;
  return table.seats.find((s) => s.playerId === sessionId) ?? null;
}

// Total of every active bet — the pot, conceptually. Even though Blackjack is
// per-player against the dealer, players still get the satisfaction of seeing
// "their chips in the middle" pile up during betting.
export function selectPot(table: TableView | null): number {
  if (!table) return 0;
  let n = 0;
  for (const s of table.seats) n += s.bet + s.splitBet;
  return n;
}

const HOST_SEEN_KEY = 'shuffle:hostSeen';

function readHostSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(HOST_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markHostSeen() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOST_SEEN_KEY, '1');
  } catch {
    /* no-op */
  }
}
