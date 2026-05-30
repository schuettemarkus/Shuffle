// Phase 1 in-memory wallet. Persists per identity (cookie/localStorage ID
// the client passes on join) for the life of the server process. Phase 3
// replaces this with Postgres + Prisma.

import { STARTING_BALANCE } from '@shuffle/shared';

interface Wallet {
  identityId: string;
  balance: number;
  displayName: string;
}

const wallets = new Map<string, Wallet>();

export function getOrCreateWallet(identityId: string, displayName: string): Wallet {
  let w = wallets.get(identityId);
  if (!w) {
    w = { identityId, balance: STARTING_BALANCE, displayName };
    wallets.set(identityId, w);
  } else if (displayName && w.displayName !== displayName) {
    w.displayName = displayName;
  }
  return w;
}

export function debit(identityId: string, amount: number): boolean {
  const w = wallets.get(identityId);
  if (!w) return false;
  if (amount < 0 || w.balance < amount) return false;
  w.balance -= amount;
  return true;
}

export function credit(identityId: string, amount: number): void {
  const w = wallets.get(identityId);
  if (!w || amount <= 0) return;
  w.balance += amount;
}

export function balanceOf(identityId: string): number {
  return wallets.get(identityId)?.balance ?? 0;
}

export function nameOf(identityId: string): string {
  return wallets.get(identityId)?.displayName ?? 'Guest';
}
