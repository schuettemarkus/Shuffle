// Authoritative Blackjack room.
//
// The room owns one shoe, six seats, a dealer, and a finite state machine that
// ticks once per ~100ms. Every player action is validated against the current
// seat phase and table phase. Reconnection within RECONNECT_GRACE_MS keeps the
// seat and stack; beyond it, the player is dropped and the seat opens.

import { Room, Client } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';
import { nanoid } from 'nanoid';
import {
  BET_WINDOW_MS,
  CHAT_HISTORY,
  C2S,
  DEFAULT_BUY_IN,
  HAND_HISTORY,
  RECONNECT_GRACE_MS,
  ROOMS,
  S2C,
  SETTLE_MS,
  TURN_CLOCK_MS,
  type ChatMessage,
  type Emote,
  type HandRecord,
  type HandResult,
  type TableAction,
} from '@shuffle/shared';
import { BlackjackState, CardSchema, SeatSchema } from '../blackjack/schema.js';
import {
  buildShoe,
  dealInitial,
  drawOne,
  handValue,
  isBlackjack,
  newSeed,
  payoutMultiplier,
  revealHole,
  settle,
  shouldDealerHit,
  shuffle,
  type Outcome,
} from '../blackjack/engine.js';
import {
  royalMatchMultiplier,
  type RoyalMatchOutcome,
} from '@shuffle/shared';
import { computeVibe, emptyStats, recordHand, type SeatStats } from '../blackjack/vibe.js';
import * as wallet from '../wallet.js';
import { publishStatus } from '../lobbyRegistry.js';
import { chatBus, getChatHistory, postChat, type ChatEvent } from '../chatBus.js';
import { allow } from '../throttle.js';
import { record as recordLeaderboard } from '../leaderboard.js';
import type { Card } from '@shuffle/shared';

const MAX_SEATS = 6;
const TICK_MS = 100;
// Single-deck blackjack: re-shuffle when fewer than ~30% of the deck remains
// so a hand isn't dealt from a near-empty shoe.
const DECK_COUNT = 1;
const RESHUFFLE_THRESHOLD = 16;

interface JoinOptions {
  identityId: string;
  displayName: string;
  buyIn?: number;
  lobbyId?: string;
}

export class BlackjackRoom extends Room<BlackjackState> {
  override maxClients = 32; // seats=6, plus spectators

  private shoe: Card[] = [];
  private currentSeed = '';
  private dealerHandHidden: Card[] = []; // raw cards including hidden hole
  private tick?: NodeJS.Timeout;
  private actingSeat = -1; // index of seat whose turn it is in 'playing'
  private prevPhase = '';
  private lobbyId = 'default';
  private onChat = (e: ChatEvent) => {
    if (e.lobbyId !== this.lobbyId) return;
    this.broadcast(S2C.chat, e.msg);
  };
  private handLog: HandRecord[] = [];
  // Per-seat session stats keyed by seat index. Reset when a seat is released
  // so a new occupant starts as a "rookie" with no carryover narrative.
  private seatStats = new Map<number, SeatStats>();

  override onCreate(options?: { lobbyId?: string }) {
    this.setState(new BlackjackState());
    // The tableId is namespaced by lobbyId so multiple friend-group lobbies
    // can each have their own Blackjack room. The display name stays
    // generic — the *lobby* is the friend group's brand, not the table.
    const lobbyId = options?.lobbyId || 'default';
    this.lobbyId = lobbyId;
    this.state.tableId = `${lobbyId}:blackjack`;
    this.state.name = 'Blackjack';
    for (let i = 0; i < MAX_SEATS; i++) {
      const seat = new SeatSchema();
      seat.index = i;
      this.state.seats.push(seat);
    }
    this.setPatchRate(50);
    this.shoe = shuffle(buildShoe(DECK_COUNT), newSeed().seed);
    this.state.deckCount = DECK_COUNT;

    this.onMessage(C2S.action, (client, payload: TableAction) => {
      this.handleAction(client, payload);
    });
    this.onMessage(C2S.reaction, (client, payload: { emote: Emote }) => {
      this.broadcast(S2C.reaction, { from: client.sessionId, emote: payload.emote });
    });
    this.onMessage(C2S.chipToss, (client) => {
      this.broadcast(S2C.chipToss, { from: client.sessionId });
    });
    this.onMessage(C2S.chat, (client, payload: { text: string }) => {
      const text = (payload?.text ?? '').toString().trim().slice(0, 280);
      if (!text) return;
      if (!allow('chat', client.sessionId, 500)) return;
      const seat = this.findSeatBySession(client.sessionId);
      const name = (seat?.displayName ||
        (client.userData as JoinOptions | undefined)?.displayName ||
        'Guest').slice(0, 24);
      const msg: ChatMessage = {
        id: nanoid(8),
        from: client.sessionId,
        name,
        text,
        ts: Date.now(),
      };
      // Lobby-scoped chat — every room (lobby + game rooms) gets the same
      // stream via the bus. We don't broadcast directly here; the bus listener
      // does that so each room handles its own clients exactly once.
      postChat(this.lobbyId, msg);
    });

    chatBus.on('message', this.onChat);

    // ---- Host controls ----
    this.onMessage(
      C2S.hostSetStakes,
      (client, m: { minBet: number; maxBet: number }) => {
        if (!this.isHost(client) || this.state.stakesLocked) return;
        const min = Math.max(5, Math.floor(m?.minBet ?? this.state.minBet));
        const max = Math.max(min, Math.floor(m?.maxBet ?? this.state.maxBet));
        this.state.minBet = min;
        this.state.maxBet = max;
      },
    );
    this.onMessage(C2S.hostLockStakes, (client, m: { locked: boolean }) => {
      if (!this.isHost(client)) return;
      this.state.stakesLocked = !!m?.locked;
    });
    this.onMessage(C2S.hostPauseTable, (client, m: { paused: boolean }) => {
      if (!this.isHost(client)) return;
      const paused = !!m?.paused;
      if (paused) {
        if (this.state.phase !== 'paused') {
          this.prevPhase = this.state.phase;
          this.state.phase = 'paused';
        }
      } else if (this.state.phase === 'paused') {
        this.state.phase = (this.prevPhase as typeof this.state.phase) || 'waiting';
      }
    });
    this.onMessage(C2S.hostKick, (client, m: { sessionId: string }) => {
      if (!this.isHost(client)) return;
      if (!m?.sessionId || m.sessionId === client.sessionId) return;
      const target = this.clients.find((c) => c.sessionId === m.sessionId);
      target?.leave(4000, 'Removed by host');
    });
    // Mute is enforced at the LiveKit layer (the client respects the flag).
    this.onMessage(C2S.hostMute, (client, m: { sessionId: string; muted: boolean }) => {
      if (!this.isHost(client)) return;
      if (!m?.sessionId) return;
      const seat = this.findSeatBySession(m.sessionId);
      if (seat) seat.muted = !!m.muted;
    });

    this.tick = setInterval(() => this.onTick(), TICK_MS);
    this.pushLobbyStatus();
  }

  private pushLobbyStatus() {
    const seatsTaken = this.state.seats.filter((s) => s.phase !== 'empty').length;
    const inHand =
      this.state.phase === 'playing' ||
      this.state.phase === 'dealing' ||
      this.state.phase === 'dealer';
    // Heat Index proxy until Phase 4 ships the real algorithm.
    const occupancy = seatsTaken / MAX_SEATS;
    const heat = Math.round(occupancy * 60 + (inHand ? 20 : 0));
    const heatState =
      seatsTaken === 0
        ? 'graveyard'
        : heat >= 75
        ? 'on_fire'
        : heat >= 55
        ? 'buzzing'
        : heat >= 35
        ? 'cruising'
        : 'cold';
    publishStatus({
      tableId: this.state.tableId,
      seatsTaken,
      maxSeats: MAX_SEATS,
      inHand,
      heat,
      heatState,
    });
  }

  override async onJoin(client: Client, options: JoinOptions) {
    const identityId = options?.identityId ?? client.sessionId;
    const displayName = (options?.displayName ?? 'Guest').slice(0, 24);
    wallet.getOrCreateWallet(identityId, displayName);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    client.userData = { identityId, displayName };
    // Re-attach to a seat held by this identity (e.g. tab refresh).
    const existing = this.findSeatByIdentity(identityId);
    if (existing) {
      existing.playerId = client.sessionId;
      existing.displayName = displayName;
      existing.connected = true;
      existing.graceMs = 0;
    }
    // Bring the new client up to speed on chat + recent hand history. Chat
    // is lobby-scoped (shared with every other room in the same lobby), so
    // we pull from the bus instead of a per-room buffer.
    for (const msg of getChatHistory(this.lobbyId)) client.send(S2C.chat, msg);
    client.send(S2C.handHistory, this.handLog);
    this.refreshSpectatorCount();
  }

  override async onLeave(client: Client, consented: boolean) {
    // Host migration: if the host drops, the next client in the room inherits.
    if (this.state.hostId === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.hostId = next?.sessionId ?? '';
    }
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    seat.connected = false;
    seat.graceMs = RECONNECT_GRACE_MS;
    if (consented) {
      this.releaseSeat(seat, /*cashOut*/ true);
      return;
    }
    // Allow the client to reconnect within the grace window.
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
      seat.connected = true;
      seat.graceMs = 0;
      seat.playerId = client.sessionId;
    } catch {
      this.releaseSeat(seat, /*cashOut*/ true);
    }
    this.refreshSpectatorCount();
  }

  override onDispose() {
    if (this.tick) clearInterval(this.tick);
    chatBus.off('message', this.onChat);
  }

  // Spectators = total connected clients minus seated players.
  private refreshSpectatorCount() {
    const seated = this.state.seats.filter((s) => s.phase !== 'empty').length;
    this.state.spectators = Math.max(0, this.clients.length - seated);
  }

  private isHost(client: Client): boolean {
    return this.state.hostId === client.sessionId;
  }

  // ---------- action routing ----------

  private handleAction(client: Client, action: TableAction): void {
    switch (action.type) {
      case 'sit': return this.actSit(client, action.seatIndex, action.buyIn ?? DEFAULT_BUY_IN);
      case 'stand': // alias from controller B on the floor — leave seat
      case 'leave': return this.actLeave(client);
      case 'ready': return this.actReady(client);
      case 'topUp': return this.actTopUp(client, action.amount);
      case 'bet': return this.actBet(client, action.amount);
      case 'royalMatch': return this.actRoyalMatch(client, action.amount);
      case 'hit': return this.actHit(client);
      case 'hitStand': return this.actHitStand(client);
      case 'standHand': return this.actStandHand(client);
      case 'double': return this.actDouble(client);
      case 'surrender': return this.actSurrender(client);
      case 'split': return this.actSplit(client);
      case 'reaction':
      case 'tossChip':
        return; // handled elsewhere or reserved
    }
  }

  private actSit(client: Client, seatIndex: number, buyIn: number) {
    if (seatIndex < 0 || seatIndex >= MAX_SEATS) {
      return this.sendToast(client, 'error', 'That seat does not exist.');
    }
    if (this.findSeatBySession(client.sessionId)) {
      return this.sendToast(client, 'error', 'You are already seated.');
    }
    const seat = this.state.seats[seatIndex];
    if (!seat || seat.phase !== 'empty') {
      return this.sendToast(client, 'error', 'That seat is taken.');
    }
    const { identityId, displayName } = client.userData as JoinOptions;
    const available = wallet.balanceOf(identityId);
    const actualBuyIn = Math.min(Math.max(buyIn, this.state.minBet), available);
    if (actualBuyIn < this.state.minBet) {
      return this.sendToast(client, 'error', 'Not enough chips to buy in.');
    }
    if (!wallet.debit(identityId, actualBuyIn)) {
      return this.sendToast(client, 'error', 'Wallet debit failed.');
    }
    seat.playerId = client.sessionId;
    seat.identityId = identityId;
    seat.displayName = displayName;
    seat.stack = actualBuyIn;
    seat.bet = 0;
    seat.hand.clear();
    seat.handValue = 0;
    seat.isSoft = false;
    seat.phase = 'waiting';
    seat.connected = true;
    seat.graceMs = 0;
    seat.wantReady = false;
    this.clearSplit(seat);
    // Fresh per-session stats for this seat (private + public mirrored).
    this.seatStats.set(seat.index, emptyStats(actualBuyIn));
    seat.buyIn = actualBuyIn;
    seat.handsPlayed = 0;
    seat.handsWon = 0;
    seat.handsLost = 0;
    seat.handsPushed = 0;
    seat.blackjacks = 0;
    seat.netProfit = 0;
    seat.biggestWin = 0;
    seat.biggestLoss = 0;
    this.refreshVibes();
    this.refreshSpectatorCount();
    // First sit at the table → first dealer button.
    if (this.state.dealerButtonSeat < 0) {
      this.state.dealerButtonSeat = seat.index;
    }
    this.maybeStartBetting();
  }

  private actLeave(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    this.releaseSeat(seat, /*cashOut*/ true);
  }

  // Top up the player's seat with an arbitrary chip amount. Play money, so
  // we don't gate on a wallet balance — this is the "buy back in" affordance
  // the user invokes after busting. Clamped to a sane positive amount.
  private actTopUp(client: Client, amount: number) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    if (seat.phase === 'empty') return;
    const clean = Math.max(0, Math.min(1_000_000, Math.floor(amount || 0)));
    if (clean <= 0) return;
    seat.stack += clean;
    seat.buyIn += clean;
    // If the player was waiting because they had no chips, refreshing the
    // vibes lets the public stats line re-read "back in the game".
    this.refreshVibes();
  }

  private actReady(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    // Accept any seated player when the table itself is idle. Restricting
    // to specific seat phases caused the "Deal me in" button to be a no-op
    // when a betting window closed with no bets (seat left in `betting`).
    if (this.state.phase !== 'waiting' && this.state.phase !== 'settling') return;
    if (seat.phase === 'empty') return;
    seat.wantReady = true;
    this.maybeStartBetting();
  }

  private actBet(client: Client, amount: number) {
    if (this.state.phase !== 'betting') {
      return this.sendToast(client, 'error', 'Betting is closed.');
    }
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    const clamped = Math.max(this.state.minBet, Math.min(amount, Math.min(this.state.maxBet, seat.stack)));
    if (clamped <= 0) return;
    // Reset previous bet first if changing.
    seat.stack += seat.bet;
    seat.bet = 0;
    if (clamped > seat.stack) return;
    seat.stack -= clamped;
    seat.bet = clamped;
    seat.phase = 'betting';
  }

  // Royal Match side bet — only legal during the betting window. Pass 0 to
  // cancel, otherwise the amount is clamped to [minBet, min(maxBet, stack)].
  private actRoyalMatch(client: Client, amount: number) {
    if (this.state.phase !== 'betting') {
      return this.sendToast(client, 'error', 'Side bets close when the cards drop.');
    }
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    // Refund the previous side bet first so re-entry math stays clean.
    if (seat.royalMatchBet > 0) {
      seat.stack += seat.royalMatchBet;
      seat.royalMatchBet = 0;
    }
    if (!Number.isFinite(amount) || amount <= 0) return;
    const clamped = Math.min(Math.max(this.state.minBet, Math.floor(amount)), Math.min(this.state.maxBet, seat.stack));
    if (clamped < this.state.minBet) {
      return this.sendToast(client, 'error', 'Side bet must clear the table minimum.');
    }
    seat.stack -= clamped;
    seat.royalMatchBet = clamped;
    seat.royalMatchOutcome = 'none';
    seat.royalMatchPayout = 0;
  }

  private actHit(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    this.hit(seat);
  }

  private actHitStand(client: Client) {
    // Controller A is contextual — at a Blackjack table, A = hit.
    this.actHit(client);
  }

  private actStandHand(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.splitActive) {
      seat.splitPhase = 'standing';
    } else {
      seat.phase = 'standing';
    }
    this.advanceWithinSeatOrNext(seat);
  }

  private actDouble(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    const activeHand = this.activeHandCards(seat);
    if (activeHand.length !== 2) {
      return this.sendToast(client, 'error', 'You can only double on your first two cards.');
    }
    const bet = seat.splitActive ? seat.splitBet : seat.bet;
    if (seat.stack < bet) {
      return this.sendToast(client, 'error', 'Not enough chips to double.');
    }
    seat.stack -= bet;
    if (seat.splitActive) {
      seat.splitBet = bet * 2;
    } else {
      seat.bet = bet * 2;
    }
    this.dealOne(seat);
    // Force stand after the doubled card.
    if (seat.splitActive) {
      if (seat.splitPhase === 'playing') seat.splitPhase = 'standing';
    } else if (seat.phase === 'playing') {
      seat.phase = 'standing';
    }
    this.advanceWithinSeatOrNext(seat);
  }

  private actSurrender(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    // Surrender only allowed on the first decision of the main hand and not
    // after splitting.
    if (seat.splitActive || seat.hand.length !== 2 || seat.splitBet > 0) {
      return this.sendToast(client, 'error', 'Surrender is only available on your first move.');
    }
    seat.phase = 'surrendered';
    this.advanceToNextSeat();
  }

  private actSplit(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.splitBet > 0) {
      return this.sendToast(client, 'error', 'You can only split once per hand.');
    }
    if (seat.hand.length !== 2) {
      return this.sendToast(client, 'error', 'Split must be your first move.');
    }
    const a = seat.hand[0];
    const b = seat.hand[1];
    if (!a || !b) return;
    // Allow split on equal rank — by Vegas rules 10/J/Q/K all count as 10.
    const sameTen = isTen(a.rank) && isTen(b.rank);
    if (a.rank !== b.rank && !sameTen) {
      return this.sendToast(client, 'error', 'You can only split a pair.');
    }
    if (seat.stack < seat.bet) {
      return this.sendToast(client, 'error', 'Not enough chips to split.');
    }
    // Move the second card to the split hand and post a matching bet.
    seat.stack -= seat.bet;
    seat.splitBet = seat.bet;
    seat.splitHand.clear();
    const moved = new CardSchema();
    moved.rank = b.rank;
    moved.suit = b.suit;
    moved.hidden = false;
    seat.splitHand.push(moved);
    seat.hand.splice(1, 1);
    // One card to each (Vegas rules).
    this.dealCardTo(seat.hand);
    this.dealCardTo(seat.splitHand);
    // Recompute values.
    const mainV = handValue(this.toCards(seat.hand));
    seat.handValue = mainV.total;
    seat.isSoft = mainV.soft;
    const splitV = handValue(this.toCards(seat.splitHand));
    seat.splitHandValue = splitV.total;
    seat.splitIsSoft = splitV.soft;
    seat.splitPhase = 'playing';
    seat.splitActive = false;
    seat.turnClockMs = TURN_CLOCK_MS;
    // Player acts on the main hand first, then the split.
  }

  // ---------- internal helpers ----------

  private hit(seat: SeatSchema) {
    this.dealOne(seat);
    const cards = this.toCards(seat.splitActive ? seat.splitHand : seat.hand);
    const { total } = handValue(cards);
    if (total > 21) {
      if (seat.splitActive) seat.splitPhase = 'busted';
      else seat.phase = 'busted';
      this.advanceWithinSeatOrNext(seat);
    } else if (total === 21) {
      if (seat.splitActive) seat.splitPhase = 'standing';
      else seat.phase = 'standing';
      this.advanceWithinSeatOrNext(seat);
    }
  }

  private dealOne(seat: SeatSchema) {
    this.ensureShoe();
    const target = seat.splitActive ? seat.splitHand : seat.hand;
    const { card, shoe } = drawOne(this.shoe);
    this.shoe = shoe;
    this.pushCard(target, card);
    this.bumpCount(card);
    const { total, soft } = handValue(this.toCards(target));
    if (seat.splitActive) {
      seat.splitHandValue = total;
      seat.splitIsSoft = soft;
    } else {
      seat.handValue = total;
      seat.isSoft = soft;
    }
    seat.turnClockMs = TURN_CLOCK_MS;
  }

  private dealCardTo(arr: ArraySchema<CardSchema>) {
    this.ensureShoe();
    const { card, shoe } = drawOne(this.shoe);
    this.shoe = shoe;
    this.pushCard(arr, card);
    this.bumpCount(card);
  }

  private toCards(arr: ArraySchema<CardSchema>): Card[] {
    return arr.map((c) => ({
      rank: c.rank as Card['rank'],
      suit: c.suit as Card['suit'],
      hidden: c.hidden,
    }));
  }

  private pushCard(arr: ArraySchema<CardSchema>, c: Card) {
    const s = new CardSchema();
    s.rank = c.rank;
    s.suit = c.suit;
    s.hidden = !!c.hidden;
    arr.push(s);
  }

  private activeHandCards(seat: SeatSchema): Card[] {
    return this.toCards(seat.splitActive ? seat.splitHand : seat.hand);
  }

  private requireActingSeat(client: Client): SeatSchema | null {
    if (this.state.phase !== 'playing') {
      this.sendToast(client, 'error', "It's not the playing phase.");
      return null;
    }
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat || seat.index !== this.actingSeat) {
      this.sendToast(client, 'error', "It's not your turn.");
      return null;
    }
    return seat;
  }

  private findSeatBySession(sessionId: string): SeatSchema | undefined {
    return this.state.seats.find((s) => s.playerId === sessionId);
  }

  private findSeatByIdentity(identityId: string): SeatSchema | undefined {
    return this.state.seats.find((s) => s.identityId === identityId);
  }

  private releaseSeat(seat: SeatSchema, cashOut: boolean) {
    const total = seat.stack + seat.bet + seat.splitBet + seat.royalMatchBet;
    if (cashOut && seat.identityId && total > 0) {
      wallet.credit(seat.identityId, total);
    }
    seat.royalMatchBet = 0;
    seat.royalMatchOutcome = 'none';
    seat.royalMatchPayout = 0;
    seat.playerId = '';
    seat.identityId = '';
    seat.displayName = '';
    seat.stack = 0;
    seat.bet = 0;
    seat.hand.clear();
    seat.handValue = 0;
    seat.isSoft = false;
    seat.phase = 'empty';
    seat.connected = true;
    seat.graceMs = 0;
    seat.wantReady = false;
    this.clearSplit(seat);
    // Reset vibe so the next occupant doesn't inherit our streaks.
    seat.vibe.key = 'rookie';
    seat.vibe.label = 'New at the felt';
    seat.vibe.icon = '🌅';
    seat.vibe.tint = 'mute';
    seat.vibe.streak = 0;
    // Zero public stats so an empty seat doesn't leak the prior occupant.
    seat.buyIn = 0;
    seat.handsPlayed = 0;
    seat.handsWon = 0;
    seat.handsLost = 0;
    seat.handsPushed = 0;
    seat.blackjacks = 0;
    seat.netProfit = 0;
    seat.biggestWin = 0;
    seat.biggestLoss = 0;
    this.seatStats.delete(seat.index);
    // If we held the dealer button, hand it to whichever non-empty seat is
    // next clockwise so the rotation animation has somewhere to go.
    if (this.state.dealerButtonSeat === seat.index) {
      this.state.dealerButtonSeat = this.nextNonEmptySeatIndex(seat.index);
    }
    this.refreshSpectatorCount();
  }

  private clearSplit(seat: SeatSchema) {
    seat.splitHand.clear();
    seat.splitHandValue = 0;
    seat.splitIsSoft = false;
    seat.splitBet = 0;
    seat.splitPhase = 'empty';
    seat.splitActive = false;
  }

  // ---------- phase machine ----------

  private maybeStartBetting() {
    if (this.state.phase !== 'waiting' && this.state.phase !== 'settling') return;
    const seated = this.state.seats.filter((s) => s.phase !== 'empty');
    if (seated.length === 0) return;
    // If at least one player is waiting/ready, open a betting window.
    this.startBetting();
  }

  private startBetting() {
    for (const s of this.state.seats) {
      if (s.phase === 'empty') continue;
      s.phase = 'betting';
      s.bet = 0;
      s.hand.clear();
      s.handValue = 0;
      s.isSoft = false;
      s.wantReady = false;
      // Side bet resets every hand — no auto-rebet (less footgun).
      s.royalMatchBet = 0;
      s.royalMatchOutcome = 'none';
      s.royalMatchPayout = 0;
      this.clearSplit(s);
    }
    this.state.dealer.hand.clear();
    this.state.dealer.handValue = 0;
    this.state.dealer.isSoft = false;
    this.state.revealedSeed = '';
    this.state.phase = 'betting';
    this.state.phaseClockMs = BET_WINDOW_MS;
    // Rotate the dealer button to the next non-empty seat for the new hand.
    this.advanceDealerButton();
  }

  private advanceDealerButton() {
    const occupied = this.state.seats.filter((s) => s.phase !== 'empty');
    if (occupied.length === 0) {
      this.state.dealerButtonSeat = -1;
      return;
    }
    this.state.dealerButtonSeat = this.nextNonEmptySeatIndex(
      this.state.dealerButtonSeat,
    );
  }

  private nextNonEmptySeatIndex(from: number): number {
    if (from < 0) {
      const first = this.state.seats.find((s) => s.phase !== 'empty');
      return first ? first.index : -1;
    }
    for (let step = 1; step <= MAX_SEATS; step++) {
      const i = (from + step) % MAX_SEATS;
      const s = this.state.seats[i];
      if (s && s.phase !== 'empty') return i;
    }
    return -1;
  }

  private startDealing() {
    // Drop seats with no bet back to waiting.
    const live = this.state.seats.filter((s) => s.phase !== 'empty' && s.bet > 0);
    if (live.length === 0) {
      // Reset any non-empty seats that were stuck in `betting` (no bet placed
      // before the window closed). Without this, the "Deal me in" button is
      // a no-op because `actReady` rejects seats whose phase is `betting`.
      for (const s of this.state.seats) {
        if (s.phase !== 'empty' && s.phase !== 'waiting') s.phase = 'waiting';
      }
      this.state.phase = 'waiting';
      this.state.phaseClockMs = 0;
      return;
    }
    // Commit fresh seed.
    const { seed, commitHash } = newSeed();
    this.currentSeed = seed;
    this.state.commitHash = commitHash;
    this.state.revealedSeed = '';
    this.ensureShoe();
    // Deal initial.
    const seatCount = live.length;
    const result = dealInitial(this.shoe, seatCount);
    this.shoe = result.shoe;
    for (let i = 0; i < live.length; i++) {
      const seat = live[i]!;
      const hand = result.hands[i]!;
      seat.hand.clear();
      for (const c of hand) {
        this.pushCard(seat.hand, c);
        this.bumpCount(c); // Both player cards are dealt face-up.
      }
      const { total, soft } = handValue(hand);
      seat.handValue = total;
      seat.isSoft = soft;
      seat.phase = isBlackjack(hand) ? 'blackjack' : 'playing';
    }
    this.dealerHandHidden = result.dealer;
    this.state.dealer.hand.clear();
    for (const c of result.dealer) this.pushCard(this.state.dealer.hand, c);
    // Dealer's up card is the first card; the hole card stays hidden so we
    // count only the visible one now and the hole on reveal.
    if (result.dealer[0]) this.bumpCount(result.dealer[0]);
    // Dealer's visible value reflects only the up card.
    const dv = handValue(result.dealer);
    this.state.dealer.handValue = dv.total;
    this.state.dealer.isSoft = dv.soft;

    // Royal Match resolves immediately after the initial deal — paying the
    // seat back into their stack so they see the bump live, not at settle.
    for (const seat of live) {
      if (seat.royalMatchBet <= 0) continue;
      const outcome = evaluateRoyalMatch(this.toCards(seat.hand));
      seat.royalMatchOutcome = outcome;
      const ret = Math.floor(seat.royalMatchBet * royalMatchMultiplier(outcome));
      seat.royalMatchPayout = ret;
      seat.stack += ret;
    }

    this.state.round += 1;
    this.state.phase = 'playing';
    this.actingSeat = -1;
    this.advanceToNextSeat();
  }

  // If a split was opened, play the main hand fully, then activate the split.
  // Otherwise advance to the next seat.
  private advanceWithinSeatOrNext(seat: SeatSchema) {
    if (seat.splitBet > 0 && !seat.splitActive && seat.splitPhase === 'playing') {
      // Switch acting to the split hand of the same seat.
      seat.splitActive = true;
      seat.turnClockMs = TURN_CLOCK_MS;
      return;
    }
    if (seat.splitActive) {
      // Finished the split hand — leave the seat with both hands resolved.
      seat.splitActive = false;
    }
    this.advanceToNextSeat();
  }

  private advanceToNextSeat() {
    for (let i = this.actingSeat + 1; i < MAX_SEATS; i++) {
      const s = this.state.seats[i];
      if (!s) continue;
      if (s.phase === 'playing') {
        this.setActing(i);
        return;
      }
    }
    this.setActing(-1);
    this.startDealerPhase();
  }

  private setActing(index: number) {
    for (const s of this.state.seats) {
      s.isTurn = s.index === index;
      if (s.isTurn) s.turnClockMs = TURN_CLOCK_MS;
      else s.turnClockMs = 0;
      // Clear stale split-active on non-acting seats.
      if (!s.isTurn) s.splitActive = false;
    }
    this.actingSeat = index;
  }

  private startDealerPhase() {
    this.state.phase = 'dealer';
    this.state.phaseClockMs = 1200;
    // Reveal hole card.
    const previouslyHidden = this.dealerHandHidden.find((c) => c.hidden);
    const revealed = revealHole(this.dealerHandHidden);
    this.dealerHandHidden = revealed;
    this.state.dealer.hand.clear();
    for (const c of revealed) this.pushCard(this.state.dealer.hand, c);
    // The hole card now contributes to the public count.
    if (previouslyHidden) this.bumpCount(previouslyHidden);
    const v = handValue(revealed);
    this.state.dealer.handValue = v.total;
    this.state.dealer.isSoft = v.soft;
  }

  private tickDealer(): boolean {
    // Returns true while still drawing. Called once per tick.
    const needToDraw = shouldDealerHit(this.dealerHandHidden) && this.someoneNeedsDealer();
    if (!needToDraw) return false;
    this.ensureShoe();
    const { card, shoe } = drawOne(this.shoe);
    this.shoe = shoe;
    this.dealerHandHidden.push(card);
    this.pushCard(this.state.dealer.hand, card);
    this.bumpCount(card);
    const v = handValue(this.dealerHandHidden);
    this.state.dealer.handValue = v.total;
    this.state.dealer.isSoft = v.soft;
    return true;
  }

  private someoneNeedsDealer(): boolean {
    // If every player busted/surrendered, dealer can stop.
    for (const s of this.state.seats) {
      if (s.phase === 'empty') continue;
      if (s.phase === 'standing' || s.phase === 'blackjack') return true;
      if (s.splitBet > 0 && (s.splitPhase === 'standing' || s.splitPhase === 'blackjack'))
        return true;
    }
    return false;
  }

  private settleHand() {
    const perSeat: HandResult['perSeat'] = [];
    const recordSeats: HandRecord['perSeat'] = [];
    for (const s of this.state.seats) {
      if (s.phase === 'empty' || s.bet === 0) continue;
      const playerCards: Card[] = this.toCards(s.hand);
      const outcome: Outcome = settle(playerCards, this.dealerHandHidden, {
        surrendered: s.phase === 'surrendered',
      });
      const mult = payoutMultiplier(outcome);
      const ret = Math.floor(s.bet * mult);
      const delta = ret - s.bet;
      s.stack += ret;

      // Settle split hand if present.
      let splitOutcome: Outcome | undefined;
      let splitDelta: number | undefined;
      let splitCards: Card[] | undefined;
      if (s.splitBet > 0) {
        splitCards = this.toCards(s.splitHand);
        splitOutcome = settle(splitCards, this.dealerHandHidden);
        const splitMult = payoutMultiplier(splitOutcome);
        const splitRet = Math.floor(s.splitBet * splitMult);
        splitDelta = splitRet - s.splitBet;
        s.stack += splitRet;
      }

      // Royal Match side-bet delta (already credited into the stack at deal
      // time, but we still expose the delta in the broadcast/record so the
      // client can render a clear "Royal Match +N" note).
      const royalMatchBetWagered = s.royalMatchBet;
      const royalMatchOutcome = (s.royalMatchOutcome || 'none') as RoyalMatchOutcome;
      const royalMatchDelta =
        royalMatchBetWagered > 0
          ? s.royalMatchPayout - royalMatchBetWagered
          : 0;

      perSeat.push({
        seatIndex: s.index,
        playerId: s.playerId,
        delta,
        outcome,
        splitDelta,
        splitOutcome,
        royalMatchDelta: royalMatchBetWagered > 0 ? royalMatchDelta : undefined,
        royalMatchOutcome: royalMatchBetWagered > 0 ? royalMatchOutcome : undefined,
      });
      recordSeats.push({
        seatIndex: s.index,
        name: s.displayName,
        hand: playerCards.map((c) => ({ rank: c.rank, suit: c.suit })),
        bet: s.bet,
        delta,
        outcome,
        splitHand: splitCards?.map((c) => ({ rank: c.rank, suit: c.suit })),
        splitDelta,
        splitOutcome,
        royalMatchBet: royalMatchBetWagered || undefined,
        royalMatchOutcome: royalMatchBetWagered > 0 ? royalMatchOutcome : undefined,
        royalMatchDelta: royalMatchBetWagered > 0 ? royalMatchDelta : undefined,
      });
      // Update vibe stats with the *combined* result so a player who wins on
      // one hand and loses on the split doesn't look like a pure win/loss.
      const totalDelta = delta + (splitDelta ?? 0);
      const combinedOutcome = combineOutcome(outcome, splitOutcome);
      const stats =
        this.seatStats.get(s.index) ?? emptyStats(s.stack + Math.abs(totalDelta));
      const updated = recordHand(stats, combinedOutcome, s.bet + s.splitBet, s.stack);
      this.seatStats.set(s.index, updated);

      // Public stats mirror — everyone at the table can read them.
      const handTotal = totalDelta + royalMatchDelta;
      s.handsPlayed = updated.handsPlayed;
      s.handsWon = updated.handsWon;
      s.handsLost = updated.handsLost;
      s.handsPushed = updated.handsPushed;
      s.blackjacks = updated.blackjacks;
      s.netProfit = s.stack - (s.buyIn || updated.startingStack);
      if (handTotal > s.biggestWin) s.biggestWin = handTotal;
      if (handTotal < s.biggestLoss) s.biggestLoss = handTotal;
      recordLeaderboard(this.lobbyId, s.identityId, s.displayName, 'blackjack', handTotal);

      s.bet = 0;
      // Reset the side-bet record so the next betting window starts blank.
      s.royalMatchBet = 0;
      // Keep outcome + payout visible until the next betting window opens so
      // the seat can flash the result through the dealer/settling phases.
      this.clearSplit(s);
      s.phase = 'settled';
    }
    const result: HandResult = {
      round: this.state.round,
      perSeat,
      dealerValue: handValue(this.dealerHandHidden).total,
    };
    this.broadcast(S2C.handResult, result);
    // Record for the hand-history viewer.
    const record: HandRecord = {
      round: this.state.round,
      endedAt: Date.now(),
      dealerHand: this.dealerHandHidden.map((c) => ({ rank: c.rank, suit: c.suit })),
      dealerValue: handValue(this.dealerHandHidden).total,
      perSeat: recordSeats,
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    };
    this.handLog.unshift(record);
    if (this.handLog.length > HAND_HISTORY) this.handLog.length = HAND_HISTORY;
    this.broadcast(S2C.handHistory, this.handLog);
    this.state.revealedSeed = this.currentSeed;
    this.broadcast(S2C.shuffleReveal, {
      round: this.state.round,
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    });
    this.refreshVibes();
    this.state.phase = 'settling';
    this.state.phaseClockMs = SETTLE_MS;
  }

  // Recompute every seated player's vibe from session stats + table context.
  private refreshVibes() {
    const stacks = this.state.seats
      .filter((s) => s.phase !== 'empty')
      .map((s) => ({ index: s.index, stack: s.stack }));
    for (const s of this.state.seats) {
      if (s.phase === 'empty') continue;
      const stats = this.seatStats.get(s.index) ?? emptyStats(s.stack);
      const biggestRival = stacks
        .filter((x) => x.index !== s.index)
        .reduce((m, x) => Math.max(m, x.stack), 0);
      const v = computeVibe(stats, {
        stack: s.stack,
        minBet: this.state.minBet,
        maxBet: this.state.maxBet,
        biggestRivalStack: biggestRival,
        displayName: s.displayName,
      });
      if (s.vibe.key !== v.key) s.vibe.key = v.key;
      if (s.vibe.label !== v.label) s.vibe.label = v.label;
      if (s.vibe.icon !== v.icon) s.vibe.icon = v.icon;
      if (s.vibe.tint !== v.tint) s.vibe.tint = v.tint;
      if (s.vibe.streak !== v.streak) s.vibe.streak = v.streak;
    }
  }

  // ---------- ticking ----------

  private onTick() {
    // Drain grace counters for disconnected seats.
    for (const s of this.state.seats) {
      if (!s.connected && s.graceMs > 0) {
        s.graceMs = Math.max(0, s.graceMs - TICK_MS);
      }
    }

    if (this.state.phaseClockMs > 0) {
      this.state.phaseClockMs = Math.max(0, this.state.phaseClockMs - TICK_MS);
    }

    switch (this.state.phase) {
      case 'waiting': {
        // Nothing to do until someone sits + signals ready or places a bet.
        // maybeStartBetting handles the trigger from actSit/actReady.
        break;
      }
      case 'betting': {
        if (this.state.phaseClockMs <= 0) {
          this.startDealing();
        }
        break;
      }
      case 'dealing':
      case 'playing': {
        if (this.actingSeat >= 0) {
          const seat = this.state.seats[this.actingSeat];
          if (seat) {
            seat.turnClockMs = Math.max(0, seat.turnClockMs - TICK_MS);
            if (seat.turnClockMs === 0) {
              // Auto-stand on timeout.
              if (seat.splitActive) seat.splitPhase = 'standing';
              else seat.phase = 'standing';
              this.advanceWithinSeatOrNext(seat);
            }
            if (!seat.connected && seat.graceMs === 0) {
              // Disconnected past grace — stand.
              if (seat.splitActive) seat.splitPhase = 'standing';
              else seat.phase = 'standing';
              this.advanceWithinSeatOrNext(seat);
            }
          }
        }
        break;
      }
      case 'dealer': {
        if (this.state.phaseClockMs <= 0) {
          const stillDrawing = this.tickDealer();
          if (stillDrawing) {
            this.state.phaseClockMs = 700;
          } else {
            this.settleHand();
          }
        }
        break;
      }
      case 'settling': {
        if (this.state.phaseClockMs <= 0) {
          // Reset every seat that just settled. Players who bust to 0 stay
          // seated — they can hit "Buy 1000 chips" to keep playing. We only
          // skip them in the next betting window if they're still at zero.
          for (const s of this.state.seats) {
            if (s.phase === 'settled') {
              s.phase = 'waiting';
            }
          }
          const anySeated = this.state.seats.some((s) => s.phase !== 'empty');
          if (anySeated) this.startBetting();
          else this.state.phase = 'waiting';
        }
        break;
      }
      case 'paused':
        break;
    }

    this.pushLobbyStatus();
  }

  private ensureShoe() {
    if (this.shoe.length < RESHUFFLE_THRESHOLD) {
      this.shoe = shuffle(buildShoe(DECK_COUNT), newSeed().seed);
      this.state.cardsDealt = 0;
      this.state.runningCount = 0;
    }
  }

  // Hi-Lo Blackjack counting: 2–6 are +1, 7–9 are 0, 10/J/Q/K/A are −1.
  // The running count is a public, server-tracked number that everyone at
  // the table can see — counting is legal here and we lean into it.
  private hiLoValue(rank: string): number {
    if (
      rank === '2' || rank === '3' || rank === '4' || rank === '5' || rank === '6'
    )
      return 1;
    if (rank === '7' || rank === '8' || rank === '9') return 0;
    return -1;
  }

  // Bumps cardsDealt + runningCount for a single card. Hidden cards must
  // wait until revealed before they update the count.
  private bumpCount(card: Card | { rank: string }) {
    this.state.cardsDealt += 1;
    this.state.runningCount += this.hiLoValue(card.rank as string);
  }

  private sendToast(client: Client, kind: string, text: string) {
    client.send('toast', { kind, text });
  }
}

function isTen(rank: string): boolean {
  return rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K';
}

// Royal Match: a Vegas-classic blackjack side bet. Evaluated on the player's
// first two cards immediately after the initial deal.
//   • Royal Match — K + Q of the same suit. (Pays 25:1 by tradition.)
//   • Easy Match  — any two cards of the same suit, not a royal. (2.5:1.)
//   • Otherwise   — loses.
function evaluateRoyalMatch(hand: Card[]): RoyalMatchOutcome {
  if (hand.length < 2) return 'lose';
  const a = hand[0]!;
  const b = hand[1]!;
  if (a.suit !== b.suit) return 'lose';
  const ranks = new Set([a.rank, b.rank]);
  if (ranks.has('K') && ranks.has('Q')) return 'royal';
  return 'easy';
}

// For vibe purposes, a hand on a split is summarized to a single outcome:
// any win counts as a win, all losses as a loss, otherwise push.
function combineOutcome(a: Outcome, b: Outcome | undefined): Outcome {
  if (!b) return a;
  const winLike = (o: Outcome) => o === 'win' || o === 'blackjack';
  const loseLike = (o: Outcome) => o === 'lose' || o === 'bust' || o === 'surrender';
  if (winLike(a) || winLike(b)) {
    // Prefer to record the strongest narrative — a blackjack on either hand
    // still feels like a blackjack.
    if (a === 'blackjack' || b === 'blackjack') return 'blackjack';
    return 'win';
  }
  if (loseLike(a) && loseLike(b)) return 'lose';
  return 'push';
}
