/**
 * Every event the BEF module sends is built and signed here, in this browser,
 * with the key the person is already logged in to MejmoSefajn with. Only
 * signed events travel; no key is typed, sent or stored for BEF.
 *
 *   sign-in       kind 27235 → POST /api/person/session
 *   registration  kind 27235 (register URL) + kind 27235 Registrar consent
 *                 + (when the key has no profile) the KIND 0 profile → POST /api/person/register
 *   interest      KIND 30970 built by vendor server/lib/interestEvent.ts → POST /api/interest
 *   cards         KIND 30971 built by vendor server/lib/cardListEvent.ts → POST /api/cards
 *
 * Ported from bef-explorer src/lib/personSignIn.ts. The events are the same
 * byte for byte in shape; the key comes from MejmoSefajn's session (read the
 * way ../crypto.ts reads every WIF form: T, 6, A and 3) and is signed with
 * nostr-tools, as everywhere else in this app.
 *
 * Pure: `base` is passed in, so scripts/testBef.ts checks these events against
 * BEF's own server checks.
 */
import { finalizeEvent, type VerifiedEvent } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils.js';
import { convertWifToIds, generateCompressedPublicKey } from '../crypto';
import { BefApiError, type BefChallenge, type BefClient, type BefSession } from './api';
import { buildInterestTemplate, type InterestDraft } from './vendor/server/lib/interestEvent.ts';
import { buildCardListTemplate } from './vendor/server/lib/cardListEvent.ts';
import { buildProfileContent, type ProfileInput } from './vendor/server/lib/personProfile.ts';

export const AUTH_KIND = 27235;
export const REGISTRAR_ACTION = 'fn:register-virgin-wallets';

/** The person's signing key, as the BEF events need it. */
export interface BefKey {
  /** x-only public key — the person's identity. */
  hex: string;
  privateKeyHex: string;
  /** 33-byte compressed public key, hex (02/03…). Its x is `hex`. */
  publicKey: string;
  /** The LANA address of the WIF form the person logged in with. */
  address: string;
}

/** The parts of MejmoSefajn's session the key is read from. */
export interface BefSessionKeys {
  lanaPrivateKey?: string;
  nostrHexId: string;
  walletId?: string;
  walletIdCompressed?: string;
  walletIdUncompressed?: string;
}

export class BefKeyError extends Error {
  constructor(readonly code: 'key_unreadable') {
    super(code);
  }
}

/**
 * The key from MejmoSefajn's session, re-read from the WIF itself and checked
 * against what the session says it is. The session's stored nostrPrivateKey is
 * never used: the WIF is what the person logged in with, and a session whose
 * parts disagree signs nothing.
 */
export async function befKeyFromSession(session: BefSessionKeys): Promise<BefKey> {
  if (!session?.lanaPrivateKey) throw new BefKeyError('key_unreadable');
  let ids: Awaited<ReturnType<typeof convertWifToIds>>;
  try {
    ids = await convertWifToIds(session.lanaPrivateKey);
  } catch {
    throw new BefKeyError('key_unreadable');
  }
  if (ids.nostrHexId !== session.nostrHexId) throw new BefKeyError('key_unreadable');
  const wallets = [session.walletId, session.walletIdCompressed, session.walletIdUncompressed].filter(Boolean);
  if (!wallets.includes(ids.walletId)) throw new BefKeyError('key_unreadable');
  return {
    hex: ids.nostrHexId,
    privateKeyHex: ids.nostrPrivateKey,
    publicKey: generateCompressedPublicKey(ids.nostrPrivateKey),
    address: ids.walletId,
  };
}

const sign = (key: BefKey, template: { kind: number; created_at: number; tags: string[][]; content: string }): VerifiedEvent =>
  finalizeEvent(template, hexToBytes(key.privateKeyHex));

/**
 * The sign-in (or registration) event: bound to BEF's endpoint, to a challenge
 * BEF issued, and to a moment — so a captured one opens nothing else. It
 * carries the public key and the address of the wallet form, so BEF asks the
 * Registrar about exactly that wallet. It is signed only for BEF's own URL,
 * whatever a challenge answer names.
 */
export function signLogin(
  key: BefKey,
  base: string,
  url: string,
  challenge: string,
  createdAt: number,
  endpoint: 'session' | 'register' = 'session',
): VerifiedEvent {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new BefApiError('bad_challenge_url', 0);
  }
  if (target.origin !== new URL(base).origin || target.pathname !== `/api/person/${endpoint}` || target.search || target.hash) {
    throw new BefApiError('bad_challenge_url', 0);
  }
  return sign(key, {
    kind: AUTH_KIND,
    created_at: createdAt,
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['challenge', challenge],
      ['key', key.publicKey],
      ['address', key.address],
    ],
    content: '',
  });
}

/** The person's own request to the Lana Registrar to register their wallet —
 * the event LanaTrace.us accepts; BEF Explorer only forwards it. */
export function signRegistrarRequest(key: BefKey, createdAt: number): VerifiedEvent {
  return sign(key, { kind: AUTH_KIND, created_at: createdAt, tags: [['action', REGISTRAR_ACTION]], content: '' });
}

/** What the registration card collects; the wallet comes from BEF's answer. */
export type ProfileFields = Omit<ProfileInput, 'wallet'>;

/** The KIND 0 exactly as vendor server/lib/personProfile.ts builds it — the
 * code BEF checks it with. `wallet` is the address as BEF named it. */
export function signProfile(key: BefKey, fields: ProfileFields, wallet: string, lang: string, createdAt: number): VerifiedEvent {
  const content = JSON.stringify(buildProfileContent({ ...fields, wallet }));
  return sign(key, { kind: 0, created_at: createdAt, tags: [['lang', lang]], content });
}

/** The KIND 30970 exactly as vendor server/lib/interestEvent.ts defines it. */
export function signInterest(key: BefKey, draft: InterestDraft, createdAt: number): VerifiedEvent {
  return sign(key, buildInterestTemplate(draft, createdAt));
}

/** The person's KIND 30971 list of cards exactly as vendor server/lib/cardListEvent.ts defines it. */
export function signCardList(key: BefKey, cards: readonly string[], createdAt: number): VerifiedEvent {
  return sign(key, buildCardListTemplate(cards, createdAt));
}

/** A replaceable event must be newer than the one it replaces: a change right
 * after a send, within the same second, still gets a later created_at. */
export const nextCreatedAt = (serverNow: number, previous?: number | null): number =>
  previous != null && Number.isFinite(previous) ? Math.max(serverNow, previous + 1) : serverNow;

/** The challenge's server time (seconds), moved on by the time spent since. */
export function signingTime(challenge: Pick<BefChallenge, 'serverTime'>, receivedAtMs: number, now: number = Date.now()): number {
  const serverSeconds = challenge.serverTime > 1e11 ? Math.floor(challenge.serverTime / 1000) : Math.floor(challenge.serverTime);
  return serverSeconds + Math.max(0, Math.floor((now - receivedAtMs) / 1000));
}

/**
 * Sign against a fresh challenge and hand the result to `exchange`. One quiet
 * retry: a challenge is lost when BEF restarts between handing it out and
 * receiving the signature (a deploy), and the person did nothing wrong. Never
 * more — a sign-in that timed out may still have opened a session.
 */
async function withChallenge(
  client: Pick<BefClient, 'person'>,
  key: BefKey,
  exchange: (challenge: BefChallenge, createdAt: number) => Promise<BefSession>,
): Promise<BefSession> {
  for (let attempt = 0; ; attempt++) {
    const challenge = await client.person.challenge();
    const createdAt = signingTime(challenge, Date.now());
    try {
      const session = await exchange(challenge, createdAt);
      if (session.hex !== key.hex) throw new BefKeyError('key_unreadable');
      return session;
    } catch (err) {
      if (err instanceof BefApiError && err.code === 'bad_challenge' && attempt === 0) continue;
      throw err;
    }
  }
}

export function signIn(client: Pick<BefClient, 'base' | 'person'>, key: BefKey): Promise<BefSession> {
  return withChallenge(client, key, (challenge, createdAt) =>
    client.person.session(signLogin(key, client.base, challenge.sessionUrl, challenge.challenge, createdAt)),
  );
}

/**
 * Register the wallet with the Lana Registrar (through BEF) and, when the key
 * has no profile yet, publish the person's profile; then a session opens. The
 * Registrar comes FIRST — BEF enforces the order. `address` is the wallet as
 * BEF named it; the profile names the same form. `profile` is null when the key
 * already has one: an existing profile is never replaced from here.
 */
export function register(
  client: Pick<BefClient, 'base' | 'person'>,
  key: BefKey,
  options: { address: string; profile: ProfileFields | null; lang: string },
): Promise<BefSession> {
  return withChallenge(client, key, (challenge, createdAt) => {
    const event = signLogin(key, client.base, challenge.registerUrl, challenge.challenge, createdAt, 'register');
    const registrarAuth = signRegistrarRequest(key, createdAt);
    const body: { event: VerifiedEvent; registrarAuth: VerifiedEvent; profile?: VerifiedEvent } = { event, registrarAuth };
    if (options.profile) body.profile = signProfile(key, options.profile, options.address, options.lang, createdAt);
    return client.person.register(body);
  });
}
