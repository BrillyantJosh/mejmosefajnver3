/**
 * The BEF module's foundation: what it copied from BEF Explorer, what it
 * signs, whom it calls, what it keeps, and how every refusal is said.
 *   npx tsx scripts/testBef.ts
 *   BEF_EXPLORER_DIR=/path/to/bef-explorer npx tsx scripts/testBef.ts
 *   npx tsx scripts/testBef.ts --without-bef   (on purpose, with no bef-explorer)
 *
 * Where bef-explorer is at hand (next to this repo, or BEF_EXPLORER_DIR), the
 * events are also run through BEF's OWN server checks — the sign-in, the
 * Registrar consent, the profile, the interest and the card list — and the
 * copies, texts, route list and host list are compared with BEF's. Without it
 * those parts say "skipped", the rest still runs, and the run fails unless
 * --without-bef was given: a green run has compared this build with BEF.
 *
 * Nothing here touches a network, a relay or the Registrar: fetch is faked.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';
import { convertWifToIds } from '../src/lib/crypto.js';
import { BEF_DEV_URL, BEF_PUBLIC_URL, BEF_ROUTES, isBefRoute, resolveBefBase } from '../src/lib/bef/base.js';
import { BefApiError, createBefClient, localExpiryMs, type BefChallenge, type BefSession } from '../src/lib/bef/api.js';
import {
  BefKeyError,
  befKeyFromSession,
  nextCreatedAt,
  register,
  REGISTRAR_ACTION,
  signCardList,
  signIn,
  signingTime,
  signInterest,
  signLogin,
  signProfile,
  signRegistrarRequest,
  type BefKey,
} from '../src/lib/bef/signing.js';
import { BEF_TOKEN_KEY, forgetBefPerson, parseBefToken, readBefToken, storeBefToken } from '../src/lib/bef/personToken.js';
import {
  CARD_PROBLEMS,
  DOOR_PROBLEMS,
  doorProblem,
  GENERIC_CODES,
  INTEREST_PROBLEMS,
  MAPPED_CODES,
  offersBef,
  REGISTRATION_PROBLEMS,
  registrationProblem,
  SCENARIO_PROBLEMS,
} from '../src/lib/bef/problems.js';
import { parseWholeAmount, prefillQuery, readPrefill } from '../src/lib/bef/prefill.js';
import { SUPPORTED_LANGS } from '../src/i18n/types.js';
import befTranslations from '../src/i18n/modules/bef.js';
import { befCircleTranslations } from '../src/i18n/modules/befCircle.js';
import befExplorerTranslations from '../src/i18n/modules/befExplorer.js';
import { befInterestTranslations } from '../src/i18n/modules/befInterest.js';
import befVendorTranslations from '../src/i18n/modules/befVendor.js';
import befVendorHu from '../src/i18n/modules/befVendorHu.js';
import { BEF_COMMIT_FILE, befCommit, befDir, generateBefVendor, ROOT, VENDOR_DICT, VENDOR_DIR, VENDORED_FILES } from './syncBef.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)?.slice(0, 300)}`);
  if (!cond) failures++;
};
// A part skipped for want of bef-explorer compared nothing with BEF, so a run
// with one fails — unless --without-bef says that is what was meant.
const WITHOUT_BEF = process.argv.includes('--without-bef');
let skips = 0;
const skipped = (what: string) => {
  skips++;
  console.log(`  – ${what} skipped (bef-explorer not found; set BEF_EXPLORER_DIR${WITHOUT_BEF ? '' : ', or pass --without-bef'})`);
};

const BEF = befDir();
const HAVE_BEF = existsSync(path.join(BEF, 'server/lib/crossOrigin.ts'));
const bef = async <T = any>(rel: string): Promise<T> => import(pathToFileURL(path.join(BEF, rel)).href);
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

async function throws(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err ?? new Error('thrown');
  }
}

/* ── throwaway keys, in all four WIF forms ─────────────────────────────── */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256d = (bytes: Buffer) => createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();
function base58(bytes: Buffer): string {
  let num = BigInt('0x' + (bytes.toString('hex') || '0'));
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}
/** 0xB0 compressed = T…, 0xB0 uncompressed = 6…, 0x41 compressed = A…, 0x41 uncompressed = 3…. */
function wif(privateKeyHex: string, version: 0xb0 | 0x41, compressed: boolean): string {
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(privateKeyHex, 'hex'), compressed ? Buffer.from([1]) : Buffer.alloc(0)]);
  return base58(Buffer.concat([payload, sha256d(payload).subarray(0, 4)]));
}
const FORMS = [
  { name: 'T', version: 0xb0, compressed: true },
  { name: '6', version: 0xb0, compressed: false },
  { name: 'A', version: 0x41, compressed: true },
  { name: '3', version: 0x41, compressed: false },
] as const;

/** A MejmoSefajn session exactly as AuthContext.login builds it from a WIF. */
async function sessionFor(wifText: string) {
  const ids = await convertWifToIds(wifText);
  return {
    lanaPrivateKey: ids.lanaPrivateKey,
    walletId: ids.walletId,
    walletIdCompressed: ids.walletIdCompressed,
    walletIdUncompressed: ids.walletIdUncompressed,
    nostrHexId: ids.nostrHexId,
    nostrPrivateKey: ids.nostrPrivateKey,
  };
}

/** A small in-memory Storage. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

async function main() {
  const PRIVATE_KEYS = ['1f2e3d4c5b6a79880123456789abcdeffedcba98765432100f1e2d3c4b5a6978', randomBytes(32).toString('hex')];

  /* ─────────────────────────────────────────────────────────────── drift ── */
  console.log('— the copies are BEF Explorer’s, byte for byte —');
  const commitLine = existsSync(BEF_COMMIT_FILE) ? readFileSync(BEF_COMMIT_FILE, 'utf8').trim() : '';
  check('BEF_COMMIT names a commit', /^[0-9a-f]{40}(\+uncommitted)?$/.test(commitLine), commitLine);
  for (const rel of VENDORED_FILES) {
    const copy = path.join(VENDOR_DIR, rel);
    check(`vendor ${rel} exists`, existsSync(copy));
    if (!existsSync(copy)) continue;
    // Every relative import of a copy resolves inside the vendor folder.
    for (const m of readFileSync(copy, 'utf8').matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
      check(`  its import ${m[1]} is copied too`, existsSync(path.resolve(path.dirname(copy), m[1])), m[1]);
    }
  }
  if (HAVE_BEF) {
    const { sha, clean } = befCommit(BEF);
    for (const rel of VENDORED_FILES) {
      const same = existsSync(path.join(VENDOR_DIR, rel)) && readFileSync(path.join(VENDOR_DIR, rel)).equals(readFileSync(path.join(BEF, rel)));
      check(`${rel} equals bef-explorer's`, same);
      check(`${rel} in bef-explorer carries the "copied" line`, readFileSync(path.join(BEF, rel), 'utf8').startsWith('// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor'));
    }
    check('BEF_COMMIT is bef-explorer HEAD', commitLine.startsWith(sha), { commitLine, sha });
    if (commitLine.endsWith('+uncommitted')) {
      console.log(`  ! copied from uncommitted bef-explorer work — run scripts/syncBef.ts again once it is committed`);
      check('an "+uncommitted" copy is only kept while bef-explorer really has uncommitted work', !clean);
    }
    const fresh = await generateBefVendor(BEF, commitLine);
    check('befVendor.ts is exactly what syncBef.ts generates now', readFileSync(VENDOR_DICT, 'utf8') === fresh.source, { keys: fresh.keys });
    const { CROSS_ORIGIN_ROUTES } = await bef('server/lib/crossOrigin.ts');
    check('BEF_ROUTES equals BEF CROSS_ORIGIN_ROUTES, in order', JSON.stringify(BEF_ROUTES) === JSON.stringify(CROSS_ORIGIN_ROUTES), CROSS_ORIGIN_ROUTES);
  } else {
    skipped('drift check');
  }

  /* ───────────────────────────────────────────────────────────── signing ── */
  console.log('— the key comes from the MejmoSefajn session, in every WIF form —');
  const auth = HAVE_BEF ? await bef('server/lib/personAuth.ts') : null;
  const lanaAddress = HAVE_BEF ? await bef('server/lib/lanaAddress.ts') : null;
  const profileGate = HAVE_BEF ? await bef('server/lib/profileGate.ts') : null;
  const befCountries = HAVE_BEF ? await bef('server/lib/countries.ts') : null;
  const relayClient = HAVE_BEF ? await bef('server/lib/relayClient.ts') : null;
  const befInterest = HAVE_BEF ? await bef('server/lib/interestEvent.ts') : null;
  const befCards = HAVE_BEF ? await bef('server/lib/cardListEvent.ts') : null;
  const base = BEF_PUBLIC_URL;
  const now = Math.floor(Date.now() / 1000);
  let sampleKey: BefKey | null = null;

  for (const privateKeyHex of PRIVATE_KEYS) {
    for (const form of FORMS) {
      const text = wif(privateKeyHex, form.version, form.compressed);
      const label = `${form.name}-form`;
      check(`${label} WIF starts with ${form.name}`, text.startsWith(form.name), text[0]);
      const session = await sessionFor(text);
      const key = await befKeyFromSession(session);
      sampleKey ??= key;
      check(`${label}: hex is the session's`, key.hex === session.nostrHexId);
      check(`${label}: address is the form's own`, key.address === (form.compressed ? session.walletIdCompressed : session.walletIdUncompressed));
      check(`${label}: key is 02/03 and names the hex`, /^0[23][0-9a-f]{64}$/.test(key.publicKey) && key.publicKey.slice(2) === key.hex, key.publicKey);

      const challenge = randomBytes(24).toString('hex');
      const login = signLogin(key, base, `${base}/api/person/session`, challenge, now);
      check(`${label}: login event verifies (nostr-tools)`, verifyEvent(login));
      check(`${label}: login is kind 27235 with empty content`, login.kind === 27235 && login.content === '');
      check(`${label}: tags u, method, challenge, key, address in that order`, login.tags.map((t) => t[0]).join() === 'u,method,challenge,key,address', login.tags);
      check(`${label}: signed by the hex`, login.pubkey === key.hex);

      if (auth && lanaAddress) {
        const store = new auth.ChallengeStore();
        const issued = store.issue();
        const real = signLogin(key, base, `${base}/api/person/session`, issued, now);
        const verdict = auth.verifyLoginEvent(real, `${base}/api/person/session`, store, now);
        check(`${label}: BEF verifyLoginEvent accepts it`, verdict.ok === true && verdict.hex === key.hex, verdict);
        const both = lanaAddress.addressesForSigner(real.tags[3][1], key.hex);
        check(`${label}: BEF addressesForSigner finds the address tag`, !!both && [both.compressed, both.uncompressed].includes(real.tags[4][1]), both);

        const consent = signRegistrarRequest(key, now);
        check(`${label}: Registrar consent passes BEF verifyRegistrarAuth`, auth.verifyRegistrarAuth(consent, key.hex, now) === true);
        check(`${label}: consent has exactly one tag ["action","${REGISTRAR_ACTION}"]`, JSON.stringify(consent.tags) === JSON.stringify([['action', REGISTRAR_ACTION]]));
      }
    }
  }

  console.log('— a session whose parts disagree signs nothing —');
  {
    const good = await sessionFor(wif(PRIVATE_KEYS[0], 0xb0, true));
    const other = await sessionFor(wif(PRIVATE_KEYS[1], 0xb0, true));
    const unreadable = (err: unknown) => err instanceof BefKeyError && err.code === 'key_unreadable';
    check('no lanaPrivateKey', unreadable(await throws(() => befKeyFromSession({ ...good, lanaPrivateKey: undefined }))));
    check('an unreadable WIF', unreadable(await throws(() => befKeyFromSession({ ...good, lanaPrivateKey: 'not-a-wif' }))));
    check('hex of another key', unreadable(await throws(() => befKeyFromSession({ ...good, nostrHexId: other.nostrHexId }))));
    check('wallet of another key', unreadable(await throws(() => befKeyFromSession({ ...good, walletId: other.walletId, walletIdCompressed: other.walletIdCompressed, walletIdUncompressed: other.walletIdUncompressed }))));
    // The stored nostrPrivateKey is never what signs.
    const key = await befKeyFromSession({ ...good, nostrPrivateKey: other.nostrPrivateKey } as typeof good);
    check('a wrong stored nostrPrivateKey is not used', key.hex === good.nostrHexId && key.privateKeyHex !== other.nostrPrivateKey);
  }

  console.log('— the sign-in event is signed only for BEF’s own endpoint —');
  {
    const key = sampleKey!;
    const refused = (url: string, endpoint?: 'session' | 'register') => {
      try {
        signLogin(key, base, url, 'ab'.repeat(24), now, endpoint);
        return false;
      } catch (err) {
        return err instanceof BefApiError && err.code === 'bad_challenge_url';
      }
    };
    check('another origin', refused('https://evil.example/api/person/session'));
    check('a look-alike host', refused('https://befexplorer.com.evil.example/api/person/session'));
    check('http instead of https', refused('http://befexplorer.com/api/person/session'));
    check('another path', refused(`${base}/api/person/me`));
    check('the register URL for a sign-in', refused(`${base}/api/person/register`));
    check('the session URL for a registration', refused(`${base}/api/person/session`, 'register'));
    check('a query string', refused(`${base}/api/person/session?x=1`));
    check('the register URL for a registration is fine', !refused(`${base}/api/person/register`, 'register'));
    check('nextCreatedAt: later than now keeps now', nextCreatedAt(1000, 500) === 1000);
    check('nextCreatedAt: same second moves one on', nextCreatedAt(1000, 1000) === 1001);
    check('nextCreatedAt: a previous one ahead of the clock', nextCreatedAt(1000, 1005) === 1006);
    check('nextCreatedAt: nothing before', nextCreatedAt(1000) === 1000 && nextCreatedAt(1000, null) === 1000);
    check('signingTime moves the server time on', signingTime({ serverTime: 5000 }, 10_000, 13_500) === 5003);
    check('signingTime reads milliseconds too', signingTime({ serverTime: 5_000_000_000_000 }, 0, 0) === 5_000_000_000);
  }

  console.log('— sign-in and registration flows, against BEF’s own checks —');
  if (auth && profileGate && befCountries) {
    const key = sampleKey!;
    const store = new auth.ChallengeStore();
    const person = { hex: key.hex, name: 'Test Person', displayName: 'Test Person', country: 'SI', wallet: key.address };
    const sessionAnswer = (hex = key.hex): BefSession => ({ token: 'a'.repeat(64), hex, expiresAt: Date.now() + 8 * 3600_000, serverTime: now, person: { ...person, hex } });
    let challenges = 0;
    const challenge = async (): Promise<BefChallenge> => {
      challenges++;
      return { challenge: store.issue(), sessionUrl: `${base}/api/person/session`, registerUrl: `${base}/api/person/register`, serverTime: now };
    };

    let sessionBodies = 0;
    let loseFirst = true;
    const signInClient = {
      base,
      person: {
        challenge,
        session: async (event: any) => {
          sessionBodies++;
          const verdict = auth.verifyLoginEvent(event, `${base}/api/person/session`, store, now);
          // A BEF restarted between challenge and signature: the first one is gone.
          if (loseFirst) {
            loseFirst = false;
            throw new BefApiError('bad_challenge', 401, { error: 'bad_challenge' });
          }
          if (!verdict.ok) throw new BefApiError(verdict.error, 401, { error: verdict.error });
          return sessionAnswer();
        },
      },
    } as any;
    const opened = await signIn(signInClient, key);
    check('signIn: a lost challenge is retried once, then BEF accepts', opened.hex === key.hex && challenges === 2 && sessionBodies === 2, { challenges, sessionBodies });

    let tries = 0;
    const alwaysLost = { base, person: { challenge, session: async () => { tries++; throw new BefApiError('bad_challenge', 401); } } } as any;
    const lost = await throws(() => signIn(alwaysLost, key));
    check('signIn: never more than one retry', lost instanceof BefApiError && tries === 2, { tries });

    const otherHex = { base, person: { challenge, session: async () => sessionAnswer('f'.repeat(64)) } } as any;
    check('signIn: a session for another hex is refused', (await throws(() => signIn(otherHex, key))) instanceof BefKeyError);

    const timedOut = { base, person: { challenge, session: async () => { throw new BefApiError('timeout', 0); } } } as any;
    const before = challenges;
    await throws(() => signIn(timedOut, key));
    check('signIn: a timeout is not retried (it may have opened a session)', challenges === before + 1);

    const bodies: any[] = [];
    const registerClient = {
      base,
      person: {
        challenge,
        register: async (body: any) => {
          bodies.push(body);
          const verdict = auth.verifyLoginEvent(body.event, `${base}/api/person/register`, store, now);
          if (!verdict.ok) throw new BefApiError(verdict.error, 401);
          if (!auth.verifyRegistrarAuth(body.registrarAuth, verdict.hex, now)) throw new BefApiError('consent_invalid', 400);
          if (body.profile) {
            const checked = profileGate.validateSubmittedProfile(body.profile, verdict.hex, key.address, befCountries.isCountryCode, now);
            if (!checked.ok) throw new BefApiError('profile_invalid', 400, { field: checked.field });
          }
          return sessionAnswer();
        },
      },
    } as any;
    const fields = { firstName: '  Ana ', surname: 'Novak', country: 'SI', email: 'ana@example.com', phoneCountryCode: '+386', phone: '041 123 456' };
    const err1 = await throws(() => register(registerClient, key, { address: key.address, profile: fields, lang: 'sl' }));
    check('register with profile: BEF accepts login, consent and KIND 0', err1 === null, err1);
    check('register with profile: the body has all three', !!bodies[0]?.event && !!bodies[0]?.registrarAuth && !!bodies[0]?.profile);
    const content = JSON.parse(bodies[0]?.profile?.content ?? '{}');
    check('profile: exactly BEF’s content (name cleaned, trunk 0 dropped, wallet named)', content.name === 'Ana Novak' && content.phone === '41123456' && content.lanaWalletID === key.address && content.currency === 'EUR' && content.about === 'BEF Explorer co-creator', content);
    check('profile: the only tag is ["lang","sl"]', JSON.stringify(bodies[0]?.profile?.tags) === JSON.stringify([['lang', 'sl']]));
    const err2 = await throws(() => register(registerClient, key, { address: key.address, profile: null, lang: 'hu' }));
    check('registerOnly: BEF accepts, and no profile is sent', err2 === null && bodies[1] && !('profile' in bodies[1]), err2);
    const hungarian = signProfile(key, fields, key.address, 'hu', now);
    check('a Hungarian profile passes BEF too', profileGate.validateSubmittedProfile(hungarian, key.hex, key.address, befCountries.isCountryCode, now).ok === true);
    const wrongWallet = profileGate.validateSubmittedProfile(signProfile(key, fields, key.address, 'en', now), key.hex, 'LOtherWalletAddressThatIsNotThisOne12', befCountries.isCountryCode, now);
    check('a profile naming another wallet form is refused by BEF', wrongWallet.ok === false && wrongWallet.field === 'wallet', wrongWallet);
  } else {
    skipped('BEF server checks of sign-in and registration');
  }

  console.log('— interest and card list are BEF’s canonical events —');
  if (befInterest && befCards && relayClient) {
    const key = sampleKey!;
    const draft = { split: 12, currency: 'EUR' as const, rounds: [{ round: 1, amount: 1000 }, { round: 3, amount: 250 }], status: 'active' as const, wallet: key.address, paramsEventId: 'c'.repeat(64) };
    const interest = signInterest(key, draft, now);
    check('KIND 30970 signature passes BEF checkEventSignature', relayClient.checkEventSignature(interest).ok === true);
    const parsed = befInterest.parseInterestEvent(interest);
    check('KIND 30970 parses back to the same draft', parsed.ok === true && JSON.stringify(parsed.draft) === JSON.stringify(draft), parsed);
    const cardHexes = ['d'.repeat(64), sampleKey!.hex === 'e'.repeat(64) ? 'f'.repeat(64) : 'e'.repeat(64)];
    const list = signCardList(key, cardHexes, now);
    check('KIND 30971 signature passes BEF checkEventSignature', relayClient.checkEventSignature(list).ok === true);
    const cards = befCards.parseCardListEvent(list);
    check('KIND 30971 parses back to the same cards', cards.ok === true && JSON.stringify(cards.cards) === JSON.stringify(cardHexes), cards);
  } else {
    skipped('BEF shape checks of interest and card list');
  }

  /* ────────────────────────────────────────────────────────────── config ── */
  console.log('— a production build talks only to befexplorer.com —');
  check('production base', resolveBefBase({ dev: false }) === 'https://befexplorer.com');
  check('dev base is the local harness', resolveBefBase({ dev: true }) === BEF_DEV_URL && BEF_DEV_URL === 'http://127.0.0.1:3127');
  {
    const config = read('src/lib/bef/config.ts');
    check('config.ts has no variable to point a build elsewhere', !/VITE_BEF|import\.meta\.env\.(?!DEV\b)/.test(config));
    const libFiles = readdirSync(path.join(ROOT, 'src/lib/bef')).filter((f) => f.endsWith('.ts') && f !== 'config.ts');
    const readsEnv = libFiles.filter((f) => /import\.meta\.env/.test(read(`src/lib/bef/${f}`)));
    check('only config.ts reads import.meta.env', readsEnv.length === 0, readsEnv);
  }

  /* ─────────────────────────────────────────────────────────── api client ── */
  console.log('— the API client asks BEF for listed routes only, without cookies —');
  {
    type Call = { url: string; init: RequestInit };
    const calls: Call[] = [];
    let respond: (call: Call) => Promise<Response> = async () => json({ ok: true });
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }) as unknown as typeof fetch;
    function json(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    let clock = 1_000_000;
    const client = createBefClient({ base: BEF_PUBLIC_URL, fetchImpl: fakeFetch, now: () => clock });
    const code = async (fn: () => Promise<unknown>) => {
      const err = await throws(fn);
      return err instanceof BefApiError ? err.code : err === null ? 'ok' : String(err);
    };

    for (const [p, m] of [['/api/admin/x', 'GET'], ['/api/person/me', 'POST'], ['/api/splits/1/payouts', 'GET'], ['/api/system-params', 'GET'], ['//evil.example/api/splits', 'GET'], ['https://evil.example/api/splits', 'GET'], ['/API/splits', 'GET'], ['/api/splits/', 'GET']] as const) {
      const before = calls.length;
      check(`refused before fetch: ${m} ${p}`, (await code(() => client.request(p, { method: m }))) === 'route_not_allowed' && calls.length === before);
    }
    for (const [m, p] of BEF_ROUTES) {
      const before = calls.length;
      await throws(() => client.request(p, { method: m, body: m === 'POST' ? {} : undefined }));
      check(`sent: ${m} ${p}`, calls.length === before + 1 && calls[calls.length - 1].url === `${BEF_PUBLIC_URL}${p}`);
    }
    check('POST /api/person/register is allowed (registration in the module)', isBefRoute('POST', '/api/person/register'));

    calls.length = 0;
    respond = async () => json({ interests: [] });
    await client.interest.mine('t'.repeat(64));
    const get = calls[0];
    const headers = get.init.headers as Record<string, string>;
    check('fetch options: cors, no credentials, no redirects, no referrer, no cache',
      get.init.mode === 'cors' && get.init.credentials === 'omit' && get.init.redirect === 'error' && get.init.referrerPolicy === 'no-referrer' && get.init.cache === 'no-store', get.init);
    check('a GET sends no content-type and no body', !('content-type' in headers) && get.init.body === undefined, headers);
    check('the token travels in x-person-token', headers['x-person-token'] === 't'.repeat(64));
    calls.length = 0;
    await client.interest.windows();
    check('no token, no x-person-token header', !('x-person-token' in (calls[0].init.headers as Record<string, string>)));
    calls.length = 0;
    await client.person.session({ kind: 27235 });
    check('a POST sends content-type application/json and the body', (calls[0].init.headers as Record<string, string>)['content-type'] === 'application/json' && calls[0].init.body === JSON.stringify({ event: { kind: 27235 } }));

    respond = async () => { throw new TypeError('Failed to fetch'); };
    check('no answer to a read: network', (await code(() => client.interest.windows())) === 'network');
    check('no answer to an interest: outcome_unknown', (await code(() => client.interest.submit('t'.repeat(64), {}))) === 'outcome_unknown');
    check('no answer to a card list: outcome_unknown', (await code(() => client.cards.publish('t'.repeat(64), {}, null))) === 'outcome_unknown');
    check('no answer to a registration: registration_outcome_unknown', (await code(() => client.person.register({ event: {}, registrarAuth: {} }))) === 'registration_outcome_unknown');
    check('no answer to a sign-in: network (it is never retried by itself)', (await code(() => client.person.session({}))) === 'network');

    respond = (call) => new Promise((_, reject) => call.init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    check('too slow: timeout', (await code(() => client.request('/api/splits', { timeoutMs: 20 }))) === 'timeout');
    check('too slow on a publish: outcome_unknown', (await code(() => client.request('/api/interest', { method: 'POST', timeoutMs: 20, unknownOutcome: 'outcome_unknown' }))) === 'outcome_unknown');

    respond = async () => new Response('Too many', { status: 429 });
    check('429: rate_limited', (await code(() => client.figures.splits())) === 'rate_limited');
    respond = async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    check('HTML where JSON was expected: network', (await code(() => client.figures.bootstrap())) === 'network');
    respond = async () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    check('an HTML 502 to a publish: outcome_unknown', (await code(() => client.interest.submit('t'.repeat(64), {}))) === 'outcome_unknown');
    respond = async () => json({ error: 'not_registered', address: 'Laddr', profile: 'found' }, 409);
    const refusal = await throws(() => client.person.session({}));
    check('a refusal keeps its code and body', refusal instanceof BefApiError && refusal.code === 'not_registered' && refusal.status === 409 && refusal.body.address === 'Laddr');
    respond = async () => json({ error: 'Not A Code!' }, 400);
    check('an error word that is not a code: http_400', (await code(() => client.figures.splits())) === 'http_400');
    respond = async () => json({ error: 'amount_above_limit', limit: 5000, limitLabel: 'round', currency: 'EUR', limits: [] }, 400);
    const above = await throws(() => client.figures.scenario({ amount: 9000, currency: 'EUR', round: 2 }));
    check('scenario: amount_above_limit is read from the JSON body', above instanceof BefApiError && above.code === 'amount_above_limit' && above.body.limit === 5000);
    respond = async () => new Response(null, { status: 204 });
    check('204: nothing to read', (await code(() => client.person.logout('t'.repeat(64)))) === 'ok');

    calls.length = 0;
    respond = async () => json({ companies: [] });
    await client.figures.scenario({ amount: 1000, currency: 'GBP', round: 3, split: 'next', sellerId: 7, treasuryId: null });
    await client.figures.companies('seller');
    check('scenario query as BEF builds it', calls[0].url === `${BEF_PUBLIC_URL}/api/scenario?amount=1000&currency=GBP&round=3&split=next&sellerId=7`, calls[0].url);
    check('companies role query', calls[1].url === `${BEF_PUBLIC_URL}/api/companies?role=seller`, calls[1].url);

    respond = async () => json({ token: 'x'.repeat(64), hex: 'a'.repeat(64), expiresAt: 5_000_000, serverTime: 2_000, person: { hex: 'a'.repeat(64), name: 'N', displayName: null, country: 'SI', email: 'e@x.org', phone: '41123456', phoneCountryCode: '+386', wallet: 'Lw' } });
    clock = 1_000_000;
    const session = await client.person.session({});
    check('e-mail and phone are dropped from the person', !('email' in session.person) && !('phone' in session.person) && !('phoneCountryCode' in session.person) && session.person.wallet === 'Lw', session.person);
    check('BEF’s clock is noted from serverTime', client.serverNowSeconds() === 2_000);
    clock += 5_000;
    check('and runs on with this device’s clock', client.serverNowSeconds() === 2_005);
    // BEF sends expiresAt in ms and serverTime in seconds; a device 3 hours off still gets the full 8 hours.
    check('localExpiryMs restates expiry on this device’s clock', localExpiryMs(1_700_000_000_000 + 28_800_000, 1_700_000_000, 1_700_010_800_000) === 1_700_010_800_000 + 28_800_000);
    check('localExpiryMs with seconds in both', localExpiryMs(3_600, 1, 10) === 10 + 3_599_000);
  }

  /* ─────────────────────────────────────────────────────────── token store ── */
  console.log('— the token is kept for one person only —');
  {
    const HEX_A = 'a'.repeat(64);
    const HEX_B = 'b'.repeat(64);
    const storage = memoryStorage();
    storeBefToken({ hex: HEX_A, token: 't'.repeat(64), expiresAtMs: 10_000 }, storage);
    check('stored under mejmo_bef_person_v1', storage.map.has(BEF_TOKEN_KEY) && BEF_TOKEN_KEY === 'mejmo_bef_person_v1');
    check('only hex, token and expiry are stored', JSON.stringify(Object.keys(JSON.parse(storage.map.get(BEF_TOKEN_KEY)!))) === '["hex","token","expiresAtMs"]');
    check('read back for the same person', readBefToken(HEX_A, { storage, now: 5_000 })?.token === 't'.repeat(64));
    check('another person gets nothing', readBefToken(HEX_B, { storage, now: 5_000 }) === null);
    check('…and the other person’s token is gone', !storage.map.has(BEF_TOKEN_KEY));
    storeBefToken({ hex: HEX_A, token: 't'.repeat(64), expiresAtMs: 10_000 }, storage);
    check('expired: nothing, and removed', readBefToken(HEX_A, { storage, now: 10_000 }) === null && !storage.map.has(BEF_TOKEN_KEY));
    storage.setItem(BEF_TOKEN_KEY, '{"hex":"nope"}');
    check('unreadable: nothing, and removed', readBefToken(HEX_A, { storage, now: 0 }) === null && !storage.map.has(BEF_TOKEN_KEY));
    check('parse refuses a token with odd characters', parseBefToken(JSON.stringify({ hex: HEX_A, token: 'bad token!', expiresAtMs: 1 })) === null);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    check('blocked storage reads as nothing, writes do not throw', readBefToken(HEX_A, { storage: blocked }) === null && (await throws(() => storeBefToken({ hex: HEX_A, token: 't'.repeat(64), expiresAtMs: 1 }, blocked))) === null);

    const logouts: Array<{ token: string; keepalive?: boolean }> = [];
    const fakeClient = { person: { logout: async (token: string, opts?: { keepalive?: boolean }) => void logouts.push({ token, keepalive: opts?.keepalive }) } } as any;
    storeBefToken({ hex: HEX_A, token: 'k'.repeat(64), expiresAtMs: Date.now() + 1000 }, storage);
    forgetBefPerson(fakeClient, storage);
    check('logging out removes the token', !storage.map.has(BEF_TOKEN_KEY));
    check('…and tells BEF, sent even as the page goes', logouts.length === 1 && logouts[0].token === 'k'.repeat(64) && logouts[0].keepalive === true, logouts);
    forgetBefPerson(fakeClient, storage);
    check('nothing stored: BEF is not called', logouts.length === 1);
    const failing = { person: { logout: async () => { throw new BefApiError('network', 0); } } } as any;
    storeBefToken({ hex: HEX_A, token: 'k'.repeat(64), expiresAtMs: Date.now() + 1000 }, storage);
    check('a BEF that does not answer changes nothing', (await throws(() => forgetBefPerson(failing, storage))) === null && !storage.map.has(BEF_TOKEN_KEY));
  }

  /* ─────────────────────────────────────────────────────────────── prefill ── */
  console.log('— the Explorer’s prefill is read as BEF reads it —');
  {
    const p = readPrefill(new URLSearchParams('split=12&currency=gbp&round=2&amount=5.000'));
    check('split, currency, round and a grouped amount', p.split === 12 && p.currency === 'GBP' && p.round === 2 && p.amount === 5000, p);
    const bad = readPrefill(new URLSearchParams('split=1.5&currency=JPY&round=4&amount=12,5'));
    check('a decimal split, JPY, round 4 and a decimal amount are left out', bad.split === null && bad.currency === null && bad.round === null && bad.amount === null, bad);
    check('BEF cuts ".00" off an amount', readPrefill(new URLSearchParams('amount=250.00')).amount === 250);
    check('a negative or zero amount is left out', readPrefill(new URLSearchParams('amount=-5')).amount === null && readPrefill(new URLSearchParams('amount=0')).amount === null);
    check('parseWholeAmount refuses decimals', Number.isNaN(parseWholeAmount('12,5')) && parseWholeAmount('') === null && parseWholeAmount("1'000") === 1000);
    check('prefillQuery: only set values, a whole amount', prefillQuery({ split: 12, currency: 'EUR', round: 1, amount: 99.9 }) === 'split=12&currency=EUR&round=1&amount=99' && prefillQuery({ currency: null }) === '');
  }

  /* ─────────────────────────────────────────────────────── refusal coverage ── */
  console.log('— every refusal BEF can answer has words —');
  {
    const texts = befTranslations.en as Record<string, string>;
    const vendor = befVendorTranslations.en as Record<string, string>;
    const tables = { DOOR_PROBLEMS, REGISTRATION_PROBLEMS, INTEREST_PROBLEMS, CARD_PROBLEMS, SCENARIO_PROBLEMS };
    for (const [name, table] of Object.entries(tables)) {
      const missing = Object.values(table).filter(([key]) => !(key in texts) && !(key in vendor)).map(([key]) => key);
      check(`${name}: every text exists`, missing.length === 0, missing);
    }
    for (const local of ['network', 'timeout', 'rate_limited', 'outcome_unknown', 'registration_outcome_unknown', 'key_unreadable', 'account_changed', 'route_not_allowed', 'bad_challenge_url']) {
      check(`local code ${local} has words`, MAPPED_CODES.has(local));
    }
    const shared = Object.keys(texts).filter((k) => k in vendor);
    check('bef.ts and befVendor.ts share no key', shared.length === 0, shared);
    const generic = doorProblem(new BefApiError('bad_signature', 401));
    check('an unforeseen code says "report it" with the code', generic.text === 'door.generic' && generic.vars?.code === 'bad_signature');
    check('registry_mismatch with an address: registered under the other form', registrationProblem(new BefApiError('registry_mismatch', 502, { address: 'L' })).text === 'person.reg.err.registered_other_form');
    check('registry_mismatch without one: not confirmed', registrationProblem(new BefApiError('registry_mismatch', 502)).text === 'person.reg.err.registry_error');
    check('a thrown bug is not an answer from BEF', doorProblem(new Error('boom')).code === 'network');
    // BEF answers cross_site without a CORS header, so no browser reads it: fetch
    // throws, and the page has `network`. Its words name both, with both ways out.
    check('cross_site has no words of its own (a browser never reads it)', !MAPPED_CODES.has('cross_site') && (GENERIC_CODES as readonly string[]).includes('cross_site'));
    const unreachable = doorProblem(new BefApiError('network', 0));
    check('no answer: door.unreachable, Try again and befexplorer.com', unreachable.text === 'door.unreachable' && unreachable.action === 'retry' && offersBef(unreachable) && /befexplorer\.com/.test(texts['door.unreachable']), unreachable);
    check('a timeout is only "could not be reached" (a refusal never waits)', doorProblem(new BefApiError('timeout', 0)).text === 'person.err.network' && !offersBef(doorProblem(new BefApiError('timeout', 0))));
    check('behind BEF: befexplorer.com, no Try again', offersBef(doorProblem(new BefApiError('bad_event', 400))) && doorProblem(new BefApiError('bad_event', 400)).action === 'openBef');

    if (HAVE_BEF) {
      const SOURCES = [
        'server/routes/person.ts',
        'server/routes/interest.ts',
        'server/routes/cards.ts',
        'server/routes/publicApi.ts',
        'server/lib/signInGate.ts',
        'server/lib/personAuth.ts',
        'server/lib/personStore.ts',
        'server/app.ts',
      ];
      const known = new Set<string>([...MAPPED_CODES, ...GENERIC_CODES]);
      const found = new Set<string>();
      for (const rel of SOURCES) {
        for (const line of readFileSync(path.join(BEF, rel), 'utf8').split('\n')) {
          const at = line.search(/\berror\s*:/);
          if (at < 0) continue;
          // The value after "error:", up to the first , } or ; outside a string.
          let expr = '';
          let quote = '';
          for (const ch of line.slice(at).replace(/^error\s*:\s*/, '')) {
            if (quote) {
              if (ch === quote) quote = '';
            } else if (ch === "'" || ch === '"') quote = ch;
            else if (ch === ',' || ch === '}' || ch === ';') break;
            expr += ch;
          }
          // `x === 'expired' ? 'session_expired' : …` — the compared word is not a code.
          expr = expr.replace(/[!=]==\s*'[^']*'/g, '');
          for (const m of expr.matchAll(/'([a-z][a-z0-9_]*)'/g)) found.add(m[1]);
        }
      }
      check('BEF’s routes answer codes (the scan found them)', found.size > 40, [...found]);
      const unmapped = [...found].filter((c) => !known.has(c));
      check('every code is in a problems table or GENERIC_CODES', unmapped.length === 0, unmapped);
    } else {
      skipped('scan of BEF’s refusal codes');
    }
  }

  /* ──────────────────────────────────────────────────────────── languages ── */
  console.log('— every BEF dictionary speaks every MejmoSefajn language, key for key —');
  {
    // TranslationDict only asks for English; a language a dictionary lists but
    // lacks a key in shows that key in English, and a key only a translation has
    // is never shown. Every language here is complete, with English's {names}.
    const dictionaries: Record<string, { en: Record<string, string> } & Partial<Record<string, Record<string, string>>>> = {
      'bef.ts': befTranslations,
      'befVendor.ts': befVendorTranslations,
      'befExplorer.ts': befExplorerTranslations,
      'befInterest.ts': befInterestTranslations,
      'befCircle.ts': befCircleTranslations,
    };
    // befText.ts only merges two of these; befVendorHu.ts is checked below.
    const unlisted = readdirSync(path.join(ROOT, 'src/i18n/modules')).filter((f) => /^bef\w*\.ts$/.test(f) && !(f in dictionaries) && f !== 'befText.ts' && f !== 'befVendorHu.ts');
    check('every bef*.ts dictionary is checked here', unlisted.length === 0, unlisted);
    const names =(text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [file, dict] of Object.entries(dictionaries)) {
      const keys = Object.keys(dict.en);
      for (const lang of SUPPORTED_LANGS) {
        if (lang === 'en') continue;
        const words = dict[lang] ?? {};
        const missing = keys.filter((key) => typeof words[key] !== 'string' || words[key].trim() === '');
        const extra = Object.keys(words).filter((key) => !(key in dict.en));
        check(`${file} ${lang}: every key, and no other`, missing.length === 0 && extra.length === 0, { missing, extra });
        const renamed = keys.filter((key) => typeof words[key] === 'string' && names(words[key]) !== names(dict.en[key]));
        check(`${file} ${lang}: the same {placeholders} as English`, renamed.length === 0, renamed.map((key) => `${key}: ${words[key]}`));
      }
    }

    // Hungarian is not in BEF: syncBef.ts merges it from befVendorHu.ts, and
    // fills a key missing there with English — which the check above cannot see.
    const vendorKeys = Object.keys(befVendorTranslations.en);
    const hu = befVendorHu as Record<string, string>;
    const untranslated = vendorKeys.filter((key) => typeof hu[key] !== 'string' || hu[key].trim() === '');
    const unused = Object.keys(hu).filter((key) => !(key in befVendorTranslations.en));
    check('befVendorHu.ts translates every key of befVendor.ts, and no other', untranslated.length === 0 && unused.length === 0, { untranslated, unused });
    const merged = befVendorTranslations.hu as Record<string, string> | undefined;
    check('befVendor.ts carries befVendorHu.ts word for word (run syncBef.ts after changing it)', !!merged && vendorKeys.every((key) => merged[key] === hu[key]), vendorKeys.filter((key) => merged?.[key] !== hu[key]));

    if (HAVE_BEF) {
      // The Explorer's copy of BEF's footer disclaimer is BEF's own words in each language BEF has.
      for (const lang of ['sl', 'de', 'it'] as const) {
        const befWords = (await bef<Record<string, Record<string, string>>>(`src/i18n/${lang}.ts`))[lang];
        const ours = befExplorerTranslations[lang] as Record<string, string>;
        check(`befExplorer.ts ${lang}: the disclaimer is BEF’s footer, word for word`, ours['explorer.disclaimer'] === befWords['footer.disclaimer'] && ours['explorer.disclaimerTitle'] === befWords['footer.disclaimerTitle']);
      }
    } else {
      skipped('comparison of the disclaimer with BEF’s footer');
    }
  }

  /* ─────────────────────────────────────────────────────────────── wiring ── */
  console.log('— the module is wired in —');
  {
    const types = read('src/types/modules.ts');
    check("'bef' is a ModuleType", /\|\s*'bef'/.test(types));
    const registry = read('src/contexts/ModulesContext.tsx');
    const body = registry.slice(registry.indexOf('const DEFAULT_MODULES'), registry.indexOf('\n];', registry.indexOf('const DEFAULT_MODULES')));
    const entry = body.split(/\n  \{/).find((block) => /id: 'bef'/.test(block)) ?? '';
    check('DEFAULT_MODULES has bef, enabled, at /bef', /path: '\/bef'/.test(entry) && /enabled: true/.test(entry), entry);
    check('its image is the BEF tile', /image: befModuleImage/.test(entry) && registry.includes("import befModuleImage from '@/assets/bef-module.webp'"));
    check("mapToNostrId and mapFromNostrId know it", registry.includes("'bef': 'BEF'") && registry.includes("'BEF': 'bef'"));

    const image = path.join(ROOT, 'src/assets/bef-module.webp');
    const bytes = existsSync(image) ? readFileSync(image) : Buffer.alloc(0);
    check('the tile is a WebP under 250 KB', bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' && statSync(image).size < 250_000, bytes.length);

    const app = read('src/App.tsx');
    const block = /<Route path="\/bef" element={<BefLayout \/>}>([\s\S]*?)<\/Route>/.exec(app)?.[1] ?? '';
    check('App.tsx: /bef with index Explorer, interest, circle, sell',
      /<Route index element={<BefExplorer \/>} \/>/.test(block) && /path="interest" element={<BefInterest \/>}/.test(block) && /path="circle" element={<BefCircle \/>}/.test(block) && /path="sell" element={<BefSell \/>}/.test(block), block);
    const protectedStart = app.indexOf('<ProtectedRoute>');
    check('…inside the logged-in routes', protectedStart > 0 && app.indexOf('<Route path="/bef"') > protectedStart && app.indexOf('<Route path="/bef"') < app.indexOf('<Route path="*"'));

    const layout = read('src/pages/bef/BefLayout.tsx');
    const tabPaths = [...layout.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
    check('tabs: Explorer, Interest, Sell, My Circle at the route paths', JSON.stringify(tabPaths) === JSON.stringify(['/bef', '/bef/interest', '/bef/sell', '/bef/circle']), tabPaths);
    check('Sell opens https://lana.discount/offer', layout.includes('export const BEF_SELL_URL = "https://lana.discount/offer";') && /href: BEF_SELL_URL/.test(layout));
    check('the person provider is keyed by the MejmoSefajn hex', /<BefPersonProvider key={session\?\.nostrHexId/.test(layout));

    const authContext = read('src/contexts/AuthContext.tsx');
    const logout = /const logout = \(\) => \{([\s\S]*?)\n  \};/.exec(authContext)?.[1] ?? '';
    check('AuthContext.logout forgets the BEF person, after the session key', /removeItem\(SESSION_KEY\);[\s\S]*forgetBefPerson\(befClient\)/.test(logout), logout);
    check('an expired session forgets it too', /Session expired, removing[\s\S]{0,200}forgetBefPerson\(befClient\)/.test(authContext));

    const moduleFiles: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'vendor') walk(full);
        } else if (/\.(ts|tsx)$/.test(e.name)) moduleFiles.push(full);
      }
    };
    for (const dir of ['src/pages/bef', 'src/components/bef', 'src/lib/bef']) walk(path.join(ROOT, dir));
    const offenders = (re: RegExp) => moduleFiles.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
    check('no dangerouslySetInnerHTML in the module', offenders(/dangerouslySetInnerHTML/).length === 0, offenders(/dangerouslySetInnerHTML/));
    check("the session's stored nostrPrivateKey is never read", offenders(/session(Ref\.current)?\??\.nostrPrivateKey|current\??\.nostrPrivateKey/).length === 0, offenders(/session(Ref\.current)?\??\.nostrPrivateKey/));
    check('no WIF or private key goes to storage', offenders(/setItem\([^)]*(lanaPrivateKey|privateKey)/).length === 0);
  }

  /* ───────────────────────────────────────────────────────────────── copy ── */
  console.log('— no promise vocabulary in the module’s own words —');
  {
    let banned: RegExp[] = [
      /guaranteed\s+(return|profit|resale|buyback|liquidity|exit|price)/i,
      /expected\s+return/i,
      /\byou\s+will\s+(earn|profit|gain)\b/i,
      /risk[-\s]free/i,
      /\bbest\s+investment\b/i,
      /recommended\s+(round|company|investment)/i,
    ];
    if (HAVE_BEF) {
      const copyTest = readFileSync(path.join(BEF, 'server/tests/copy.test.ts'), 'utf8');
      const list = /const BANNED = \[([\s\S]*?)\n\];/.exec(copyTest)?.[1] ?? '';
      const fromBef = [...list.matchAll(/^\s*\/(.+)\/([a-z]*),\s*$/gm)].map((m) => new RegExp(m[1], m[2]));
      check('BEF copy.test.ts BANNED read', fromBef.length >= banned.length, fromBef.length);
      if (fromBef.length) banned = fromBef;
    }
    // Every page and component, in sub-folders too, and every dictionary of the
    // module's own words (befVendor.ts is BEF's, checked by BEF's copy.test.ts).
    const sourcesUnder = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    const dictionaries = readdirSync(path.join(ROOT, 'src/i18n/modules'))
      .filter((f) => /^bef\w*\.ts$/.test(f) && f !== 'befVendor.ts')
      .map((f) => `src/i18n/modules/${f}`);
    const sources = [...dictionaries, ...sourcesUnder('src/pages/bef'), ...sourcesUnder('src/components/bef')];
    check('the copy check reads the pages’ sub-folders and every own dictionary', sources.some((f) => f.includes('/bef/interest/')) && dictionaries.includes('src/i18n/modules/befVendorHu.ts'), sources);
    const found: string[] = [];
    for (const rel of sources) {
      const text = read(rel);
      for (const re of banned) {
        for (const match of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
          // BEF's own rule: a negated use is the required disclosure, not a promise.
          const before = text.slice(Math.max(0, (match.index ?? 0) - 90), match.index ?? 0);
          if (/\b(not|never|nor|no|without)\b[^.!?]*$/i.test(before)) continue;
          found.push(`${rel}: "${match[0]}"`);
        }
      }
    }
    check('nothing assertive found', found.length === 0, found);
  }

  /* ─────────────────────────────────────────────────────────────── hosts ── */
  console.log('— BEF lets in exactly this app’s hosts —');
  if (HAVE_BEF) {
    const ours = /VIRTUAL_HOST=([^\s]+)/.exec(read('docker-compose.prod.yml'))?.[1]?.split(',') ?? [];
    const theirs = (/CORS_ALLOWED_ORIGINS=([^\s]+)/.exec(readFileSync(path.join(BEF, 'docker-compose.prod.yml'), 'utf8'))?.[1]?.split(',') ?? []).map((o) => o.replace(/^https:\/\//, ''));
    check('MejmoSefajn VIRTUAL_HOST has 5 hosts', ours.length === 5, ours);
    check('BEF CORS_ALLOWED_ORIGINS names the same hosts, in order, all https', JSON.stringify(ours) === JSON.stringify(theirs), { ours, theirs });
  } else {
    skipped('host list comparison');
  }

  if (failures) console.log(`\n❌ ${failures} FAILED${skips ? `, ${skips} skipped` : ''}`);
  else if (skips && !WITHOUT_BEF) console.log(`\n❌ passed, but ${skips} skipped (bef-explorer not found): nothing was compared with BEF. Set BEF_EXPLORER_DIR, or pass --without-bef.`);
  else console.log(skips ? `\n✅ passed, ${skips} skipped (--without-bef)` : '\n✅ all passed');
  process.exit(failures || (skips && !WITHOUT_BEF) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
