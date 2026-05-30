// A stable per-browser identity ID — the Phase-1 substitute for guest accounts.
// Stored in localStorage so a tab refresh reattaches to the same wallet/seat.

const KEY = 'shuffle:identity-v1';
const NAME_KEY = 'shuffle:display-name';

export function getIdentityId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// `crypto.randomUUID` is only defined on secure contexts (HTTPS + localhost).
// On a LAN IP like http://192.168.68.57 it's undefined, which crashed the app
// on phones. Fall back to a v4-shaped string built from getRandomValues, then
// to Math.random as a last resort.
function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function setDisplayName(name: string) {
  localStorage.setItem(NAME_KEY, name.slice(0, 24));
}
