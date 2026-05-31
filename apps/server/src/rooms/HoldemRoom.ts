// No-Limit Texas Hold'em room — server-authoritative for cards, bets, and
// pot distribution. Mirrors the Blackjack / Craps room patterns: a tick loop
// drives turn clocks, a commit-reveal seed governs the shuffle, and the
// lobby registry receives every material status change.

import { Room, Client } from '@colyseus/core';
import { ArraySchema } from '@colyseus/schema';
import {
  C2S,
  CHAT_HISTORY,
  HOLDEM_BETWEEN_MS,
  HOLDEM_BIG_BLIND,
  HOLDEM_MAX_SEATS,
  HOLDEM_SHOWDOWN_MS,
  HOLDEM_SMALL_BLIND,
  HOLDEM_TURN_CLOCK_MS,
  RECONNECT_GRACE_MS,
  S2C,
  type Card,
  type ChatMessage,
  type Emote,
  type HoldemAction,
  type HoldemHandRecord,
  type HoldemHandResult,
} from '@shuffle/shared';
import { nanoid } from 'nanoid';
import {
  HoldemCardSchema,
  HoldemPotSchema,
  HoldemSeatSchema,
  HoldemState,
} from '../holdem/schema.js';
import { buildShoe, newSeed, shuffle } from '../blackjack/engine.js';
import { evaluateBest } from '../holdem/eval.js';
import { buildSidePots, type Contribution } from '../holdem/sidepots.js';
import { publishStatus } from '../lobbyRegistry.js';
import { chatBus, getChatHistory, postChat, type ChatEvent } from '../chatBus.js';
import { allow } from '../throttle.js';

const TICK_MS = 100;
const HAND_HISTORY = 10;
const DEFAULT_BUY_IN = 1000;
const MIN_BUY_IN = HOLDEM_BIG_BLIND * 20;   // standard buy-in floor

interface JoinOptions {
  identityId: string;
  displayName: string;
  buyIn?: number;
  lobbyId?: string;
}

export class HoldemRoom extends Room<HoldemState> {
  override maxClients = 32;

  private tickHandle?: NodeJS.Timeout;
  private deck: Card[] = [];
  private currentSeed = '';
  private lobbyId = 'default';
  private handLog: HoldemHandRecord[] = [];
  private onChat = (e: ChatEvent) => {
    if (e.lobbyId !== this.lobbyId) return;
    this.broadcast(S2C.chat, e.msg);
  };
  // `actedThisStreet[i]` = true means seat i has had a turn this street since
  // any aggression (or since the street opened). Cleared on raise/bet.
  private actedThisStreet = new Array<boolean>(HOLDEM_MAX_SEATS).fill(false);
  // Tracks the next player to act in the current street.
  private actingSeat = -1;

  override onCreate(options?: { lobbyId?: string }) {
    this.setState(new HoldemState());
    const lobbyId = options?.lobbyId || 'default';
    this.lobbyId = lobbyId;
    this.state.tableId = `${lobbyId}:holdem`;
    this.state.lobbyId = lobbyId;
    this.state.name = 'Hold’em';
    for (let i = 0; i < HOLDEM_MAX_SEATS; i++) {
      const seat = new HoldemSeatSchema();
      seat.index = i;
      this.state.seats.push(seat);
    }
    this.setMetadata({ lobbyId });
    this.setPatchRate(60);

    this.onMessage(C2S.action, (client, action: HoldemAction) => {
      this.handleAction(client, action);
    });

    this.onMessage(C2S.chat, (client, payload: { text?: string }) => {
      const seat = this.findSeatBySession(client.sessionId);
      const text = String(payload?.text ?? '').trim().slice(0, 280);
      if (!text) return;
      if (!allow('chat', client.sessionId, 500)) return;
      const name = (seat?.displayName ||
        (client.userData as JoinOptions | undefined)?.displayName ||
        'Guest').slice(0, 24);
      const msg: ChatMessage = {
        id: nanoid(),
        from: client.sessionId,
        name,
        text,
        ts: Date.now(),
      };
      postChat(this.lobbyId, msg);
    });

    this.onMessage(C2S.reaction, (client, payload: { emote?: Emote }) => {
      if (!payload?.emote) return;
      this.broadcast(S2C.reaction, { from: client.sessionId, emote: payload.emote });
    });

    this.onMessage(C2S.chipToss, (client) => {
      this.broadcast(S2C.chipToss, { from: client.sessionId });
    });

    chatBus.on('message', this.onChat);
    this.tickHandle = setInterval(() => this.onTick(), TICK_MS);
    this.pushLobbyStatus();
  }

  override async onJoin(client: Client, options: JoinOptions) {
    const identityId = options?.identityId ?? client.sessionId;
    const displayName = (options?.displayName ?? 'Guest').slice(0, 24);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    client.userData = { identityId, displayName };
    const existing = this.findSeatByIdentity(identityId);
    if (existing) {
      existing.playerId = client.sessionId;
      existing.displayName = displayName;
      existing.connected = true;
      existing.graceMs = 0;
    }
    for (const msg of getChatHistory(this.lobbyId)) client.send(S2C.chat, msg);
    client.send(S2C.holdemHandHistory, this.handLog);
  }

  override async onLeave(client: Client, consented: boolean) {
    if (this.state.hostId === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.hostId = next?.sessionId ?? '';
    }
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    seat.connected = false;
    seat.graceMs = RECONNECT_GRACE_MS;
    if (consented) {
      this.releaseSeat(seat);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
      seat.connected = true;
      seat.graceMs = 0;
      seat.playerId = client.sessionId;
    } catch {
      this.releaseSeat(seat);
    }
  }

  override onDispose() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    chatBus.off('message', this.onChat);
  }

  // -------- helpers --------

  private findSeatBySession(sessionId: string): HoldemSeatSchema | undefined {
    return this.state.seats.find((s) => s.playerId === sessionId && s.phase !== 'empty');
  }

  private findSeatByIdentity(identityId: string): HoldemSeatSchema | undefined {
    if (!identityId) return undefined;
    return this.state.seats.find((s) => s.identityId === identityId && s.phase !== 'empty');
  }

  private liveSeats(): HoldemSeatSchema[] {
    return this.state.seats.filter(
      (s) => s.phase === 'inHand' || s.phase === 'allIn',
    );
  }

  private liveAndAbleToAct(): HoldemSeatSchema[] {
    return this.state.seats.filter((s) => s.phase === 'inHand' && s.stack > 0);
  }

  private seatedReady(): HoldemSeatSchema[] {
    return this.state.seats.filter(
      (s) => s.phase !== 'empty' && !s.sittingOut && s.stack >= this.state.bigBlind,
    );
  }

  // -------- action routing --------

  private handleAction(client: Client, action: HoldemAction) {
    switch (action.type) {
      case 'sit': return this.actSit(client, action.seatIndex, action.buyIn ?? DEFAULT_BUY_IN);
      case 'leave': return this.actLeave(client);
      case 'topUp': return this.actTopUp(client, action.amount);
      case 'check': return this.actCheck(client);
      case 'call': return this.actCall(client);
      case 'fold': return this.actFold(client);
      case 'bet': return this.actBet(client, action.amount);
      case 'raise': return this.actRaise(client, action.amount);
      case 'allIn': return this.actAllIn(client);
    }
  }

  private actSit(client: Client, seatIndex: number, buyIn: number) {
    if (seatIndex < 0 || seatIndex >= HOLDEM_MAX_SEATS) return;
    if (this.findSeatBySession(client.sessionId)) return;
    const seat = this.state.seats[seatIndex];
    if (!seat || seat.phase !== 'empty') return;
    const { identityId, displayName } = client.userData as JoinOptions;
    const clamped = Math.max(MIN_BUY_IN, Math.floor(buyIn));
    seat.playerId = client.sessionId;
    seat.identityId = identityId;
    seat.displayName = displayName;
    seat.stack = clamped;
    seat.buyIn = clamped;
    seat.committed = 0;
    seat.totalCommitted = 0;
    seat.hole.clear();
    seat.handLabel = '';
    seat.handsPlayed = 0;
    seat.handsWon = 0;
    seat.netProfit = 0;
    seat.phase = 'sitting';
    seat.connected = true;
    seat.graceMs = 0;
    seat.sittingOut = false;
    this.maybeStartHand();
    this.pushLobbyStatus();
  }

  private actLeave(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    this.releaseSeat(seat);
  }

  private actTopUp(client: Client, amount: number) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat || seat.phase === 'empty') return;
    const clean = Math.max(0, Math.min(1_000_000, Math.floor(amount || 0)));
    if (clean <= 0) return;
    seat.stack += clean;
    seat.buyIn += clean;
  }

  private actCheck(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.committed !== this.state.currentBet) return; // can't check facing a bet
    this.actedThisStreet[seat.index] = true;
    this.advanceTurn();
  }

  private actCall(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    const owed = this.state.currentBet - seat.committed;
    if (owed <= 0) return this.actCheck(client);
    const pay = Math.min(owed, seat.stack);
    this.commit(seat, pay);
    if (seat.stack === 0) seat.phase = 'allIn';
    this.actedThisStreet[seat.index] = true;
    this.advanceTurn();
  }

  private actFold(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    seat.phase = 'folded';
    seat.isTurn = false;
    this.actedThisStreet[seat.index] = true;
    this.advanceTurn();
  }

  private actBet(client: Client, amount: number) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (this.state.currentBet !== 0) return; // use raise() when there's already a bet
    const target = Math.floor(amount);
    if (target < this.state.bigBlind) return;
    if (target > seat.stack) return this.actAllIn(client);
    this.commit(seat, target);
    this.openRaise(seat, target);
  }

  private actRaise(client: Client, amount: number) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (this.state.currentBet === 0) return this.actBet(client, amount);
    // `amount` is the total to-call after the raise (i.e. the new currentBet).
    const target = Math.floor(amount);
    const minLegal = this.state.currentBet + this.state.minRaise;
    if (target < minLegal && target < seat.stack + seat.committed) return;
    const owed = target - seat.committed;
    if (owed > seat.stack) return this.actAllIn(client);
    this.commit(seat, owed);
    this.openRaise(seat, target);
  }

  private actAllIn(client: Client) {
    const seat = this.requireActingSeat(client);
    if (!seat) return;
    if (seat.stack <= 0) return;
    const newTotal = seat.committed + seat.stack;
    const wasRaise = newTotal > this.state.currentBet;
    this.commit(seat, seat.stack);
    seat.phase = 'allIn';
    if (wasRaise) {
      // Treat as raise if it exceeds the current bet. Min-raise only updates
      // when the all-in is a "full" raise (>= minRaise on top of currentBet).
      const fullRaise = newTotal - this.state.currentBet;
      if (fullRaise >= this.state.minRaise) {
        this.state.minRaise = fullRaise;
      }
      this.state.currentBet = newTotal;
      for (const s of this.liveAndAbleToAct()) {
        if (s.index !== seat.index) this.actedThisStreet[s.index] = false;
      }
    }
    this.actedThisStreet[seat.index] = true;
    this.advanceTurn();
  }

  private commit(seat: HoldemSeatSchema, amount: number) {
    const taken = Math.min(amount, seat.stack);
    seat.stack -= taken;
    seat.committed += taken;
    seat.totalCommitted += taken;
  }

  private openRaise(seat: HoldemSeatSchema, newTarget: number) {
    const raiseSize = newTarget - this.state.currentBet;
    if (raiseSize > this.state.minRaise) this.state.minRaise = raiseSize;
    this.state.currentBet = newTarget;
    for (const s of this.liveAndAbleToAct()) {
      if (s.index !== seat.index) this.actedThisStreet[s.index] = false;
    }
    this.actedThisStreet[seat.index] = true;
    this.advanceTurn();
  }

  private requireActingSeat(client: Client): HoldemSeatSchema | undefined {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return undefined;
    if (!seat.isTurn) return undefined;
    return seat;
  }

  // -------- hand lifecycle --------

  private maybeStartHand() {
    if (this.state.phase !== 'waiting' && this.state.phase !== 'between') return;
    const ready = this.seatedReady();
    if (ready.length < 2) {
      this.state.phase = 'waiting';
      this.state.phaseClockMs = 0;
      return;
    }
    if (this.state.phase === 'waiting') {
      this.state.phase = 'between';
      this.state.phaseClockMs = HOLDEM_BETWEEN_MS;
    }
  }

  private startHand() {
    const players = this.seatedReady();
    if (players.length < 2) {
      this.state.phase = 'waiting';
      this.state.phaseClockMs = 0;
      return;
    }
    this.state.round += 1;

    // Reset community + pots + per-seat hand state.
    this.state.community.clear();
    this.state.pots.clear();
    this.actedThisStreet.fill(false);
    for (const s of this.state.seats) {
      s.hole.clear();
      s.committed = 0;
      s.totalCommitted = 0;
      s.handLabel = '';
      s.isTurn = false;
      s.turnClockMs = 0;
      if (s.phase === 'empty') continue;
      if (s.sittingOut || s.stack < this.state.bigBlind) {
        s.phase = 'sitting';
      } else {
        s.phase = 'inHand';
      }
    }

    // Rotate button to next live player (or seed it on first hand).
    this.state.buttonSeat = this.nextSeatInState(this.state.buttonSeat, 'inHand');

    const live = this.seatsInHandOrdered();
    if (live.length < 2) {
      this.state.phase = 'waiting';
      this.state.phaseClockMs = 0;
      return;
    }

    // Blinds. Heads-up: button = SB, the other = BB. 3+: SB = next live after
    // button, BB = next live after SB.
    let sb: HoldemSeatSchema;
    let bb: HoldemSeatSchema;
    if (live.length === 2) {
      sb = this.state.seats[this.state.buttonSeat]!;
      bb = this.state.seats[this.nextLive(this.state.buttonSeat)]!;
    } else {
      sb = this.state.seats[this.nextLive(this.state.buttonSeat)]!;
      bb = this.state.seats[this.nextLive(sb.index)]!;
    }
    this.state.smallBlindSeat = sb.index;
    this.state.bigBlindSeat = bb.index;
    this.postBlind(sb, this.state.smallBlind);
    this.postBlind(bb, this.state.bigBlind);
    this.state.currentBet = this.state.bigBlind;
    this.state.minRaise = this.state.bigBlind;

    // Shuffle and deal hole cards.
    const { seed, commitHash } = newSeed();
    this.currentSeed = seed;
    this.state.commitHash = commitHash;
    this.state.revealedSeed = '';
    this.deck = shuffle(buildShoe(1), seed);
    // Two rounds — each player gets one card in order, then again.
    const ordered = this.seatsInHandOrdered();
    for (let round = 0; round < 2; round++) {
      for (const seat of ordered) {
        const card = this.deck.shift()!;
        this.pushCard(seat.hole, card);
      }
    }

    this.state.phase = 'preflop';
    // Preflop: action starts on the seat AFTER BB (UTG). Heads-up exception:
    // SB (= button) acts first preflop.
    if (live.length === 2) {
      this.setActing(sb.index);
    } else {
      this.setActing(this.nextLive(bb.index));
    }
    // Blinds count as "posted" not "voluntarily acted" — the BB still gets the
    // option to raise even if everyone calls. Mark SB+BB as not-acted.
    this.actedThisStreet.fill(false);
    this.pushLobbyStatus();
  }

  private postBlind(seat: HoldemSeatSchema, blind: number) {
    const pay = Math.min(blind, seat.stack);
    this.commit(seat, pay);
    if (seat.stack === 0) seat.phase = 'allIn';
  }

  private setActing(index: number) {
    for (const s of this.state.seats) {
      s.isTurn = false;
      s.turnClockMs = 0;
    }
    const seat = this.state.seats[index];
    if (!seat) {
      this.actingSeat = -1;
      return;
    }
    seat.isTurn = true;
    seat.turnClockMs = HOLDEM_TURN_CLOCK_MS;
    this.actingSeat = index;
  }

  private advanceTurn() {
    // If only one live player remains, hand is over.
    const stillIn = this.state.seats.filter(
      (s) => s.phase === 'inHand' || s.phase === 'allIn',
    );
    const stillInActing = stillIn.filter((s) => s.phase === 'inHand');
    if (stillIn.length <= 1) {
      this.awardUncontested(stillIn[0]);
      return;
    }

    // If everyone remaining is all-in, no more betting on subsequent streets;
    // just run out the board.
    if (stillInActing.length <= 1 && !this.bettingRoundClosed()) {
      // One acting player vs all-in opponents: if they've already matched the
      // current bet (or are also effectively done), close the round.
      const acting = stillInActing[0];
      if (acting && acting.committed >= this.state.currentBet) {
        return this.closeStreet();
      }
    }

    if (this.bettingRoundClosed()) {
      return this.closeStreet();
    }

    // Find next live seat that hasn't acted (or hasn't satisfied currentBet).
    let i = this.actingSeat;
    for (let step = 0; step < HOLDEM_MAX_SEATS; step++) {
      i = (i + 1) % HOLDEM_MAX_SEATS;
      const s = this.state.seats[i];
      if (!s || s.phase !== 'inHand') continue;
      if (this.actedThisStreet[i] && s.committed === this.state.currentBet) continue;
      this.setActing(i);
      return;
    }
    // Nobody left to act — close street.
    this.closeStreet();
  }

  private bettingRoundClosed(): boolean {
    const live = this.state.seats.filter(
      (s) => s.phase === 'inHand' || s.phase === 'allIn',
    );
    if (live.length <= 1) return true;
    for (const s of live) {
      if (s.phase !== 'inHand') continue; // all-ins are done
      if (!this.actedThisStreet[s.index]) return false;
      if (s.committed !== this.state.currentBet) return false;
    }
    return true;
  }

  private closeStreet() {
    // Move committed -> totalCommitted is already tracked; here we just reset
    // per-street committed and push community cards for the next street.
    for (const s of this.state.seats) s.committed = 0;
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.actedThisStreet.fill(false);
    for (const s of this.state.seats) s.isTurn = false;
    const phase = this.state.phase;
    if (phase === 'preflop') return this.dealFlop();
    if (phase === 'flop') return this.dealTurn();
    if (phase === 'turn') return this.dealRiver();
    if (phase === 'river') return this.goShowdown();
  }

  private burnAndDraw(count: number): Card[] {
    this.deck.shift(); // burn one
    const drawn: Card[] = [];
    for (let i = 0; i < count; i++) drawn.push(this.deck.shift()!);
    return drawn;
  }

  private dealFlop() {
    const cards = this.burnAndDraw(3);
    for (const c of cards) this.pushCard(this.state.community, c);
    this.state.phase = 'flop';
    this.startPostflopStreet();
  }

  private dealTurn() {
    const [c] = this.burnAndDraw(1);
    this.pushCard(this.state.community, c!);
    this.state.phase = 'turn';
    this.startPostflopStreet();
  }

  private dealRiver() {
    const [c] = this.burnAndDraw(1);
    this.pushCard(this.state.community, c!);
    this.state.phase = 'river';
    this.startPostflopStreet();
  }

  private startPostflopStreet() {
    // If only one acting player vs. all-ins, skip betting on this street.
    const acting = this.state.seats.filter((s) => s.phase === 'inHand');
    if (acting.length <= 1) {
      // Auto-advance — schedule a short pause via phaseClockMs so the deal is
      // visible before the next street.
      this.state.phaseClockMs = 800;
      return;
    }
    // First to act postflop = first live seat after the button (3+) or the
    // non-button seat (heads-up).
    const live = this.seatsInHandOrdered();
    let first: HoldemSeatSchema | undefined;
    if (live.length === 2) {
      first = this.state.seats[this.nextLive(this.state.buttonSeat)];
    } else {
      first = this.state.seats[this.nextLiveFrom(this.state.buttonSeat, 'inHand')];
    }
    if (!first) {
      // No one able to act — skip.
      this.state.phaseClockMs = 800;
      return;
    }
    this.setActing(first.index);
  }

  private goShowdown() {
    this.state.phase = 'showdown';
    this.state.revealedSeed = this.currentSeed;
    this.state.phaseClockMs = HOLDEM_SHOWDOWN_MS;
    this.broadcast(S2C.shuffleReveal, {
      round: this.state.round,
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    });

    // Build side pots from totalCommitted across ALL seats (including folded).
    const contribs: Contribution[] = this.state.seats
      .filter((s) => s.totalCommitted > 0)
      .map((s) => ({
        seatIndex: s.index,
        committed: s.totalCommitted,
        folded: s.phase === 'folded',
      }));
    const pots = buildSidePots(contribs);

    // Evaluate every live seat's hand.
    const community = this.toCards(this.state.community);
    const evals = new Map<number, ReturnType<typeof evaluateBest>>();
    for (const s of this.state.seats) {
      if (s.phase !== 'inHand' && s.phase !== 'allIn') continue;
      const hole = this.toCards(s.hole);
      const score = evaluateBest([...hole, ...community]);
      evals.set(s.index, score);
      s.handLabel = score.label;
      s.phase = 'showdown';
    }

    // Award pots — split equally on ties; chips remainder goes to the seat
    // closest left of the button.
    const handStart = new Map<number, number>();
    for (const s of this.state.seats) {
      handStart.set(s.index, s.stack + s.totalCommitted);
    }
    const perPot: HoldemHandResult['perPot'] = [];
    for (const pot of pots) {
      const eligible = pot.eligibleSeats
        .map((idx) => ({ idx, score: evals.get(idx) }))
        .filter((x) => x.score) as Array<{ idx: number; score: ReturnType<typeof evaluateBest> }>;
      if (eligible.length === 0) continue;
      const bestScore = Math.max(...eligible.map((e) => e.score.score));
      const winners = eligible.filter((e) => e.score.score === bestScore);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      const sorted = [...winners].sort((a, b) => this.distanceFromButton(a.idx) - this.distanceFromButton(b.idx));
      const winnerRecords: HoldemHandResult['perPot'][number]['winners'] = [];
      for (const w of sorted) {
        const seat = this.state.seats[w.idx]!;
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        seat.stack += amt;
        winnerRecords.push({
          seatIndex: w.idx,
          playerId: seat.playerId,
          share: amt,
          handLabel: w.score.label,
        });
      }
      perPot.push({ amount: pot.amount, winners: winnerRecords });

      // Persist the side pots back into state for the UI.
      const ps = new HoldemPotSchema();
      ps.amount = pot.amount;
      ps.cap = pot.cap;
      for (const i of pot.eligibleSeats) ps.eligibleSeats.push(i);
      this.state.pots.push(ps);
    }

    // Build the broadcast + record.
    const perSeat: HoldemHandResult['perSeat'] = [];
    const recordSeats: HoldemHandRecord['perSeat'] = [];
    for (const s of this.state.seats) {
      if (s.totalCommitted === 0 && s.phase !== 'showdown') continue;
      const start = handStart.get(s.index) ?? 0;
      const delta = s.stack - start;
      const liveAtShowdown = s.phase === 'showdown';
      const hole = liveAtShowdown ? this.toCards(s.hole).map((c) => ({ rank: c.rank, suit: c.suit })) : undefined;
      perSeat.push({
        seatIndex: s.index,
        playerId: s.playerId,
        delta,
        hole,
        handLabel: s.handLabel || undefined,
      });
      s.handsPlayed += 1;
      if (delta > 0) s.handsWon += 1;
      s.netProfit = s.stack - s.buyIn;
      recordSeats.push({
        seatIndex: s.index,
        name: s.displayName,
        hole,
        contributed: s.totalCommitted,
        delta,
        folded: s.phase === 'folded' || (!liveAtShowdown && s.totalCommitted > 0 && s.phase !== 'allIn'),
        handLabel: s.handLabel || undefined,
      });
    }

    const result: HoldemHandResult = {
      round: this.state.round,
      community: community.map((c) => ({ rank: c.rank, suit: c.suit })),
      perPot,
      perSeat,
    };
    this.broadcast(S2C.holdemHandResult, result);
    const rec: HoldemHandRecord = {
      round: this.state.round,
      endedAt: Date.now(),
      community: community.map((c) => ({ rank: c.rank, suit: c.suit })),
      perSeat: recordSeats,
      pots: perPot.map((p) => ({ amount: p.amount, winners: p.winners.map((w) => w.seatIndex) })),
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    };
    this.handLog.unshift(rec);
    if (this.handLog.length > HAND_HISTORY) this.handLog.length = HAND_HISTORY;
    this.broadcast(S2C.holdemHandHistory, this.handLog);
  }

  private awardUncontested(winner: HoldemSeatSchema | undefined) {
    // Sum every committed chip and hand it to the last live seat.
    let pot = 0;
    for (const s of this.state.seats) {
      pot += s.totalCommitted;
    }
    const handStart = new Map<number, number>();
    for (const s of this.state.seats) handStart.set(s.index, s.stack + s.totalCommitted);
    if (winner) {
      winner.stack += pot;
      winner.handsWon += 1;
      winner.handsPlayed += 1;
      winner.netProfit = winner.stack - winner.buyIn;
    }
    const perSeat: HoldemHandResult['perSeat'] = [];
    const recordSeats: HoldemHandRecord['perSeat'] = [];
    for (const s of this.state.seats) {
      if (s.totalCommitted === 0) continue;
      const delta = s.stack - (handStart.get(s.index) ?? 0);
      perSeat.push({ seatIndex: s.index, playerId: s.playerId, delta });
      if (s.phase !== 'inHand' && s.phase !== 'allIn' && s.totalCommitted > 0) s.handsPlayed += 1;
      recordSeats.push({
        seatIndex: s.index,
        name: s.displayName,
        contributed: s.totalCommitted,
        delta,
        folded: s.index !== winner?.index,
      });
    }
    const result: HoldemHandResult = {
      round: this.state.round,
      community: this.toCards(this.state.community).map((c) => ({ rank: c.rank, suit: c.suit })),
      perPot: winner
        ? [{ amount: pot, winners: [{ seatIndex: winner.index, playerId: winner.playerId, share: pot }] }]
        : [],
      perSeat,
    };
    this.broadcast(S2C.holdemHandResult, result);
    const rec: HoldemHandRecord = {
      round: this.state.round,
      endedAt: Date.now(),
      community: result.community,
      perSeat: recordSeats,
      pots: winner ? [{ amount: pot, winners: [winner.index] }] : [],
      seed: this.currentSeed,
      commitHash: this.state.commitHash,
    };
    this.handLog.unshift(rec);
    if (this.handLog.length > HAND_HISTORY) this.handLog.length = HAND_HISTORY;
    this.broadcast(S2C.holdemHandHistory, this.handLog);

    this.state.phase = 'showdown';
    this.state.phaseClockMs = HOLDEM_SHOWDOWN_MS;
    this.state.revealedSeed = this.currentSeed;
    for (const s of this.state.seats) s.isTurn = false;
  }

  // -------- seat utilities --------

  private nextLive(from: number): number {
    return this.nextLiveFrom(from, 'inHand');
  }

  // Find next seat whose phase matches `target`, walking clockwise from `from`.
  private nextLiveFrom(from: number, target: HoldemSeatSchema['phase']): number {
    for (let step = 1; step <= HOLDEM_MAX_SEATS; step++) {
      const i = (from + step) % HOLDEM_MAX_SEATS;
      const s = this.state.seats[i];
      if (s && s.phase === target) return i;
    }
    return -1;
  }

  // Find the next seat that's in any of the listed phases (used to rotate the
  // button between hands — `inHand` seats only).
  private nextSeatInState(from: number, target: HoldemSeatSchema['phase']): number {
    const next = this.nextLiveFrom(from, target);
    if (next >= 0) return next;
    // Fallback: any non-empty seat (covers the first hand of the room).
    for (let step = 1; step <= HOLDEM_MAX_SEATS; step++) {
      const i = (from + step) % HOLDEM_MAX_SEATS;
      const s = this.state.seats[i];
      if (s && s.phase !== 'empty') return i;
    }
    return -1;
  }

  private distanceFromButton(seatIndex: number): number {
    const btn = this.state.buttonSeat;
    return (seatIndex - btn + HOLDEM_MAX_SEATS) % HOLDEM_MAX_SEATS;
  }

  // Live seats ordered clockwise from button + 1.
  private seatsInHandOrdered(): HoldemSeatSchema[] {
    const out: HoldemSeatSchema[] = [];
    const btn = this.state.buttonSeat;
    for (let step = 1; step <= HOLDEM_MAX_SEATS; step++) {
      const i = (btn + step) % HOLDEM_MAX_SEATS;
      const s = this.state.seats[i];
      if (s && s.phase === 'inHand') out.push(s);
    }
    return out;
  }

  private releaseSeat(seat: HoldemSeatSchema) {
    seat.playerId = '';
    seat.identityId = '';
    seat.displayName = 'Open seat';
    seat.stack = 0;
    seat.buyIn = 0;
    seat.committed = 0;
    seat.totalCommitted = 0;
    seat.hole.clear();
    seat.handLabel = '';
    seat.isTurn = false;
    seat.turnClockMs = 0;
    seat.connected = true;
    seat.graceMs = 0;
    seat.sittingOut = false;
    seat.phase = 'empty';
    this.pushLobbyStatus();
  }

  private pushCard(arr: ArraySchema<HoldemCardSchema>, c: Card) {
    const cs = new HoldemCardSchema();
    cs.rank = c.rank;
    cs.suit = c.suit;
    arr.push(cs);
  }

  private toCards(arr: ArraySchema<HoldemCardSchema>): Card[] {
    return arr.map((c) => ({ rank: c.rank as Card['rank'], suit: c.suit as Card['suit'] }));
  }

  // -------- tick --------

  private onTick() {
    if (this.state.phaseClockMs > 0) {
      this.state.phaseClockMs = Math.max(0, this.state.phaseClockMs - TICK_MS);
    }
    if (this.actingSeat >= 0) {
      const seat = this.state.seats[this.actingSeat];
      if (seat && seat.isTurn && seat.turnClockMs > 0) {
        seat.turnClockMs = Math.max(0, seat.turnClockMs - TICK_MS);
        if (seat.turnClockMs === 0) {
          // Auto-fold (or check if no bet to face).
          if (seat.committed === this.state.currentBet) {
            this.actedThisStreet[seat.index] = true;
            this.advanceTurn();
          } else {
            seat.phase = 'folded';
            seat.isTurn = false;
            this.actedThisStreet[seat.index] = true;
            this.advanceTurn();
          }
        }
      }
    }

    switch (this.state.phase) {
      case 'waiting':
        if (this.seatedReady().length >= 2) this.maybeStartHand();
        break;
      case 'between':
        if (this.state.phaseClockMs <= 0) this.startHand();
        break;
      case 'flop':
      case 'turn':
      case 'river':
      case 'preflop': {
        // If betting ended on an all-in-against-one situation we skip the
        // street with a brief pause — the phaseClockMs drives the wait.
        if (this.actingSeat < 0 && this.state.phaseClockMs <= 0) {
          this.closeStreet();
        }
        break;
      }
      case 'showdown':
        if (this.state.phaseClockMs <= 0) {
          this.state.phase = 'between';
          this.state.phaseClockMs = HOLDEM_BETWEEN_MS;
          this.actingSeat = -1;
        }
        break;
      case 'paused':
        break;
    }

    this.pushLobbyStatus();
  }

  private pushLobbyStatus() {
    const seatsTaken = this.state.seats.filter((s) => s.phase !== 'empty').length;
    publishStatus({
      tableId: this.state.tableId,
      seatsTaken,
      maxSeats: HOLDEM_MAX_SEATS,
      inHand:
        this.state.phase !== 'waiting' &&
        this.state.phase !== 'between' &&
        this.state.phase !== 'paused',
      heat: 0,
      heatState: 'cruising',
    });
  }
}
