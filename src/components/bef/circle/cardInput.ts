/**
 * What is typed or scanned into "Add a card" → the card's Nostr hex id, in this
 * browser only. Ported from bef-explorer src/lib/cardKey.ts, with the reading
 * rules of its src/lib/lanaWif.ts classifyKeyInput and decodeWif, and the key
 * itself read the way MejmoSefajn's login reads it (../../../lib/crypto.ts
 * convertWifToIds: T, 6, A and 3 give the same id).
 *
 * Either the card's private key (WIF): read here only to take its public id.
 * It is not kept, not sent and signs nothing; only the hex id goes on the
 * person's list. A JavaScript string cannot be wiped, so nothing here claims to
 * wipe it — the field that held it is emptied before it is read (CardAddBox).
 *
 * Or the person's Nostr hex id itself, typed by hand: 64 hex characters that
 * must be a real public key. The same 64 characters may just as well be a
 * private key, so the public key they would open is worked out too (`derived`):
 * the person's own private key is refused here, before anything is asked, and
 * ./cardChecks.ts asks BEF about `derived` before the typed text is ever sent.
 *
 * Pure: scripts/testBefCircle.ts runs it against BEF's own readCardInput.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { convertWifToIds } from '../../../lib/crypto';
import { isNostrPublicKey } from '../../../lib/bef/vendor/server/lib/cardListEvent.ts';
import type { BefCircleTextKey } from '../../../i18n/modules/befCircle';

/** Why the text is not a card this page can use (BEF KeyProblem, CardIdError and the private-key refusal). */
export type CardInputProblem =
  | 'empty'
  | 'address'
  | 'npub'
  | 'nsec'
  | 'notAKey'
  | 'checksum'
  | 'wrongNetwork'
  /** 64 hex characters that are no public key — a typo, most likely. */
  | 'badId'
  /** 64 hex characters that are the signed-in person's own private key. */
  | 'ownPrivateKey';

export class CardInputError extends Error {
  constructor(readonly reason: CardInputProblem) {
    super(reason);
    this.name = 'CardInputError';
  }
}

/** The words for each reason — BEF's own (src/components/person/problems.ts cardKeyProblem) where it has them. */
export const CARD_INPUT_TEXT: Record<CardInputProblem, BefCircleTextKey> = {
  empty: 'person.err.empty',
  address: 'person.err.address',
  npub: 'cards.err.npub',
  nsec: 'person.err.nsec',
  notAKey: 'person.err.notAKey',
  checksum: 'person.err.checksum',
  wrongNetwork: 'person.err.wrongNetwork',
  badId: 'cards.err.badId',
  ownPrivateKey: 'circle.ownPrivateKey',
};

export const cardInputProblem = (err: unknown): BefCircleTextKey =>
  err instanceof CardInputError ? CARD_INPUT_TEXT[err.reason] : 'person.err.notAKey';

/** A card worked out from the text. `byId`: typed as its hex id. `derived`: for
 * a typed id, the public key the same 64 characters open as a private key
 * (null when they are not a valid private key). */
export interface CardCandidate {
  hex: string;
  byId: boolean;
  derived: string | null;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
const LANA_WIF_VERSIONS = [0xb0, 0x41];
const LANA_ADDRESS_VERSION = 0x30;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** What a scan or a PDF paste drags along: every JS whitespace (NBSP and BOM
 * included) and the zero-width joiners (BEF lanaWif.ts STRIPPABLE). */
const STRIPPABLE = /\s|\u200b|\u200c|\u200d/g;
/** A leading URI scheme such as "lanacoin:" — base58 has no ":". */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:(\/\/)?/;

export function normalizeCardInput(raw: string): string {
  if (!raw) return '';
  return raw.replace(STRIPPABLE, '').replace(URI_SCHEME, '');
}

/** Base58 without throwing: a mistyped character is an answer, not a crash. */
function base58Bytes(text: string): Uint8Array | null {
  let num = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    num = num * 58n + BigInt(digit);
  }
  let hex = num === 0n ? '' : num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let zeros = 0;
  for (const ch of text) {
    if (ch !== '1') break;
    zeros++;
  }
  const out = new Uint8Array(zeros + hex.length / 2);
  out.set(hexToBytes(hex), zeros);
  return out;
}

const checksumMatches = (bytes: Uint8Array): boolean => {
  const expected = sha256(sha256(bytes.subarray(0, bytes.length - 4)));
  for (let i = 0; i < 4; i++) if (bytes[bytes.length - 4 + i] !== expected[i]) return false;
  return true;
};

/** The x-only public key 64 hex characters open as a private key, or null when
 * they are not one (zero, or not below the group order). */
export function publicKeyOfHex(hex: string): string | null {
  try {
    return bytesToHex(schnorr.getPublicKey(hexToBytes(hex.toLowerCase())));
  } catch {
    return null;
  }
}

/**
 * A card from what was typed or scanned. Throws CardInputError with the reason
 * the text is not one; never includes the text in what it throws.
 *   selfHex  the signed-in person — their own private key is refused as such.
 */
export async function readCardInput(input: string, selfHex: string): Promise<CardCandidate> {
  const text = normalizeCardInput(input);
  if (!text) throw new CardInputError('empty');
  const lower = text.toLowerCase();
  if (lower.startsWith('npub1')) throw new CardInputError('npub');
  if (lower.startsWith('nsec1')) throw new CardInputError('nsec');

  if (HEX64.test(text)) {
    const derived = publicKeyOfHex(lower);
    // Said before the id is even looked at: whether or not these 64 characters
    // also happen to be a valid id, they are the person's own key.
    if (derived !== null && derived === selfHex) throw new CardInputError('ownPrivateKey');
    if (!isNostrPublicKey(lower)) throw new CardInputError('badId');
    return { hex: lower, byId: true, derived };
  }

  // BEF's order: an address is named for what it is; the length and the
  // compression flag decide whether it can be a key at all; then the checksum
  // (a typo) is settled before the version (another network).
  const bytes = base58Bytes(text);
  if (!bytes) throw new CardInputError('notAKey');
  if (bytes.length === 25 && bytes[0] === LANA_ADDRESS_VERSION && checksumMatches(bytes)) throw new CardInputError('address');
  const shaped = bytes.length === 37 || (bytes.length === 38 && bytes[33] === 0x01);
  if (!shaped) throw new CardInputError('notAKey');
  if (!checksumMatches(bytes)) throw new CardInputError('checksum');
  if (!LANA_WIF_VERSIONS.includes(bytes[0])) throw new CardInputError('wrongNetwork');
  // A private key must lie in [1, n-1] (BEF lanaWif.ts inKeyRange).
  if (publicKeyOfHex(bytesToHex(bytes.subarray(1, 33))) === null) throw new CardInputError('notAKey');

  let ids: Awaited<ReturnType<typeof convertWifToIds>>;
  try {
    ids = await convertWifToIds(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    throw new CardInputError(/checksum/i.test(message) ? 'checksum' : /prefix/i.test(message) ? 'wrongNetwork' : 'notAKey');
  }
  return { hex: ids.nostrHexId, byId: false, derived: null };
}
