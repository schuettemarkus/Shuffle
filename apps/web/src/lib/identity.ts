// A stable per-browser identity ID — the Phase-1 substitute for guest accounts.
// Stored in localStorage so a tab refresh reattaches to the same wallet/seat.

const KEY = 'shuffle:identity-v1';
const NAME_KEY = 'shuffle:display-name';

export function getIdentityId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function setDisplayName(name: string) {
  localStorage.setItem(NAME_KEY, name.slice(0, 24));
}
