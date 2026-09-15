/**
 * The BEF module's My Circle page: how a typed or scanned card is read, the
 * private-key check in front of a typed id, what every answer from BEF means
 * for the page, and the page's own words.
 *   npx tsx scripts/testBefCircle.ts
 *   BEF_EXPLORER_DIR=/path/to/bef-explorer npx tsx scripts/testBefCircle.ts
 *   npx tsx scripts/testBefCircle.ts --without-bef   (on purpose, with no bef-explorer)
 *
 * Where bef-explorer is at hand (next to this repo, or BEF_EXPLORER_DIR), a card
 * is also read by BEF's OWN readCardInput and must come out the same, and the
 * page's steps run end to end against BEF's own server (createApp, an in-memory
 * database, and BEF's test fakes for the Registrar, the profiles and the
 * relays). Without it those parts say "skipped", the rest still runs, and the
 * run fails unless --without-bef was given: a green run has compared this build
 * with BEF.
 *
 * Nothing here touches a network, a relay or the Registrar: every fetch that is
 * not to 127.0.0.1 is refused.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertWifToIds } from '../src/lib/crypto.js';
import { BefApiError, createBefClient, type CardListView } from '../src/lib/bef/api.js';
import { befKeyFromSession, BefKeyError, type BefKey } from '../src/lib/bef/signing.js';
import { CARD_PROBLEMS, cardsProblem } from '../src/lib/bef/problems.js';
import { isNostrPublicKey, MAX_CARDS } from '../src/lib/bef/vendor/server/lib/cardListEvent.js';
import { reconcilePending, shortCardId } from '../src/lib/bef/vendor/src/lib/cardList.js';
import {
  CARD_INPUT_TEXT,
  cardInputProblem,
  CardInputError,
  normalizeCardInput,
  publicKeyOfHex,
  readCardInput,
  type CardCandidate,
} from '../src/components/bef/circle/cardInput.js';
import {
  checkCard,
  LIST_FULL,
  publishAnswer,
  publishCards,
  publishedMessage,
  type CardAllowance,
  type CardStatusCall,
  type CardVerdict,
} from '../src/components/bef/circle/cardChecks.js';
import befCircleText, { befCircleTranslations } from '../src/i18n/modules/befCircle.js';
import befTranslations from '../src/i18n/modules/bef.js';
import discountTranslations from '../src/i18n/modules/discount.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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

function befDir(): string {
  if (process.env.BEF_EXPLORER_DIR) return path.resolve(process.env.BEF_EXPLORER_DIR);
  return path.resolve(ROOT, '..', 'bef-explorer');
}
const BEF = befDir();
const HAVE_BEF = existsSync(path.join(BEF, 'server/lib/crossOrigin.ts'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- BEF's own modules, loaded by path and used as they are
const bef = async <T = any>(rel: string): Promise<T> => import(pathToFileURL(path.join(BEF, rel)).href);
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/* Nothing leaves this machine: a fetch anywhere but loopback is refused. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError(`blocked in this test: ${url.hostname}`);
  return realFetch(input, init);
}) as typeof fetch;

/* ── throwaway keys ────────────────────────────────────────────────────── */

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
function wif(privateKeyHex: string, version: number, compressed: boolean, flag = 1): string {
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(privateKeyHex, 'hex'), compressed ? Buffer.from([flag]) : Buffer.alloc(0)]);
  return base58(Buffer.concat([payload, sha256d(payload).subarray(0, 4)]));
}
const FORMS = [
  { name: 'T', version: 0xb0, compressed: true },
  { name: '6', version: 0xb0, compressed: false },
  { name: 'A', version: 0x41, compressed: true },
  { name: '3', version: 0x41, compressed: false },
] as const;
const SECP256K1_N = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

/** A private key whose 64 hex characters also are (or are not) a valid public id. */
function privateKey(onCurveAsId: boolean | null = null): string {
  for (;;) {
    const priv = randomBytes(32).toString('hex');
    if (!publicKeyOfHex(priv)) continue;
    if (onCurveAsId === null || isNostrPublicKey(priv) === onCurveAsId) return priv;
  }
}
const pub = (priv: string) => publicKeyOfHex(priv)!;

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

const outcome = async (fn: () => Promise<CardCandidate>) => {
  try {
    const card = await fn();
    return { hex: card.hex, byId: card.byId };
  } catch (err) {
    return { error: err instanceof CardInputError ? err.reason : `other:${(err as Error)?.name}` };
  }
};

const ALLOWANCE: CardAllowance = { max: 10, used: 0, remaining: 10, nextSlotAt: null };
const ctxFor = (self: string, over: Partial<Parameters<typeof checkCard>[1]> = {}) => ({
  self,
  published: [] as string[],
  pendingAdds: [] as string[],
  pendingRemoves: [] as string[],
  allowance: ALLOWANCE,
  ...over,
});

type StatusAnswer = Awaited<ReturnType<CardStatusCall>>;
/** A status call that answers from a table and records what it was asked. */
function fakeStatus(answers: Record<string, StatusAnswer | Error>) {
  const calls: { hex: string; profile: boolean }[] = [];
  const fn: CardStatusCall = async (hex, profile) => {
    calls.push({ hex, profile });
    const answer = answers[hex];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error('not in the table');
    return answer;
  };
  return { fn, calls };
}

const keyOf = (verdict: CardVerdict) => verdict.message.key;

async function main() {
  const SELF_PRIV = privateKey();
  const SELF_WIF = wif(SELF_PRIV, 0xb0, true);
  const SELF = (await convertWifToIds(SELF_WIF)).nostrHexId;

  /* ─────────────────────────────────────────────────────── reading a card ── */
  console.log('— a card is read in this browser: WIF → its id, a typed id as it is —');
  {
    const cardPriv = privateKey();
    const cardHex = pub(cardPriv);
    for (const form of FORMS) {
      const text = wif(cardPriv, form.version, form.compressed);
      check(`WIF form ${form.name} gives the x-only public key, by key`, JSON.stringify(await outcome(() => readCardInput(text, SELF))) === JSON.stringify({ hex: cardHex, byId: false }), text[0]);
    }
    const scanned = `lanacoin:${wif(cardPriv, 0xb0, true).replace(/(.{10})/g, '$1 ')}\u200b\n`;
    check('a scanned key with a URI scheme, spaces and zero-width joiners still reads', (await outcome(() => readCardInput(scanned, SELF))).hex === cardHex);

    const typed = await readCardInput(`  ${cardHex.toUpperCase()}\n`, SELF);
    check('a typed hex id: any case, spaces around it → byId, lowercase', typed.hex === cardHex && typed.byId === true);
    check('…with the public key the same 64 characters open as a private key', typed.derived === publicKeyOfHex(cardHex));

    const address = (await convertWifToIds(wif(cardPriv, 0xb0, true))).walletId;
    // A key whose last four bytes do not match: the length stays, only the checksum is wrong.
    const typo = (() => {
      const payload = Buffer.concat([Buffer.from([0xb0]), Buffer.from(cardPriv, 'hex'), Buffer.from([1])]);
      const checksum = sha256d(payload).subarray(0, 4);
      checksum[3] ^= 0x01;
      return base58(Buffer.concat([payload, checksum]));
    })();
    // One character changed by hand: a typo, or no longer a key's length — BEF says which.
    const lastChanged = (() => {
      const good = wif(cardPriv, 0xb0, true);
      return good.slice(0, -1) + (good.at(-1) === 'z' ? 'y' : 'z');
    })();
    const refusals: [string, string, string][] = [
      ['empty', '', 'empty'],
      ['spaces only', '   \n', 'empty'],
      ['npub', `npub1${'q'.repeat(58)}`, 'npub'],
      ['nsec', `nsec1${'q'.repeat(58)}`, 'nsec'],
      ['a LANA address', address, 'address'],
      ['a typo in a WIF', typo, 'checksum'],
      ['a Bitcoin WIF (0x80)', wif(cardPriv, 0x80, true), 'wrongNetwork'],
      ['text that is no key', 'not a key', 'notAKey'],
      ['63 hex characters', 'b'.repeat(63), 'notAKey'],
      ['a flag byte that is not 0x01', wif(cardPriv, 0xb0, true, 2), 'notAKey'],
      ['a key equal to the group order', wif(SECP256K1_N, 0xb0, true), 'notAKey'],
      ['64 hex that is no point on the curve', 'b'.repeat(64), 'badId'],
    ];
    for (const [name, text, reason] of refusals) {
      const got = await outcome(() => readCardInput(text, SELF));
      check(`${name} → ${reason}`, got.error === reason, got);
    }

    // The person's own private key, typed where an id goes — whether or not it also reads as an id.
    for (const onCurve of [true, false]) {
      const priv = privateKey(onCurve);
      const self = pub(priv);
      const got = await outcome(() => readCardInput(priv, self));
      check(`own private key (${onCurve ? 'also a valid id' : 'no valid id'}) → ownPrivateKey`, got.error === 'ownPrivateKey', got);
    }
    // A refusal never carries the text.
    try {
      await readCardInput(typo, SELF);
    } catch (err) {
      check('a refusal names a reason, never the text', err instanceof CardInputError && !err.message.includes(typo) && !JSON.stringify(err).includes(typo));
    }
    check('every reason has words', Object.values(CARD_INPUT_TEXT).every((key) => typeof befCircleText.en[key] === 'string'));
    check('anything else thrown is "not a key"', cardInputProblem(new Error('boom')) === 'person.err.notAKey');
    check('normalizeCardInput strips BOM, NBSP and a scheme', normalizeCardInput('\ufeff\u00a0lanacoin://abc def') === 'abcdef');

    if (HAVE_BEF) {
      const befCardKey = await bef('src/lib/cardKey.ts');
      const befOutcome = (text: string) => {
        try {
          const card = befCardKey.readCardInput(text);
          return { hex: card.hex, byId: card.byId };
        } catch (err) {
          const refusal = err as { name?: string; reason?: string } | null;
          return { error: refusal?.name === 'CardIdError' ? 'badId' : refusal?.reason ?? 'other' };
        }
      };
      const inputs = [
        ...FORMS.map((form) => wif(cardPriv, form.version, form.compressed)),
        scanned,
        cardHex,
        `  ${cardHex.toUpperCase()}\n`,
        ...refusals.map(([, text]) => text),
        lastChanged,
      ];
      const differ: unknown[] = [];
      for (const text of inputs) {
        const ours = await outcome(() => readCardInput(text, SELF));
        const theirs = befOutcome(text);
        if (JSON.stringify(ours) !== JSON.stringify(theirs)) differ.push({ ours, theirs, at: inputs.indexOf(text) });
      }
      check(`BEF’s own readCardInput reads all ${inputs.length} inputs the same`, differ.length === 0, differ);
    } else {
      skipped('comparison with BEF’s readCardInput');
    }
  }

  /* ───────────────────────────────────────────────── the private-key check ── */
  console.log('— 64 hex characters are asked about as a private key first, never sent as themselves —');
  {
    const priv = privateKey(true);
    const derived = pub(priv);
    const typed = await readCardInput(priv, SELF);
    check('a private key that is also a valid id reads as a typed id, with the key it opens', typed.byId && typed.hex === priv && typed.derived === derived);

    const free = (found: boolean | null, name: string | null = null): StatusAnswer => ({ status: 'free', profile: { found, name } });

    let s = fakeStatus({ [derived]: free(true, 'Cene') });
    let v = await checkCard(typed, ctxFor(SELF), s.fn);
    check('the key it opens has a profile → refused as a private key', v.kind === 'refused' && keyOf(v) === 'circle.privateKey', v);
    check('…only the key it opens was asked about, with profile', JSON.stringify(s.calls) === JSON.stringify([{ hex: derived, profile: true }]), s.calls);

    for (const status of ['taken', 'yours', 'brought_you', 'own'] as const) {
      s = fakeStatus({ [derived]: { status } });
      v = await checkCard(typed, ctxFor(SELF), s.fn);
      check(`the key it opens is on a list (${status}) → refused as a private key, text never asked`, keyOf(v) === 'circle.privateKey' && s.calls.every((c) => c.hex !== priv), s.calls);
    }

    s = fakeStatus({ [derived]: free(null) });
    v = await checkCard(typed, ctxFor(SELF), s.fn);
    check('profile not known → nothing added, "could not check", and no retry keeps the text', v.kind === 'refused' && keyOf(v) === 'circle.checkFailed' && s.calls.length === 1, v);

    s = fakeStatus({ [derived]: new BefApiError('network', 0) });
    v = await checkCard(typed, ctxFor(SELF), s.fn);
    check('no answer to the check → the network words, refused (not a retry)', v.kind === 'refused' && keyOf(v) === 'door.unreachable', v);

    s = fakeStatus({ [derived]: new BefApiError('bad_signature', 400) });
    v = await checkCard(typed, ctxFor(SELF), s.fn);
    check('any other failure of the check → "could not check"', v.kind === 'refused' && keyOf(v) === 'circle.checkFailed', v);

    // A real id: the key it opens has nobody behind it, the id has a profile.
    const idPriv = privateKey();
    const id = pub(idPriv);
    const asId = await readCardInput(id, SELF);
    s = fakeStatus({ [asId.derived!]: free(false), [id]: free(true, 'Ana') });
    v = await checkCard(asId, ctxFor(SELF), s.fn);
    check('a real id with a profile → added with its name', v.kind === 'add' && v.hex === id && v.name === 'Ana' && keyOf(v) === 'cards.add.readyNamed', v);
    check('…asked in order: the key it opens, then the id itself, both with profile', JSON.stringify(s.calls) === JSON.stringify([{ hex: asId.derived, profile: true }, { hex: id, profile: true }]), s.calls);
    check('…the message names the short id', v.message.vars?.id === shortCardId(id) && v.message.alert === false);

    s = fakeStatus({ [asId.derived!]: free(false), [id]: free(false) });
    v = await checkCard(asId, ctxFor(SELF), s.fn);
    check('a typed id with no profile → refused, "no profile"', v.kind === 'refused' && keyOf(v) === 'cards.err.noProfile', v);
    s = fakeStatus({ [asId.derived!]: free(false), [id]: free(null) });
    v = await checkCard(asId, ctxFor(SELF), s.fn);
    check('a typed id whose profile is not known → retry, "profile unknown"', v.kind === 'retry' && keyOf(v) === 'cards.err.profileUnknown', v);

    // 64 hex that are not a valid private key: nothing to ask about first.
    const noKey = await readCardInput(SECP256K1_N.slice(0, 63) + '2', SELF).catch(() => null);
    if (noKey && noKey.derived === null) {
      s = fakeStatus({ [noKey.hex]: free(true, 'X') });
      v = await checkCard(noKey, ctxFor(SELF), s.fn);
      check('an id that opens no key is asked about once', s.calls.length === 1 && v.kind === 'add', { calls: s.calls, v });
    }

    const wifCard = await readCardInput(wif(idPriv, 0x41, false), SELF);
    s = fakeStatus({ [id]: { status: 'free' } });
    v = await checkCard(wifCard, ctxFor(SELF), s.fn);
    check('a card read from its WIF → one question, without profile → added, unnamed', v.kind === 'add' && v.name === null && keyOf(v) === 'cards.add.ready' && JSON.stringify(s.calls) === JSON.stringify([{ hex: id, profile: false }]), { v, calls: s.calls });

    const answers: [StatusAnswer['status'], string, CardVerdict['kind']][] = [
      ['yours', 'cards.err.alreadyYours', 'yours'],
      ['taken', 'cards.err.taken', 'refused'],
      ['own', 'cards.err.own', 'refused'],
      ['brought_you', 'cards.err.broughtYou', 'refused'],
    ];
    for (const [status, key, kind] of answers) {
      v = await checkCard(wifCard, ctxFor(SELF), fakeStatus({ [id]: { status } }).fn);
      check(`BEF says ${status} → ${key}`, v.kind === kind && keyOf(v) === key, v);
    }
    v = await checkCard(wifCard, ctxFor(SELF), fakeStatus({ [id]: { status: 'weird' as never } }).fn);
    check('an unknown status → retry, "could not be checked"', v.kind === 'retry' && keyOf(v) === 'cards.err.checkFailed');
    v = await checkCard(wifCard, ctxFor(SELF), fakeStatus({ [id]: new BefApiError('bad_card', 400) }).fn);
    check('bad_card → "not a valid id"', v.kind === 'refused' && keyOf(v) === 'cards.err.badId');
    for (const code of ['network', 'timeout', 'rate_limited', 'busy']) {
      v = await checkCard(wifCard, ctxFor(SELF), fakeStatus({ [id]: new BefApiError(code, code === 'rate_limited' ? 429 : 0) }).fn);
      check(`${code} → retry with BEF's words`, v.kind === 'retry' && keyOf(v) === cardsProblem(new BefApiError(code, 0)).text, v);
    }
    v = await checkCard(wifCard, ctxFor(SELF), fakeStatus({ [id]: new BefKeyError('key_unreadable') }).fn);
    check('the session key unreadable → refused, the key words, no retry', v.kind === 'refused' && keyOf(v) === 'door.keyUnreadable', v);

    // Needs no server at all.
    const local: [string, Partial<Parameters<typeof checkCard>[1]>, string, CardCandidate][] = [
      ['own id', {}, 'cards.err.own', { hex: SELF, byId: true, derived: null }],
      ['already on the list', { published: [id] }, 'cards.err.alreadyYours', wifCard],
      ['already on the list, waiting to be removed', { published: [id], pendingRemoves: [id] }, 'cards.err.alreadyYours', wifCard],
      ['already waiting', { pendingAdds: [id] }, 'cards.err.alreadyPending', wifCard],
      ['none left, next slot known', { allowance: { max: 10, used: 10, remaining: 0, nextSlotAt: '2026-10-01T10:00:00Z' } }, 'cards.allowance.none', wifCard],
      ['waiting ones take all that is left', { allowance: { max: 10, used: 9, remaining: 1, nextSlotAt: null }, pendingAdds: [pub(privateKey())] }, 'cards.allowance.waiting', wifCard],
      ['list full', { published: Array.from({ length: MAX_CARDS }, () => pub(privateKey())) }, 'cards.err.full', wifCard],
      ['allowance not loaded', { allowance: null }, 'cards.err.monthly_card_limit', wifCard],
    ];
    for (const [name, over, key, card] of local) {
      s = fakeStatus({});
      v = await checkCard(card, ctxFor(SELF, over), s.fn);
      check(`${name} → ${key}, nothing asked`, v.kind === 'refused' && keyOf(v) === key && s.calls.length === 0, { v, calls: s.calls });
    }
  }

  /* ─────────────────────────────────────────────────────── publish answers ── */
  console.log('— every refused publish has words, and says what happens to the changes —');
  {
    const a = pub(privateKey());
    const b = pub(privateKey());
    const cases: [string, BefApiError, (x: ReturnType<typeof publishAnswer>) => boolean][] = [
      [LIST_FULL, new BefApiError(LIST_FULL, 0), (x) => x.message.key === 'cards.err.full' && x.message.vars?.max === MAX_CARDS],
      ['card_taken', new BefApiError('card_taken', 409, { cards: [a, b, 'nonsense', a] }), (x) => x.message.key === 'cards.err.card_taken' && JSON.stringify(x.drop) === JSON.stringify([a, b]) && x.message.vars?.count === 2 && JSON.stringify(x.message.ids) === JSON.stringify([shortCardId(a), shortCardId(b)])],
      ['card_brought_you', new BefApiError('card_brought_you', 409, { cards: [a] }), (x) => x.message.key === 'cards.err.card_brought_you' && JSON.stringify(x.drop) === JSON.stringify([a])],
      ['stale_event', new BefApiError('stale_event', 409), (x) => x.message.key === 'cards.err.stale_event' && x.reload === 'first' && !x.drop],
      ['bad_base', new BefApiError('bad_base', 400), (x) => x.message.key === 'cards.err.stale_event' && x.reload === 'first'],
      ['monthly_card_limit, some left', new BefApiError('monthly_card_limit', 409, { max: 10, remaining: 3, nextSlotAt: null }), (x) => x.message.key === 'cards.err.monthly_card_limit' && x.message.vars?.remaining === 3 && x.reload === 'quiet'],
      ['monthly_card_limit, none left', new BefApiError('monthly_card_limit', 409, { max: 10, remaining: 0, nextSlotAt: '2026-10-01T10:00:00Z' }), (x) => x.message.key === 'cards.allowance.none'],
      ['publish_failed, no relays', new BefApiError('publish_failed', 502, { accepted: 0, total: 0 }), (x) => x.message.key === 'cards.err.noRelays'],
      ['publish_failed, 1 of 4', new BefApiError('publish_failed', 502, { accepted: 1, total: 4 }), (x) => x.message.key === 'cards.err.publish_failed' && x.message.vars?.accepted === 1 && x.message.vars?.total === 4],
      ['relay_writes_disabled', new BefApiError('relay_writes_disabled', 503), (x) => x.message.key === 'circle.relayWritesOff'],
      ['outcome_unknown', new BefApiError('outcome_unknown', 0), (x) => x.message.key === 'cards.err.outcomeUnknown' && x.reload === 'first' && !x.drop],
      ['list_too_large_for_relays', new BefApiError('list_too_large_for_relays', 413), (x) => x.message.key === 'cards.err.list_too_large_for_relays'],
      ['check_unavailable', new BefApiError('check_unavailable', 503), (x) => x.message.key === 'cards.err.check_unavailable'],
      ['publish_in_progress', new BefApiError('publish_in_progress', 409), (x) => x.message.key === 'cards.err.publish_in_progress'],
      ['stale_clock', new BefApiError('stale_clock', 400), (x) => x.message.key === 'interest.err.stale_clock'],
      ['rate_limited', new BefApiError('rate_limited', 429), (x) => x.message.key === 'person.err.rateLimited'],
      ['network (before sending)', new BefApiError('network', 0), (x) => x.message.key === 'door.unreachable' && !x.reload],
      ['pubkey_mismatch', new BefApiError('pubkey_mismatch', 403), (x) => x.message.key === 'door.keyUnreadable'],
      ['an unknown code', new BefApiError('bad_signature', 400), (x) => x.message.key === 'door.generic' && x.message.vars?.code === 'bad_signature'],
    ];
    for (const [name, err, ok] of cases) {
      const answer = publishAnswer(err);
      check(`${name} → ${answer.message.key}`, ok(answer) && answer.message.alert === true, answer);
    }
    const everyCode = [...Object.keys(CARD_PROBLEMS), LIST_FULL].map((code) => publishAnswer(new BefApiError(code, 400)).message.key);
    check('every card code’s words exist in the page’s dictionary', everyCode.every((key) => typeof befCircleText.en[key] === 'string'), everyCode);
    const done = publishedMessage({ list: {} as CardListView, relays: { accepted: 3, total: 4 }, added: [a, b], removed: [a] });
    check('a published list says N of M, added and removed', done.key === 'circle.published' && done.alert === false && JSON.stringify(done.vars) === JSON.stringify({ accepted: 3, total: 4, added: 2, removed: 1 }));
  }

  /* ─────────────────────────────────────────── end to end, BEF's own server ── */
  console.log('— end to end against BEF’s own server (fake relays, fake profiles) —');
  if (HAVE_BEF) {
    const helpers = await bef('server/tests/personHelpers.ts');
    const personStore = await bef('server/lib/personStore.ts');
    const befCardList = await bef('server/lib/cardListEvent.ts');

    const publisher = helpers.fakePublisher();
    const found = new Map<string, string | null>();
    let profilesOk = true;
    const cardProfiles = async (hexes: string[]) => {
      if (!profilesOk) return { ok: false };
      const withProfile = hexes.filter((hex) => found.has(hex));
      const names: Record<string, string> = {};
      for (const hex of withProfile) if (found.get(hex)) names[hex] = found.get(hex)!;
      return { ok: true, withProfile, names };
    };
    const db = helpers.freshDb();
    const deps = {
      registrar: helpers.fakeRegistrar().client,
      gateProfiles: helpers.fakeGateProfiles().lookup,
      cardProfiles,
      publisher: publisher.publish,
      log: () => {},
    };
    const app = await helpers.startApp({ ...deps, relayWrites: true }, db);
    const off = await helpers.startApp({ ...deps, relayWrites: false }, db);

    const bodies: string[] = [];
    const recording = (async (input: string, init?: RequestInit) => {
      if (typeof init?.body === 'string') bodies.push(init.body);
      return fetch(input, init);
    }) as typeof fetch;
    const clientFor = (base: string, fetchImpl: typeof fetch = recording) => createBefClient({ base, fetchImpl });
    const client = clientFor(app.base);

    const secrets: string[] = [SELF_PRIV, SELF_WIF];
    async function person(name: string) {
      const priv = privateKey();
      const personWif = wif(priv, 0xb0, true);
      secrets.push(priv, personWif);
      const key: BefKey = await befKeyFromSession(await sessionFor(personWif));
      personStore.upsertPerson(db, {
        hex: key.hex,
        wallet: key.address,
        name,
        displayName: name,
        details: { country: 'SI', email: `${key.hex.slice(0, 6)}@example.com`, phone: '041000000', phoneCountryCode: '+386', lanaWalletID: key.address, eventId: 'e'.repeat(64), createdAt: 1 },
      });
      const { token } = personStore.createPersonSession(db, key.hex, key.address);
      const withSession = <T,>(fn: (auth: { token: string; key: BefKey }) => Promise<T>) => fn({ token, key });
      const status: CardStatusCall = (hex, profile) => client.cards.status(token, hex, profile);
      return { key, token, withSession, status };
    }
    const newCard = () => {
      const priv = privateKey(true);
      const w = wif(priv, 0xb0, true);
      secrets.push(priv, w);
      return { priv, wif: w, hex: pub(priv) };
    };

    const ana = await person('Ana Novak');
    let mine = await client.cards.mine(ana.token);
    check('a first visit: no list, 10 new cards allowed', mine.list === null && mine.allowance.remaining === 10 && mine.allowance.max === 10, mine);

    // A card by its WIF.
    const c1 = newCard();
    const byWif = await readCardInput(c1.wif, ana.key.hex);
    let v = await checkCard(byWif, ctxFor(ana.key.hex, { allowance: mine.allowance }), ana.status);
    check('a card scanned as its WIF → free, added', v.kind === 'add' && v.hex === c1.hex, v);

    // A person by their hex id, with a profile.
    const c2 = newCard();
    found.set(c2.hex, 'Bojan Kranjc');
    const byId = await readCardInput(c2.hex, ana.key.hex);
    v = await checkCard(byId, ctxFor(ana.key.hex, { allowance: mine.allowance, pendingAdds: [c1.hex] }), ana.status);
    check('a typed id with a profile → added, with the name BEF found', v.kind === 'add' && v.name === 'Bojan Kranjc', v);

    // A private key typed where an id goes.
    const c3 = newCard();
    found.set(c3.hex, 'Cene');
    const byPrivate = await readCardInput(c3.priv, ana.key.hex);
    v = await checkCard(byPrivate, ctxFor(ana.key.hex, { allowance: mine.allowance }), ana.status);
    check('a card’s private key typed as an id → refused as a private key', v.kind === 'refused' && keyOf(v) === 'circle.privateKey', v);

    // Publish both.
    let result = await publishCards(ana.withSession, client, { list: mine.list, adds: [c1.hex, c2.hex], removes: [] });
    check('publish → 4 of 4 relays, added 2', result.relays.accepted === 4 && result.relays.total === 4 && result.added.length === 2, result);
    const event = publisher.published.at(-1);
    const parsed = befCardList.parseCardListEvent(event);
    check('the relays got a KIND 30971 BEF reads back as exactly those cards', event?.kind === 30971 && parsed.ok && JSON.stringify(parsed.cards) === JSON.stringify([c1.hex, c2.hex]), parsed);
    const firstList = result.list;
    mine = await client.cards.mine(ana.token);
    check('the list BEF holds has both, names included; 8 left', mine.list?.cards.length === 2 && mine.allowance.remaining === 8 && mine.list?.cards.find((c) => c.hex === c2.hex)?.name === 'Bojan Kranjc', mine);

    // Change again at once: the same second, a newer created_at.
    const c4 = newCard();
    const again = await publishCards(ana.withSession, client, { list: mine.list, adds: [c4.hex], removes: [c1.hex] }).catch((err: unknown) => err as BefApiError);
    check(
      'remove one and add one right after → published, list is [c2, c4]',
      !(again instanceof Error) && JSON.stringify(again.list.cards.map((c) => c.hex)) === JSON.stringify([c2.hex, c4.hex]) && again.removed.length === 1,
      again instanceof BefApiError ? again.code : again,
    );

    // An old view of the list.
    const stale = await publishCards(ana.withSession, client, { list: firstList, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('publishing on an old view of the list → stale_event, reload first', stale instanceof BefApiError && stale.code === 'stale_event' && publishAnswer(stale).reload === 'first', stale?.code);

    // Someone else was first.
    const bo = await person('Bor Zupan');
    const c5 = newCard();
    await publishCards(bo.withSession, client, { list: null, adds: [c5.hex], removes: [] });
    v = await checkCard(await readCardInput(c5.wif, ana.key.hex), ctxFor(ana.key.hex, { allowance: mine.allowance }), ana.status);
    check('a card another person listed first → "taken", no name', v.kind === 'refused' && keyOf(v) === 'cards.err.taken' && !JSON.stringify(v).includes('Bor'), v);
    mine = await client.cards.mine(ana.token);
    const taken = await publishCards(ana.withSession, client, { list: mine.list, adds: [c5.hex], removes: [] }).catch((err) => err);
    const takenAnswer = publishAnswer(taken);
    check('publishing it anyway → card_taken, the card dropped from the changes', taken?.code === 'card_taken' && JSON.stringify(takenAnswer.drop) === JSON.stringify([c5.hex]), { code: taken?.code, takenAnswer });

    // Someone who brought Ana.
    const cvet = await person('Cvetka');
    found.set(ana.key.hex, 'Ana Novak');
    await publishCards(cvet.withSession, client, { list: null, adds: [ana.key.hex], removes: [] });
    mine = await client.cards.mine(ana.token);
    check('Ana is on Cvetka’s list → listedAsCard', mine.listedAsCard === true);
    found.set(cvet.key.hex, 'Cvetka');
    v = await checkCard(await readCardInput(cvet.key.hex, ana.key.hex), ctxFor(ana.key.hex, { allowance: mine.allowance }), ana.status);
    check('the person who brought Ana, typed as an id → "brought you"', v.kind === 'refused' && keyOf(v) === 'cards.err.broughtYou', v);
    const broughtYou = await publishCards(ana.withSession, client, { list: mine.list, adds: [cvet.key.hex], removes: [] }).catch((err) => err);
    check('publishing it anyway → card_brought_you, dropped', broughtYou?.code === 'card_brought_you' && JSON.stringify(publishAnswer(broughtYou).drop) === JSON.stringify([cvet.key.hex]), broughtYou?.code);

    // The 30-day allowance.
    mine = await client.cards.mine(ana.token);
    const tooMany = Array.from({ length: mine.allowance.remaining + 1 }, () => newCard().hex);
    const limited = await publishCards(ana.withSession, client, { list: mine.list, adds: tooMany, removes: [] }).catch((err) => err);
    const limitedAnswer = publishAnswer(limited);
    check('more new cards than are left → monthly_card_limit with what is left', limited?.code === 'monthly_card_limit' && limitedAnswer.message.vars?.remaining === mine.allowance.remaining, { code: limited?.code, limitedAnswer });

    // Relays that do not take it.
    publisher.state.accepted = 1;
    const failed = await publishCards(ana.withSession, client, { list: mine.list, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('1 of 4 relays → publish_failed with N of M', failed?.code === 'publish_failed' && publishAnswer(failed).message.vars?.accepted === 1, failed?.body);
    publisher.state.accepted = 0;
    publisher.state.total = 0;
    mine = await client.cards.mine(ana.token);
    const noRelays = await publishCards(ana.withSession, client, { list: mine.list, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('no relays at all → "no relays"', publishAnswer(noRelays).message.key === 'cards.err.noRelays', noRelays?.body);
    publisher.state.total = 4;
    publisher.state.refusals = [
      { relay: 'wss://a.test', reason: 'event too large' },
      { relay: 'wss://b.test', reason: 'too large' },
    ];
    mine = await client.cards.mine(ana.token);
    const tooLarge = await publishCards(ana.withSession, client, { list: mine.list, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('relays refuse it as too large → list_too_large_for_relays', publishAnswer(tooLarge).message.key === 'cards.err.list_too_large_for_relays', tooLarge?.code);
    publisher.reset();

    profilesOk = false;
    mine = await client.cards.mine(ana.token);
    const unchecked = await publishCards(ana.withSession, client, { list: mine.list, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('relays did not answer the profile check → check_unavailable', publishAnswer(unchecked).message.key === 'cards.err.check_unavailable', unchecked?.code);
    profilesOk = true;

    const offClient = clientFor(off.base);
    const disabled = await publishCards(ana.withSession, offClient, { list: mine.list, adds: [newCard().hex], removes: [] }).catch((err) => err);
    check('sending switched off on BEF → "switched off on BEF Explorer"', publishAnswer(disabled).message.key === 'circle.relayWritesOff', disabled?.code);

    // Sent, and the answer lost on the way.
    mine = await client.cards.mine(ana.token);
    const lostAnswer = (async (input: string, init?: RequestInit) => {
      const res = await recording(input, init);
      if (init?.method === 'POST' && new URL(input).pathname === '/api/cards') {
        await res.text();
        throw new TypeError('the answer was lost');
      }
      return res;
    }) as typeof fetch;
    const c6 = newCard();
    const lateAdd = newCard().hex;
    const lost = await publishCards(ana.withSession, clientFor(app.base, lostAnswer), { list: mine.list, adds: [c6.hex], removes: [c2.hex] }).catch((err) => err);
    const lostReply = publishAnswer(lost);
    check('no answer to a sent list → outcome_unknown, reload first', lost?.code === 'outcome_unknown' && lostReply.reload === 'first', lost?.code);
    mine = await client.cards.mine(ana.token);
    const kept = reconcilePending({ adds: [c6.hex, lateAdd], removes: [c2.hex] }, mine.list?.cards.map((c) => c.hex) ?? []);
    check('…the reloaded list carries it: those changes stop waiting, the rest stay', JSON.stringify(kept) === JSON.stringify({ adds: [lateAdd], removes: [] }), kept);

    // A session lost on the way: the step runs again with a new one, and signs again.
    let runs = 0;
    const renewing = async <T,>(fn: (auth: { token: string; key: BefKey }) => Promise<T>): Promise<T> => {
      runs++;
      try {
        return await fn({ token: 'f'.repeat(64), key: ana.key });
      } catch (err) {
        if (!(err instanceof BefApiError && err.status === 401)) throw err;
        runs++;
        return fn({ token: ana.token, key: ana.key });
      }
    };
    const before = publisher.published.length;
    result = await publishCards(renewing, client, { list: mine.list, adds: [newCard().hex], removes: [] });
    check('a session BEF no longer knows → asked again with the new one, published once', runs === 2 && publisher.published.length === before + 1 && result.relays.accepted === 4, { runs });

    // Nothing secret ever left the page.
    const leaked = secrets.filter((secret) => bodies.some((body) => body.includes(secret)));
    check(`no private key or WIF in any of the ${bodies.length} request bodies`, leaked.length === 0 && bodies.length > 10, leaked.map((s) => s.slice(0, 4)));
    check('the typed private key’s public key was asked about instead', bodies.some((body) => body.includes(c3.hex)));

    app.close();
    off.close();
  } else {
    skipped('end to end against BEF’s server');
  }

  /* ───────────────────────────────────────────────────────────── the page ── */
  console.log('— the page keeps no key and shows no typed text —');
  {
    const circleDir = 'src/components/bef/circle';
    const files = [...readdirSync(path.join(ROOT, circleDir)).map((f) => `${circleDir}/${f}`), 'src/pages/bef/BefCircle.tsx'];
    const sources = Object.fromEntries(files.map((rel) => [rel, read(rel)]));
    const addBox = sources[`${circleDir}/CardAddBox.tsx`];
    const submit = /const submit = \(e: FormEvent\) => \{([\s\S]*?)\n {2}\};/.exec(addBox)?.[1] ?? '';
    check('CardAddBox: the field is emptied before the text is handed on', /setValue\(""\);[\s\S]*onSubmit\(input\)/.test(submit), submit);
    check('CardAddBox: a scan goes straight to onSubmit, never into the field', /onScan=\{\(data\) => \{\s*setScanning\(false\);\s*onSubmit\(data\);\s*\}\}/.test(addBox) && !/setValue\(data/.test(addBox));
    check("CardAddBox: MejmoSefajn's QR scanner", addBox.includes('import { QRScanner } from "@/components/QRScanner";'));
    check('CardAddBox: a password field, no autocomplete, no autocorrect, no spellcheck', /type=\{reveal \? "text" : "password"\}/.test(addBox) && addBox.includes('autoComplete="off"') && addBox.includes('autoCapitalize="none"') && addBox.includes('autoCorrect="off"') && addBox.includes('spellCheck={false}'));

    const page = sources[`${circleDir}/CircleCards.tsx`];
    check('CircleCards: the typed text goes only to readCardInput', (page.match(/\binput\b/g) ?? []).length > 0 && /readCardInput\(input, hex\)/.test(page) && !/set\w+\(input/.test(page));
    check('CircleCards: a refused text is said by its reason only', /setAddProblem\(\{ key: cardInputProblem\(err\), alert: true \}\)/.test(page));
    check('changes are kept in sessionStorage through the vendored helpers only', /const pendingStorage = \(\) => sessionStorage;/.test(page) && Object.values(sources).every((s) => !/localStorage|sessionStorage\.setItem|sessionStorage\.getItem/.test(s)));
    const offenders = (re: RegExp) => Object.entries(sources).filter(([, s]) => re.test(s)).map(([rel]) => rel);
    check('no dangerouslySetInnerHTML', offenders(/dangerouslySetInnerHTML/).length === 0, offenders(/dangerouslySetInnerHTML/));
    check("the session's stored nostrPrivateKey is never read", offenders(/nostrPrivateKey/).length === 0, offenders(/nostrPrivateKey/));
    check('nothing logged to the console', offenders(/console\./).length === 0, offenders(/console\./));
    check('no toast — messages stay on the page', offenders(/toast/i).length === 0, offenders(/toast/i));
    const reader = sources[`${circleDir}/cardInput.ts`];
    check('cardInput.ts imports nothing that signs or keeps a key', !/signing|finalizeEvent|personToken|Storage/.test(reader.replace(/\/\*\*[\s\S]*?\*\//g, '')));

    const circlePage = sources['src/pages/bef/BefCircle.tsx'];
    check('BefCircle: behind the door, the list keyed by the signed-in person', /<BefDoor>\{\(signedIn\) => <CircleCards key=\{signedIn\.hex\} hex=\{signedIn\.hex\} \/>\}<\/BefDoor>/.test(circlePage));
    check('BefCircle: the notice that a list is public and no agreement', circlePage.includes('t("cards.notice")') && circlePage.includes('t("cards.publicNote")'));
    // The wallet comes last in "Signed in to BEF Explorer as {name} · {wallet}": cut, it never shows on a phone.
    const door = read('src/components/bef/BefDoor.tsx');
    const signedInLine = /<span className="([^"]*)">\s*\{t\("door\.signedInAs"/.exec(door)?.[1] ?? '';
    check('BefDoor: the signed-in line wraps, so the wallet shows on a phone', /\bbreak-words\b/.test(signedInLine) && !/\btruncate\b/.test(signedInLine), signedInLine);

    // Every text key the page names exists; every own key is in every language, placeholders alike.
    const named = new Set<string>();
    for (const s of Object.values(sources)) {
      for (const m of s.matchAll(/["']((?:cards|circle|person|interest|door)\.[A-Za-z_.]+)["']/g)) named.add(m[1]);
    }
    const missing = [...named].filter((key) => typeof (befCircleText.en as Record<string, string>)[key] !== 'string');
    check(`all ${named.size} text keys the page names exist`, missing.length === 0 && named.size > 40, missing);
    const enKeys = Object.keys(befCircleTranslations.en).sort();
    const holes = (vars: string) => [...vars.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const lang of ['sl', 'de', 'hu', 'it'] as const) {
      const dict = befCircleTranslations[lang] as Record<string, string> | undefined;
      const keys = Object.keys(dict ?? {}).sort();
      check(`${lang}: every own key, none extra`, JSON.stringify(keys) === JSON.stringify(enKeys), { keys });
      const bad = enKeys.filter((key) => !dict?.[key]?.trim() || holes(dict[key]) !== holes((befCircleTranslations.en as Record<string, string>)[key]));
      check(`${lang}: no empty text, the same placeholders`, bad.length === 0, bad);
      check(`${lang}: BEF's own words carried into the page dictionary`, (befCircleText[lang] as Record<string, string> | undefined)?.['circle.privateKey'] === dict?.['circle.privateKey']);
    }
  }

  /* ───────────────────────────────────────────────────────────────── copy ── */
  console.log('— no promise vocabulary in the page’s own words —');
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
    const circleDir = 'src/components/bef/circle';
    const sources = ['src/i18n/modules/befCircle.ts', 'src/pages/bef/BefCircle.tsx', 'src/pages/bef/BefSell.tsx', ...readdirSync(path.join(ROOT, circleDir)).map((f) => `${circleDir}/${f}`)];
    const found: string[] = [];
    for (const rel of sources) {
      if (!statSync(path.join(ROOT, rel)).isFile()) continue;
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

  /* ───────────────────────────────────────────────────────────────── sell ── */
  console.log('— Sell: /bef/sell typed by hand points to lana.discount/offer —');
  {
    const sell = read('src/pages/bef/BefSell.tsx');
    const layout = read('src/pages/bef/BefLayout.tsx');
    check('BEF_SELL_URL is exactly https://lana.discount/offer', layout.includes('export const BEF_SELL_URL = "https://lana.discount/offer";'));
    check('one link to it, in a new tab, no opener, no referrer', /<a href=\{BEF_SELL_URL\} target="_blank" rel="noopener noreferrer">/.test(sell) && (sell.match(/<a /g) ?? []).length === 1);
    const keys = [...sell.matchAll(/t\("([^"]+)"\)/g)].map((m) => m[1]);
    check('the module’s own words: title, body, call to action', /useTranslation\(befText\)/.test(sell) && JSON.stringify(keys) === JSON.stringify(['sell.title', 'sell.body', 'sell.cta']), keys);
    // The Lana Discount module has these words only in English and Slovenian. The
    // module says the same there, word for word, and has them in every other language.
    const PARTS = ['title', 'body', 'cta'];
    const own = (lang: string, part: string) => (befTranslations as Record<string, Record<string, string> | undefined>)[lang]?.[`sell.${part}`];
    const discount = (lang: string, part: string) => (discountTranslations as Record<string, Record<string, string> | undefined>)[lang]?.[`sell.moved.${part}`];
    const differ = ['en', 'sl'].flatMap((lang) => PARTS.filter((part) => own(lang, part) !== discount(lang, part)).map((part) => `${lang}:${part}`));
    check('…in English and Slovenian, the Lana Discount module’s Sell page word for word', differ.length === 0, differ);
    const english = ['de', 'hu', 'it'].flatMap((lang) => PARTS.filter((part) => !own(lang, part)?.trim() || own(lang, part) === own('en', part)).map((part) => `${lang}:${part}`));
    check('…and German, Hungarian and Italian have their own, never English', english.length === 0, english);
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
