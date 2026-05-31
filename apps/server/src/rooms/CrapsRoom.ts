// Authoritative Craps room.
//
// Owns the dice, the shooter rotation, the betting window, and the payouts.
// Clients submit bet placements + roll requests; the server validates every
// one. Every roll uses a commit-reveal seed (commit pre-roll, reveal after)
// so a tampered client cannot influence the outcome.

import { Room, Client } from '@colyseus/core';
import { nanoid } from 'nanoid';
import {
  C2S,
  CHAT_HISTORY,
  CRAPS_BETWEEN_MS,
  CRAPS_TURN_CLOCK_MS,
  RECONNECT_GRACE_MS,
  S2C,
  type BetKind,
  type ChatMessage,
  type CrapsAction,
  type Emote,
  type RollResult,
} from '@shuffle/shared';
import { CrapsState, CrapsBetSchema, CrapsSeatSchema, DiceRollSchema } from '../craps/schema.js';
import {
  buildRoll,
  isComeOutOnlyBet,
  isPointPhaseBet,
  newDiceSeed,
  resolveBet,
} from '../craps/engine.js';
import * as wallet from '../wallet.js';
import { publishStatus } from '../lobbyRegistry.js';
import { chatBus, getChatHistory, postChat, type ChatEvent } from '../chatBus.js';

const MAX_SEATS = 8;
const TICK_MS = 100;
const DEFAULT_BUY_IN = 1000;

interface JoinOptions {
  identityId: string;
  displayName: string;
  buyIn?: number;
  lobbyId?: string;
}

export class CrapsRoom extends Room<CrapsState> {
  override maxClients = 32;

  private tick?: NodeJS.Timeout;
  private currentSeed = '';
  private nextRollNumber = 1;
  private lobbyId = 'default';
  private onChat = (e: ChatEvent) => {
    if (e.lobbyId !== this.lobbyId) return;
    this.broadcast(S2C.chat, e.msg);
  };

  override onCreate(options?: { lobbyId?: string }) {
    this.setState(new CrapsState());
    const lobbyId = options?.lobbyId || 'default';
    this.lobbyId = lobbyId;
    this.state.tableId = `${lobbyId}:craps`;
    this.state.name = 'Craps';
    for (let i = 0; i < MAX_SEATS; i++) {
      const seat = new CrapsSeatSchema();
      seat.index = i;
      this.state.seats.push(seat);
    }
    this.setPatchRate(50);
    this.commitNextRoll();

    this.onMessage(C2S.action, (client, payload: CrapsAction) => {
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
      postChat(this.lobbyId, msg);
    });

    chatBus.on('message', this.onChat);
    this.tick = setInterval(() => this.onTick(), TICK_MS);
    this.state.phase = 'between';
    this.state.phaseClockMs = CRAPS_BETWEEN_MS;
    this.pushLobbyStatus();
  }

  private commitNextRoll() {
    const { seed, commitHash } = newDiceSeed();
    this.currentSeed = seed;
    this.state.commitHash = commitHash;
    this.state.revealedSeed = '';
  }

  override async onJoin(client: Client, options: JoinOptions) {
    const identityId = options?.identityId ?? client.sessionId;
    const displayName = (options?.displayName ?? 'Guest').slice(0, 24);
    wallet.getOrCreateWallet(identityId, displayName);
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
    if (this.tick) clearInterval(this.tick);
    chatBus.off('message', this.onChat);
  }

  // ---------- actions ----------

  private handleAction(client: Client, action: CrapsAction) {
    switch (action.type) {
      case 'sit': return this.actSit(client, action.seatIndex, action.buyIn ?? DEFAULT_BUY_IN);
      case 'leave': return this.actLeave(client);
      case 'placeBet': return this.actPlaceBet(client, action.kind, action.amount);
      case 'removeBet': return this.actRemoveBet(client, action.betId);
      case 'roll': return this.actRoll(client);
      case 'passShooter': return this.actPassShooter(client);
      case 'reaction':
      case 'tossChip':
        return;
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
    if (!seat || seat.playerId) {
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
    seat.buyIn = actualBuyIn;
    seat.connected = true;
    seat.graceMs = 0;
    seat.isShooter = false;
    seat.handsRolled = 0;
    seat.netProfit = 0;
    seat.longestRoll = 0;
    // First player to sit becomes the shooter.
    if (this.state.shooterSeat === -1) {
      this.state.shooterSeat = seat.index;
      seat.isShooter = true;
    }
    this.pushLobbyStatus();
  }

  private actLeave(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    this.releaseSeat(seat);
  }

  private actPlaceBet(client: Client, kind: BetKind, amount: number) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    if (this.state.phase !== 'between' && this.state.phase !== 'comeOut' && this.state.phase !== 'point') {
      return this.sendToast(client, 'error', 'Betting is closed.');
    }
    const clamped = Math.floor(amount);
    if (!Number.isFinite(clamped) || clamped < this.state.minBet) {
      return this.sendToast(client, 'error', `Min bet is ${this.state.minBet}.`);
    }
    if (clamped > this.state.maxBet) {
      return this.sendToast(client, 'error', `Max bet is ${this.state.maxBet}.`);
    }
    if (seat.stack < clamped) {
      return this.sendToast(client, 'error', 'Not enough chips.');
    }
    // Pass/Don't Pass are only legal on the come-out roll (and between hands).
    if (isComeOutOnlyBet(kind) && this.state.point !== 0) {
      return this.sendToast(client, 'error', 'Line bets close once a point is set.');
    }
    // Come/Don't Come are only legal once a point is set.
    if (isPointPhaseBet(kind) && this.state.point === 0) {
      return this.sendToast(client, 'error', 'Come bets open once a point is set.');
    }
    // Limit a player to one of each canonical line bet at a time (helps the UI
    // feel clean). Players can stack place bets / hardways / props.
    if (
      (kind === 'pass' || kind === 'dontPass' || kind === 'come' || kind === 'dontCome') &&
      this.state.bets.some((b) => b.seatIndex === seat.index && b.kind === kind)
    ) {
      // Stack onto the existing bet instead of creating a duplicate.
      const existing = this.state.bets.find((b) => b.seatIndex === seat.index && b.kind === kind);
      if (existing) {
        seat.stack -= clamped;
        existing.amount += clamped;
        return;
      }
    }
    seat.stack -= clamped;
    const bet = new CrapsBetSchema();
    bet.id = nanoid(10);
    bet.seatIndex = seat.index;
    bet.kind = kind;
    bet.amount = clamped;
    bet.point = 0;
    this.state.bets.push(bet);
  }

  private actRemoveBet(client: Client, betId: string) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    const idx = this.state.bets.findIndex((b) => b.id === betId && b.seatIndex === seat.index);
    if (idx < 0) return;
    const bet = this.state.bets[idx]!;
    // Contract bets that are "working" can't be pulled. For Phase 4 we keep
    // it permissive: only pass/don't-pass with an established point are
    // locked. Place bets, hardways, props can all be pulled.
    if ((bet.kind === 'pass' || bet.kind === 'dontPass') && this.state.point !== 0) {
      return this.sendToast(client, 'error', "Line bets lock once a point is set.");
    }
    if ((bet.kind === 'come' || bet.kind === 'dontCome') && bet.point !== 0) {
      return this.sendToast(client, 'error', "Come bets lock once they travel.");
    }
    seat.stack += bet.amount;
    this.state.bets.splice(idx, 1);
  }

  private actRoll(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    if (seat.index !== this.state.shooterSeat) {
      return this.sendToast(client, 'error', "Only the shooter rolls.");
    }
    // First-roll convenience: if we're in `between` between hands, let the
    // shooter kick off a come-out immediately instead of waiting for the
    // between-window timer. Otherwise we silently swallow their click while
    // the table sits idle.
    if (this.state.phase === 'between') {
      this.state.phase = 'comeOut';
      this.state.phaseClockMs = CRAPS_TURN_CLOCK_MS;
    }
    if (this.state.phase !== 'comeOut' && this.state.phase !== 'point') {
      return this.sendToast(client, 'error', 'Wait for the dealer to call bets.');
    }
    this.rollDice();
  }

  private actPassShooter(client: Client) {
    const seat = this.findSeatBySession(client.sessionId);
    if (!seat) return;
    if (seat.index !== this.state.shooterSeat) return;
    if (this.state.point !== 0) {
      return this.sendToast(client, 'error', 'Finish your hand before passing the dice.');
    }
    this.advanceShooter();
  }

  // ---------- core mechanics ----------

  private rollDice() {
    const seed = this.currentSeed;
    const commit = this.state.commitHash;
    const rollNumber = this.nextRollNumber;
    const roll = buildRoll(seed, commit, rollNumber);
    this.nextRollNumber += 1;
    this.state.rollsThisShooter += 1;

    // Resolve every live bet against the roll.
    const perSeatDelta = new Map<number, number>();
    const resolved: RollResult['resolved'] = [];
    const removeIds: string[] = [];
    for (const bet of this.state.bets) {
      const seat = this.state.seats[bet.seatIndex];
      if (!seat) continue;
      const resolution = resolveBet({
        total: roll.total,
        a: roll.a,
        b: roll.b,
        point: this.state.point,
        bet: {
          kind: bet.kind as BetKind,
          amount: bet.amount,
          point: bet.point === 0 ? null : bet.point,
        },
      });
      if (resolution.fate === 'win') {
        const ret = Math.floor(bet.amount * resolution.mult);
        const delta = ret - bet.amount;
        seat.stack += ret;
        perSeatDelta.set(bet.seatIndex, (perSeatDelta.get(bet.seatIndex) ?? 0) + delta);
        resolved.push({
          betId: bet.id,
          seatIndex: bet.seatIndex,
          kind: bet.kind as BetKind,
          amount: bet.amount,
          delta,
          fate: 'win',
        });
        removeIds.push(bet.id);
      } else if (resolution.fate === 'lose') {
        perSeatDelta.set(
          bet.seatIndex,
          (perSeatDelta.get(bet.seatIndex) ?? 0) - bet.amount,
        );
        resolved.push({
          betId: bet.id,
          seatIndex: bet.seatIndex,
          kind: bet.kind as BetKind,
          amount: bet.amount,
          delta: -bet.amount,
          fate: 'lose',
        });
        removeIds.push(bet.id);
      } else if (resolution.fate === 'travel') {
        bet.point = resolution.to;
        resolved.push({
          betId: bet.id,
          seatIndex: bet.seatIndex,
          kind: bet.kind as BetKind,
          amount: bet.amount,
          delta: 0,
          fate: 'travel',
        });
      } else {
        // push — leave the bet alone.
      }
    }
    // Sweep losers / winners. (Win pays already moved chips back into the
    // seat's stack; the bet itself is just cleaned up from the felt here.)
    if (removeIds.length > 0) {
      for (let i = this.state.bets.length - 1; i >= 0; i--) {
        if (removeIds.includes(this.state.bets[i]!.id)) {
          this.state.bets.splice(i, 1);
        }
      }
    }

    // Update the shooter's public stats.
    const shooter = this.state.seats[this.state.shooterSeat];
    if (shooter) {
      // Each roll counts as 1 in the hands-rolled tally (the closest analog
      // to a "hand" in craps). The longest non-seven streak is tracked as
      // longestRoll.
      shooter.handsRolled += 1;
      if (roll.total === 7 && this.state.point !== 0) {
        shooter.longestRoll = Math.max(shooter.longestRoll, this.state.rollsThisShooter - 1);
      }
      shooter.netProfit = shooter.stack - shooter.buyIn;
    }
    for (const [seatIndex, delta] of perSeatDelta) {
      const s = this.state.seats[seatIndex];
      if (!s) continue;
      s.netProfit = s.stack - s.buyIn;
      void delta;
    }

    // Phase transitions driven by the roll.
    let sevenOut = false;
    let pointMade = false;
    if (this.state.point === 0) {
      // Come-out.
      if (roll.total === 4 || roll.total === 5 || roll.total === 6 ||
          roll.total === 8 || roll.total === 9 || roll.total === 10) {
        this.state.point = roll.total;
        this.state.phase = 'point';
      } else {
        // Naturals / craps resolve the line bets but the shooter keeps the
        // dice and rolls again.
        this.state.phase = 'comeOut';
      }
    } else {
      if (roll.total === 7) {
        sevenOut = true;
        this.state.point = 0;
        // Shooter sevens-out — rotate.
        this.advanceShooter();
        this.state.phase = 'between';
      } else if (roll.total === this.state.point) {
        pointMade = true;
        this.state.point = 0;
        // Shooter keeps the dice with a fresh come-out.
        this.state.phase = 'comeOut';
      }
    }
    this.state.phaseClockMs = this.state.phase === 'between' ? CRAPS_BETWEEN_MS : CRAPS_TURN_CLOCK_MS;

    // Mirror onto schema + broadcast.
    this.state.lastRoll.a = roll.a;
    this.state.lastRoll.b = roll.b;
    this.state.lastRoll.total = roll.total;
    this.state.lastRoll.isHard = roll.isHard;
    this.state.lastRoll.isCraps = roll.isCraps;
    this.state.lastRoll.isNatural = roll.isNatural;
    this.state.lastRoll.commitHash = commit;
    this.state.lastRoll.seed = seed;
    this.state.lastRoll.rollNumber = rollNumber;
    this.state.lastRoll.ts = Date.now();
    this.state.revealedSeed = seed;

    const perSeat: RollResult['perSeat'] = Array.from(perSeatDelta.entries()).map(
      ([seatIndex, delta]) => ({ seatIndex, delta }),
    );
    const result: RollResult = {
      rollNumber,
      roll: { ...roll, commitHash: commit, seed, rollNumber },
      perSeat,
      resolved,
      sevenOut,
      pointMade,
    };
    this.broadcast(S2C.rollResult, result);
    this.broadcast(S2C.diceReveal, { roll: result.roll, seed, commitHash: commit });

    // Commit next seed.
    this.commitNextRoll();
    this.pushLobbyStatus();
  }

  private advanceShooter() {
    const occupied = this.state.seats.filter((s) => s.playerId);
    if (occupied.length === 0) {
      this.state.shooterSeat = -1;
      this.state.phase = 'between';
      return;
    }
    const startFrom = this.state.shooterSeat;
    // Clear old shooter flag.
    for (const s of this.state.seats) s.isShooter = false;
    // Find the next non-empty seat clockwise.
    let next = -1;
    for (let step = 1; step <= MAX_SEATS; step++) {
      const candidate = ((startFrom < 0 ? -1 : startFrom) + step + MAX_SEATS) % MAX_SEATS;
      const cand = this.state.seats[candidate];
      if (cand && cand.playerId) {
        next = candidate;
        break;
      }
    }
    if (next === -1) next = occupied[0]!.index;
    this.state.shooterSeat = next;
    const shooter = this.state.seats[next];
    if (shooter) shooter.isShooter = true;
    this.state.rollsThisShooter = 0;
    this.state.phase = 'between';
    this.state.phaseClockMs = CRAPS_BETWEEN_MS;
  }

  private releaseSeat(seat: CrapsSeatSchema) {
    // Cash out: refund stack + any live wagers.
    const wagered = this.state.bets
      .filter((b) => b.seatIndex === seat.index)
      .reduce((sum, b) => sum + b.amount, 0);
    const total = seat.stack + wagered;
    if (seat.identityId && total > 0) wallet.credit(seat.identityId, total);
    // Remove their bets from the felt.
    for (let i = this.state.bets.length - 1; i >= 0; i--) {
      if (this.state.bets[i]!.seatIndex === seat.index) {
        this.state.bets.splice(i, 1);
      }
    }
    const wasShooter = seat.isShooter;
    seat.playerId = '';
    seat.identityId = '';
    seat.displayName = '';
    seat.stack = 0;
    seat.buyIn = 0;
    seat.isShooter = false;
    seat.handsRolled = 0;
    seat.netProfit = 0;
    seat.longestRoll = 0;
    if (wasShooter) {
      this.state.point = 0;
      this.advanceShooter();
    }
    this.pushLobbyStatus();
  }

  // ---------- helpers ----------

  private findSeatBySession(sessionId: string): CrapsSeatSchema | undefined {
    return this.state.seats.find((s) => s.playerId === sessionId);
  }

  private findSeatByIdentity(identityId: string): CrapsSeatSchema | undefined {
    return this.state.seats.find((s) => s.identityId === identityId);
  }

  private onTick() {
    for (const s of this.state.seats) {
      if (!s.connected && s.graceMs > 0) {
        s.graceMs = Math.max(0, s.graceMs - TICK_MS);
      }
    }
    if (this.state.phaseClockMs > 0) {
      this.state.phaseClockMs = Math.max(0, this.state.phaseClockMs - TICK_MS);
    }
    if (this.state.phase === 'between') {
      // After the between window, kick over to the come-out (if there's a
      // shooter) so the table doesn't stall.
      if (this.state.phaseClockMs <= 0 && this.state.shooterSeat >= 0) {
        this.state.phase = 'comeOut';
        this.state.phaseClockMs = CRAPS_TURN_CLOCK_MS;
      }
    } else if (this.state.phase === 'comeOut' || this.state.phase === 'point') {
      // Auto-roll if the shooter takes too long — keeps the table moving.
      if (this.state.phaseClockMs <= 0 && this.state.shooterSeat >= 0) {
        this.rollDice();
      }
    }
  }

  private pushLobbyStatus() {
    const seatsTaken = this.state.seats.filter((s) => !!s.playerId).length;
    const inHand = this.state.phase === 'comeOut' || this.state.phase === 'point';
    const occupancy = seatsTaken / MAX_SEATS;
    const heat = Math.round(occupancy * 60 + (inHand ? 25 : 0));
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

  private sendToast(client: Client, kind: string, text: string) {
    client.send('toast', { kind, text });
  }
}

// Silences "DiceRollSchema" import dead-code lint — the schema is registered
// through the state and not referenced directly here.
void DiceRollSchema;
