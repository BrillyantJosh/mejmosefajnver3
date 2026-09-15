/**
 * The BEF Explorer session token this browser holds for the logged-in person.
 *
 * One record, under its own key: { hex, token, expiresAtMs }. It is only ever
 * handed back for the person it was opened for — a record for another hex (the
 * account changed) or past its expiry is removed on the first read. Nothing
 * else about the person is kept: the name and wallet come from BEF on /me.
 *
 * No key is kept here. The BEF module signs with the key MejmoSefajn's own
 * session already holds; BEF's key pad is never asked for across origins.
 *
 * Every read and write is guarded: where storage is blocked, the session lasts
 * as long as the page.
 */
import type { BefClient } from './api';

export const BEF_TOKEN_KEY = 'mejmo_bef_person_v1';

export interface BefTokenRecord {
  hex: string;
  token: string;
  /** On this device's clock (./api.ts localExpiryMs). */
  expiresAtMs: number;
}

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): TokenStorage | null {
  try {
    // Reading the global itself throws where storage is blocked.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored text as a record, or null when it is not one. */
export function parseBefToken(raw: string | null): BefTokenRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BefTokenRecord>;
    if (
      typeof value?.hex === 'string' &&
      /^[0-9a-f]{64}$/.test(value.hex) &&
      typeof value.token === 'string' &&
      /^[A-Za-z0-9_-]{16,256}$/.test(value.token) &&
      typeof value.expiresAtMs === 'number' &&
      Number.isFinite(value.expiresAtMs)
    ) {
      return { hex: value.hex, token: value.token, expiresAtMs: value.expiresAtMs };
    }
  } catch {
    // Unreadable: treated as nothing stored.
  }
  return null;
}

/** Whatever record is stored, for whoever — for signing out. */
export function peekBefToken(storage: TokenStorage | null = browserStorage()): BefTokenRecord | null {
  try {
    return parseBefToken(storage?.getItem(BEF_TOKEN_KEY) ?? null);
  } catch {
    return null;
  }
}

/** The stored session of `hex`, while it lasts. Anyone else's, an expired one,
 * or an unreadable one is removed. */
export function readBefToken(hex: string, { storage = browserStorage(), now = Date.now() }: { storage?: TokenStorage | null; now?: number } = {}): BefTokenRecord | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(BEF_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw == null) return null;
  const record = parseBefToken(raw);
  if (record && record.hex === hex && record.expiresAtMs > now) return record;
  clearBefToken(storage);
  return null;
}

export function storeBefToken(record: BefTokenRecord, storage: TokenStorage | null = browserStorage()): void {
  try {
    storage?.setItem(BEF_TOKEN_KEY, JSON.stringify({ hex: record.hex, token: record.token, expiresAtMs: record.expiresAtMs }));
  } catch {
    // Storage blocked: the session lasts as long as this page.
  }
}

export function clearBefToken(storage: TokenStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(BEF_TOKEN_KEY);
  } catch {
    // Nothing was kept.
  }
}

/**
 * Logging out of MejmoSefajn ends the BEF session too: the token is removed
 * here, and BEF is told to end it (best effort, sent even as the page goes).
 * Removing the token is what counts; a BEF that does not answer lets the
 * session run out on its own.
 */
export function forgetBefPerson(client: Pick<BefClient, 'person'>, storage: TokenStorage | null = browserStorage()): void {
  const record = peekBefToken(storage);
  clearBefToken(storage);
  if (!record) return;
  void client.person.logout(record.token, { keepalive: true }).catch(() => undefined);
}
