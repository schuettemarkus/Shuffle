// Authoritative Blackjack room.
//
// The room owns one shoe, six seats, a dealer, and a finite state machine that
// ticks once per ~100ms. Every player action is validated against the current
// seat phase and table phase. Reconnection within RECONNECT_GRACE_MS keeps the
// seat and stack; beyond it, the player is dropped and the seat opens.

import { Room, Client } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';
import {
  BET_WINDOW_MS,
  DEFAULT_BUY_IN,
  RECONNECT_GRACE_MS,
  ROOMS,
  S2C,
  SETTLE_MS,
  TURN_CLOCK_MS,
  type TableAction,
  type HandResult,
  type Emote,
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
import * as wallet from '../wallet.js';
import {
  publishStatus,
  configBus,
  getTableConfig,
  type TableConfig,
} from '../lobbyRegistry.js';
import type { Card } from '@shuffle/shared';

const MAX_SEATS = 6;
const TICK_MS = 100;
const RESHUFFLE_THRESHOLD = 26; // reshuffle when shoe drops below this many cards

interface JoinOptions {
  identityId: string;
  displayName: string;
  buyIn?: number;
}

export class BlackjackRoom extends Room<BlackjackState> {
  override maxClients = 32; // seats=6, plus spectators

  private shoe: Card[] = [];
  private currentSeed = '';
  private dealerHandHidden: Card[] = []; // raw cards including hidden hole
  private tick?: NodeJS.Timeout;
  private actingSeat = -1; // index of seat whose turn it is in 'playing'
  private prevPhase = '';
  private onConfigChange = (c: TableConfig) => this.applyConfig(c);

  override onCreate(_options?: unknown) {
    this.setState(new BlackjackState());
    this.state.tableId = 'sunset-lounge';
    this.state.name = 'Sunset Lounge';
    for (let i = 0; i < MAX_SEATS; i++) {
      const seat = new SeatSchema();
      seat.index = i;
      this.state.seats.push(seat);
    }
    this.setPatchRate(50);
    this.shoe = shuffle(buildShoe(4), newSeed().seed);

    this.onMessage('action', (client, payload: TableAction) => {
      this.handleAction(client, payload);
    });
    this.onMessage('reaction', (client, payload: { emote: Emote }) => {
      this.broadcast(S2C.reaction, { from: client.sessionId, emote: payload.emote });
    });
    this.onMessage('chipToss', (client) => {
      this.broadcast(S2C.chipToss, { from: client.sessionId });
    });

    // ---- WebRTC mesh signaling (Phase 1 substitute for LiveKit) ----
    // The server is a dumb relay: it forwards offer/answer/ice between two
    // named peers and broadcasts presence so clients know who to dial.
    this.onMessage(
      'webrtcSignal',
      (client, msg: { to: string; kind: string; data: unknown }) => {
        if (!msg?.to || !msg.kind) return;
        const target = this.clients.find((c) => c.sessionId === msg.to);
        if (!target) return;
        target.send(S2C.webrtcSignal, {
          from: client.sessionId,
          kind: msg.kind,
          data: msg.data,
        });
      },
    );
    this.onMessage('webrtcReady', (client) => {
      // Tell everyone else this peer is ready to receive offers.
      this.broadcast(
        S2C.webrtcPeerReady,
        { sessionId: client.sessionId },
        { except: client },
      );
      // And tell the new client about everyone already present.
      for (const c of this.clients) {
        if (c.sessionId === client.sessionId) continue;
        client.send(S2C.webrtcPeerReady, { sessionId: c.sessionId });
      }
    });

    this.tick = setInterval(() => this.onTick(), TICK_MS);
    // Apply any host-set config that already exists, then subscribe.
    const existing = getTableConfig(this.state.tableId);
    if (existing) this.applyConfig(existing);
    configBus.on('change', this.onConfigChange);
    this.pushLobbyStatus();
  }

  private applyConfig(c: TableConfig) {
    if (c.tableId !== this.state.tableId) return;
    this.state.minBet = c.minBet;
    this.state.maxBet = c.maxBet;
    if (c.paused) {
      if (this.state.phase !== 'paused') {
        this.prevPhase = this.state.phase;
        this.state.phase = 'paused';
      }
    } else if (this.state.phase === 'paused') {
      this.state.phase = (this.prevPhase as typeof this.state.phase) || 'waiting';
    }
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
  }

  override async onLeave(client: Client, consented: boolean) {
    // Tell every other client to tear down its peer connection with this one.
    this.broadcast(
      S2C.webrtcPeerGone,
      { sessionId: client.sessionId },
      { except: client },
    );
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
  }

  override onDispose() {
    if (this.tick) clearInterval(this.tick);
    configBus.off('change', this.onConfigChange);
  }

  // ---------- action routing ----------

  private handleAction(client: Client, action: TableAction): void {
    switch (action.type) {
      case 'sit': return this.actSit(client, action.seatIndex, action.buyIn ?? DEFAULT_BUY_IN);
      case 'stand': // alias from controller B on the floor — leave seat
      case 'leave': return this.actLeave(client);
      case 'ready': return this.actReady(client);
      case 'bet': return this.actBet(client, action.amount);
      case 'hit': return this.actHit(client);
      case 'hitStand': return this.actHitStand(client);
      case 'standHand': return this.actStandHand(client);
      case 'double': return this.actDouble(client);
      case 'surrender': return this.actSurrender(client);
      case 'split':
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
    this.maybeStartBetting();
  }

  private actLeave(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    this.releaseSeat(seat, /*cashOut*/ true);
  }

  private actReady(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    if (seat.phase !== 'waiting' && seat.phase !== 'settled') return;
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
    seat.phase = 'standing';
    this.advanceToNextSeat();
  }

  private actDouble(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.hand.length !== 2) {
      return this.sendToast(client, 'error', 'You can only double on your first two cards.');
    }
    if (seat.stack < seat.bet) {
      return this.sendToast(client, 'error', 'Not enough chips to double.');
    }
    seat.stack -= seat.bet;
    seat.bet *= 2;
    this.dealOne(seat);
    if (seat.phase === 'playing') {
      seat.phase = 'standing';
      this.advanceToNextSeat();
    }
  }

  private actSurrender(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.hand.length !== 2) {
      return this.sendToast(client, 'error', 'You can only surrender on your first decision.');
    }
    seat.phase = 'surrendered';
    this.advanceToNextSeat();
  }

  // ---------- internal helpers ----------

  private hit(seat: SeatSchema) {
    this.dealOne(seat);
    const { total } = handValue(this.toCards(seat.hand));
    if (total > 21) {
      seat.phase = 'busted';
      this.advanceToNextSeat();
    } else if (total === 21) {
      seat.phase = 'standing';
      this.advanceToNextSeat();
    }
  }

  private dealOne(seat: SeatSchema) {
    this.ensureShoe();
    const { card, shoe } = drawOne(this.shoe);
    this.shoe = shoe;
    this.pushCard(seat.hand, card);
    const { total, soft } = handValue(this.toCards(seat.hand));
    seat.handValue = total;
    seat.isSoft = soft;
    seat.turnClockMs = TURN_CLOCK_MS;
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
    const total = seat.stack + seat.bet;
    if (cashOut && seat.identityId && total > 0) {
      wallet.credit(seat.identityId, total);
    }
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
    }
    this.state.dealer.hand.clear();
    this.state.dealer.handValue = 0;
    this.state.dealer.isSoft = false;
    this.state.revealedSeed = '';
    this.state.phase = 'betting';
    this.state.phaseClockMs = BET_WINDOW_MS;
  }

  private startDealing() {
    // Drop seats with no bet back to waiting.
    const live = this.state.seats.filter((s) => s.phase !== 'empty' && s.bet > 0);
    if (live.length === 0) {
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
      for (const c of hand) this.pushCard(seat.hand, c);
      const { total, soft } = handValue(hand);
      seat.handValue = total;
      seat.isSoft = soft;
      seat.phase = isBlackjack(hand) ? 'blackjack' : 'playing';
    }
    this.dealerHandHidden = result.dealer;
    this.state.dealer.hand.clear();
    for (const c of result.dealer) this.pushCard(this.state.dealer.hand, c);
    // Dealer's visible value reflects only the up card.
    const dv = handValue(result.dealer);
    this.state.dealer.handValue = dv.total;
    this.state.dealer.isSoft = dv.soft;

    this.state.round += 1;
    this.state.phase = 'playing';
    this.actingSeat = -1;
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
    }
    this.actingSeat = index;
  }

  private startDealerPhase() {
    this.state.phase = 'dealer';
    this.state.phaseClockMs = 1200;
    // Reveal hole card.
    const revealed = revealHole(this.dealerHandHidden);
    this.dealerHandHidden = revealed;
    this.state.dealer.hand.clear();
    for (const c of revealed) this.pushCard(this.state.dealer.hand, c);
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
    }
    return false;
  }

  private settleHand() {
    const perSeat: HandResult['perSeat'] = [];
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
      perSeat.push({ seatIndex: s.index, playerId: s.playerId, delta, outcome });
      s.bet = 0;
      s.phase = 'settled';
    }
    const result: HandResult = {
      round: this.state.round,
      perSeat,
      dealerValue: handValue(this.dealerHandHidden).total,
    };
    this.broadcast(S2C.handResult, result);
    this.state.revealedSeed = this.currentSeed;
    this.broadcast(S2C.shuffleReveal, {
      round: this.state.round,
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    });
    this.state.phase = 'settling';
    this.state.phaseClockMs = SETTLE_MS;
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
              seat.phase = 'standing';
              this.advanceToNextSeat();
            }
            if (!seat.connected && seat.graceMs === 0) {
              // Disconnected past grace — stand.
              seat.phase = 'standing';
              this.advanceToNextSeat();
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
          // Drop empty/zero-stack players, then start a new betting window if any seat remains.
          for (const s of this.state.seats) {
            if (s.phase !== 'empty' && s.stack <= 0) {
              this.releaseSeat(s, /*cashOut*/ true);
            } else if (s.phase === 'settled') {
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
      this.shoe = shuffle(buildShoe(4), newSeed().seed);
    }
  }

  private sendToast(client: Client, kind: string, text: string) {
    client.send('toast', { kind, text });
  }
}
