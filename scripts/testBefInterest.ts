/**
 * The BEF module's Interest page: what its form reads, which limits it refuses
 * before signing, how it signs and sends, and how every answer is said.
 *   npx tsx scripts/testBefInterest.ts
 *   BEF_EXPLORER_DIR=/path/to/bef-explorer npx tsx scripts/testBefInterest.ts
 *   npx tsx scripts/testBefInterest.ts --without-bef   (on purpose, with no bef-explorer)
 *
 * Where bef-explorer is at hand (next to this repo, or BEF_EXPLORER_DIR), the
 * page's send runs against BEF Explorer's OWN app — its real interest route,
 * limits and clock checks — started in this process on 127.0.0.1 with an
 * in-memory database, a session made directly in it (no Registrar) and a
 * publisher that lives in memory (no relay). Without it that part says
 * "skipped", the rest still runs, and the run fails unless --without-bef was
 * given: a green run has compared this build with BEF.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyEvent } from 'nostr-tools/pure';
import { BefApiError, createBefClient, type InterestView, type InterestWindow, type InterestWindows } from '../src/lib/bef/api.js';
import { signInterest, type BefKey } from '../src/lib/bef/signing.js';
import { checkInterestLimits, limitsFromWindow, type InterestDraft } from '../src/lib/bef/vendor/server/lib/interestEvent.ts';
import { setFormatLocale } from '../src/lib/bef/vendor/src/lib/format.ts';
import {
  anyRoundOpen,
  arrivedInterest,
  beyondLimits,
  blankEditor,
  defaultCurrency,
  droppedRounds,
  interestSendProblem,
  limitMessage,
  prefillEditor,
  readInterestForm,
  sendInterest,
  visibleWindows,
  withdrawalDraft,
  type InterestEditor,
} from '../src/components/bef/interest/interestModel.js';
import befInterestText from '../src/i18n/modules/befInterest.js';
import { befDir, ROOT } from './syncBef.js';

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
const HAVE_BEF = existsSync(path.join(BEF, 'server/tests/personHelpers.ts'));
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
const codeOf = (err: unknown) => (err instanceof BefApiError ? err.code : String(err));

/** The page's own files: the page, its components, its words. */
const PAGE_FILES = [
  'src/pages/bef/BefInterest.tsx',
  ...readdirSync(path.join(ROOT, 'src/components/bef/interest')).map((f) => `src/components/bef/interest/${f}`),
  'src/i18n/modules/befInterest.ts',
].filter((rel) => statSync(path.join(ROOT, rel)).isFile());

const en = befInterestText.en as Record<string, string>;

/* ── a window as BEF sends it: Split 9 open in rounds 1 and 2 ─────────── */

const P = 'a'.repeat(64);
const WALLET = 'LTestWalletAddressForInterest0000';
const amounts = (EUR: number | null, GBP: number | null = null, USD: number | null = null) => ({ EUR, GBP, USD });
const WIN9: InterestWindow = {
  split: 9,
  scope: 'current',
  open: true,
  rounds: [
    // R1 EUR: 6000 per person is more than the 5000 round — the round size binds.
    { round: 1, open: true, size: amounts(5000, 3000), perPerson: amounts(6000) },
    // R2 EUR: 4000 per person is less than the 10000 round — it binds.
    { round: 2, open: true, size: amounts(10000), perPerson: amounts(4000) },
    // R3: not offered (0), and not open.
    { round: 3, open: false, size: amounts(0), perPerson: amounts(null) },
  ],
  capacity: amounts(8000, null),
};
const WIN10: InterestWindow = { split: 10, scope: 'next', open: false, rounds: [1, 2, 3].map((round) => ({ round, open: false, size: amounts(20000), perPerson: amounts(null) })), capacity: amounts(null) };
const WINDOWS: InterestWindows = { currentSplit: 9, paramsEventId: P, windows: [WIN10, WIN9] };
const editor = (typed: Record<number, string>, patch: Partial<InterestEditor> = {}): InterestEditor => ({ currency: 'EUR', amounts: typed, editing: false, tried: false, ...patch });
const view = (split: number, rounds: { round: number; amount: number }[], status: 'active' | 'withdrawn' = 'active', patch: Partial<InterestView> = {}): InterestView => ({
  split,
  currency: 'EUR',
  rounds,
  total: rounds.reduce((s, r) => s + r.amount, 0),
  status,
  eventId: 'e'.repeat(64),
  createdAt: 1_757_000_000,
  receivedAt: '2026-09-15T10:00:00Z',
  relaysAccepted: 4,
  relaysTotal: 4,
  ...patch,
});

/** A throwaway key; the address is BEF's own reading of it when bef-explorer is at hand. */
async function throwawayKey(): Promise<BefKey> {
  const priv = randomBytes(32);
  const publicKey = bytesToHex(secp256k1.getPublicKey(priv, true));
  const hex = publicKey.slice(2);
  let address = WALLET;
  if (HAVE_BEF) {
    const { addressesForSigner } = await bef('server/lib/lanaAddress.ts');
    address = addressesForSigner(publicKey, hex).compressed;
  }
  return { hex, privateKeyHex: priv.toString('hex'), publicKey, address };
}

async function main() {
  setFormatLocale('en-GB');

  /* ─────────────────────────────────────────────────────────────── form ── */
  console.log('— the form reads whole amounts, only where a round is open and offered —');
  {
    const form = readInterestForm(WIN9, editor({ 1: '5.000', 2: '1 500', 3: '900' }), WALLET, P);
    check('grouped amounts are thousands; a closed round is left out', JSON.stringify(form.draft.rounds) === JSON.stringify([{ round: 1, amount: 5000 }, { round: 2, amount: 1500 }]), form.draft.rounds);
    check('the draft is active, for the wallet and the params it was read with', form.draft.status === 'active' && form.draft.wallet === WALLET && form.draft.paramsEventId === P && form.draft.split === 9);
    const decimal = readInterestForm(WIN9, editor({ 1: '12.5', 2: '100,50' }), WALLET, P);
    check('a decimal is refused, never rounded', JSON.stringify(decimal.notWhole) === '[1,2]' && decimal.draft.rounds.length === 0, decimal);
    const gbp = readInterestForm(WIN9, editor({ 1: '100', 2: '200' }, { currency: 'GBP' }), WALLET, P);
    check('a round not offered in the currency is left out whatever was typed', JSON.stringify(gbp.draft.rounds) === JSON.stringify([{ round: 1, amount: 100 }]), gbp.draft.rounds);
    const empty = readInterestForm(WIN9, editor({ 1: '', 2: '   ' }), WALLET, P);
    check('nothing typed: no rounds, nothing wrong yet', empty.draft.rounds.length === 0 && empty.notWhole.length === 0 && empty.limitErrors.length === 0);
  }

  console.log('— the limits are BEF’s, checked before signing —');
  {
    const over = readInterestForm(WIN9, editor({ 1: '5001', 2: '4001' }), WALLET, P);
    check('round size binds where it is the smaller', over.limitErrors.some((e) => e.code === 'round_above_size' && e.round === 1 && e.limit === 5000), over.limitErrors);
    check('the per-person maximum binds where it is the smaller', over.limitErrors.some((e) => e.code === 'round_above_person_max' && e.round === 2 && e.limit === 4000), over.limitErrors);
    check('one error per round, against the limit that binds', over.limitErrors.filter((e) => 'round' in e && e.round === 1).length === 1);
    const capacity = readInterestForm(WIN9, editor({ 1: '5000', 2: '3500' }), WALLET, P);
    check('the split co-creation maximum binds the total', JSON.stringify(capacity.limitErrors) === JSON.stringify([{ code: 'total_above_capacity', limit: 8000 }]), capacity.limitErrors);
    const fits = readInterestForm(WIN9, editor({ 1: '5000', 2: '3000' }), WALLET, P);
    check('what fits has no errors', fits.limitErrors.length === 0 && fits.notWhole.length === 0, fits);
    check('the form’s check IS checkInterestLimits over limitsFromWindow', JSON.stringify(over.limitErrors) === JSON.stringify(checkInterestLimits(over.draft, limitsFromWindow(WIN9, 'EUR'))));
    for (const e of [...over.limitErrors, ...capacity.limitErrors, { code: 'round_not_open' as const, round: 3 }, { code: 'round_not_offered' as const, round: 3 }]) {
      const message = limitMessage(e, 'EUR');
      let text = en[message.key] ?? '';
      for (const [k, v] of Object.entries(message.vars)) text = text.split(`{${k}}`).join(String(v));
      check(`limit ${e.code}: BEF’s words, every placeholder filled`, !!en[message.key] && !/\{\w+\}/.test(text), { key: message.key, text });
    }
    check('limit amounts are money in the currency', limitMessage({ code: 'round_above_size', round: 1, limit: 5000 }, 'GBP').vars.limit === '£5,000');
  }

  console.log('— which splits get a card, and what the calculator fills in —');
  {
    check('anyRoundOpen', anyRoundOpen(WINDOWS) === true && anyRoundOpen({ ...WINDOWS, windows: [WIN10] }) === false);
    check('only the open split, sorted', JSON.stringify(visibleWindows(WINDOWS, [], []).map((w) => w.split)) === '[9]');
    check('a closed split with an active interest keeps its card (it can be withdrawn)', JSON.stringify(visibleWindows(WINDOWS, [view(10, [{ round: 1, amount: 5 }])], []).map((w) => w.split)) === '[9,10]');
    check('a closed split with a withdrawn interest does not', JSON.stringify(visibleWindows(WINDOWS, [view(10, [], 'withdrawn')], []).map((w) => w.split)) === '[9]');
    check('a closed split keeps its card while its refusal is shown', JSON.stringify(visibleWindows(WINDOWS, [], [10]).map((w) => w.split)) === '[9,10]');

    check('default currency: GB → GBP, US → USD, else EUR', defaultCurrency('GB') === 'GBP' && defaultCurrency('US') === 'USD' && defaultCurrency('SI') === 'EUR' && defaultCurrency(null) === 'EUR');
    check('a blank editor takes the held interest’s currency', blankEditor(view(9, [{ round: 1, amount: 1 }], 'active', { currency: 'USD' }), 'EUR').currency === 'USD' && blankEditor(undefined, 'GBP').currency === 'GBP');
    const filled = prefillEditor({ split: 9, currency: 'GBP', round: 2, amount: 2500 }, WINDOWS, [], 'EUR');
    check('prefill: the split, currency, and the amount in its round', filled?.split === 9 && filled.editor.currency === 'GBP' && JSON.stringify(filled.editor.amounts) === '{"2":"2500"}', filled);
    check('prefill: no currency → the person’s', prefillEditor({ split: 9, currency: null, round: 1, amount: 10 }, WINDOWS, [], 'USD')?.editor.currency === 'USD');
    check('prefill: a round not open gets no amount', JSON.stringify(prefillEditor({ split: 9, currency: 'EUR', round: 3, amount: 10 }, WINDOWS, [], 'EUR')?.editor.amounts) === '{}');
    check('prefill: never into a closed split', prefillEditor({ split: 10, currency: 'EUR', round: 1, amount: 10 }, WINDOWS, [], 'EUR') === null);
    check('prefill: never over an active interest', prefillEditor({ split: 9, currency: 'EUR', round: 1, amount: 10 }, WINDOWS, [view(9, [{ round: 1, amount: 1 }])], 'EUR') === null);
    check('prefill: over a withdrawn one is fine', prefillEditor({ split: 9, currency: 'EUR', round: 1, amount: 10 }, WINDOWS, [view(9, [], 'withdrawn')], 'EUR') !== null);
    check('prefill: no split, nothing', prefillEditor({ split: null, currency: 'EUR', round: 1, amount: 10 }, WINDOWS, [], 'EUR') === null);
  }

  console.log('— a change says what it drops; a held interest says what it no longer fits —');
  {
    const held = view(9, [{ round: 1, amount: 4000 }, { round: 3, amount: 700 }]);
    const dropped = droppedRounds(held, WIN9, 'EUR');
    check('a round closed since is dropped (as closed)', JSON.stringify(dropped) === JSON.stringify([{ round: 3, amount: 700, stillOpen: false }]), dropped);
    const inGbp = droppedRounds(view(9, [{ round: 2, amount: 100 }]), WIN9, 'GBP');
    check('a round not offered in the new currency is dropped (as not offered)', JSON.stringify(inGbp) === JSON.stringify([{ round: 2, amount: 100, stillOpen: true }]), inGbp);
    const beyond = beyondLimits(view(9, [{ round: 2, amount: 4500 }]), WIN9, WALLET, P);
    check('a held interest above a lower maximum is said, not refused', JSON.stringify(beyond) === JSON.stringify([{ code: 'round_above_person_max', round: 2, limit: 4000 }]), beyond);
    const closedRound = beyondLimits(view(9, [{ round: 1, amount: 100 }]), { ...WIN9, open: false, rounds: WIN9.rounds.map((r) => ({ ...r, open: false })) }, WALLET, P);
    check('a round closed for new interest does not make a held one too large', closedRound.length === 0, closedRound);
    check('a withdrawn interest fits nothing to check', beyondLimits(view(9, [], 'withdrawn'), WIN9, WALLET, P).length === 0);
    const withdrawal = withdrawalDraft(view(9, [{ round: 1, amount: 1 }], 'active', { currency: 'GBP' }), WALLET, P);
    check('a withdrawal: no rounds, the held currency', withdrawal.status === 'withdrawn' && withdrawal.rounds.length === 0 && withdrawal.currency === 'GBP');
  }

  /* ─────────────────────────────────────────────────────────────── send ── */
  console.log('— sending: limits before signing, BEF’s clock, a newer created_at —');
  {
    const key = await throwawayKey();
    const person = { hex: key.hex, name: 'Ana Novak', displayName: 'Ana Novak', country: 'SI', wallet: key.address };
    const log: string[] = [];
    const submitted: any[] = [];
    const serverNow = 1_800_000_000;
    let refuse: string[] = [];
    const client = {
      serverNowSeconds: () => serverNow,
      person: {
        me: async (token: string) => {
          log.push(`me:${token}`);
          return { hex: key.hex, expiresAt: 0, serverTime: serverNow, person };
        },
      },
      interest: {
        submit: async (token: string, event: any) => {
          log.push(`submit:${token}`);
          submitted.push(event);
          const code = refuse.shift();
          if (code) throw new BefApiError(code, 400, { error: code });
          return { interest: view(event.tags[1][1] * 1, [], 'active', { eventId: event.id, createdAt: event.created_at }), relays: { accepted: 3, total: 4 } };
        },
      },
    } as any;
    const auth = { token: 't1', key, person };
    const withSession = async <T,>(fn: (a: typeof auth) => Promise<T>) => fn(auth);
    const reset = () => {
      log.length = 0;
      submitted.length = 0;
      refuse = [];
    };
    const draftOf = (typed: Record<number, string>) => readInterestForm(WIN9, editor(typed), 'LSomeOtherFormOfTheWalletxxxxxxxxx', P).draft;

    const over = await throws(() => sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '9000' }) }));
    check('above a limit: refused as limits, with the errors', codeOf(over) === 'limits' && (over as BefApiError).body.errors?.[0]?.code === 'round_above_size', over);
    check('above a limit: nothing asked, signed or sent', log.length === 0 && submitted.length === 0, log);
    const none = await throws(() => sendInterest({ client, withSession, win: WIN9, draft: draftOf({}) }));
    check('no amount: refused, nothing sent', codeOf(none) === 'active_without_rounds' && log.length === 0);
    const withRounds = await throws(() => sendInterest({ client, withSession, win: WIN9, draft: { ...draftOf({ 1: '10' }), status: 'withdrawn' } }));
    check('a withdrawal carrying rounds: refused, nothing sent', codeOf(withRounds) === 'withdrawn_with_rounds' && log.length === 0);

    reset();
    const signed: string[] = [];
    const ok = await sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }), onSigned: (id) => signed.push(id) });
    const event = submitted[0];
    check('me first (session and clock), then one submit', log.join() === 'me:t1,submit:t1', log);
    check('the event verifies and is the person’s', verifyEvent(event) && event.pubkey === key.hex && event.kind === 30970);
    check('signed for the wallet BEF signed the person in with', event.tags.find((t: string[]) => t[0] === 'wallet')?.[1] === key.address);
    check('created_at is BEF’s now with no previous', event.created_at === serverNow);
    check('onSigned names the event sent', JSON.stringify(signed) === JSON.stringify([event.id]));
    check('the answer is BEF’s', ok.relays.accepted === 3 && ok.relays.total === 4);

    reset();
    await sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }), previous: { createdAt: serverNow } });
    check('a change in the same second is one second newer', submitted[0].created_at === serverNow + 1, submitted[0].created_at);
    reset();
    await sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }), previous: { createdAt: (serverNow + 5) * 1000 } });
    check('a previous one in milliseconds, ahead of the clock, is still passed', submitted[0].created_at === serverNow + 6, submitted[0].created_at);
    reset();
    await sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }), previous: { createdAt: serverNow - 100 } });
    check('an older previous one leaves BEF’s now', submitted[0].created_at === serverNow);

    reset();
    const withdrawal = withdrawalDraft(view(9, [{ round: 1, amount: 99999 }]), key.address, P);
    const withdrawn = await throws(() => sendInterest({ client, withSession, win: { ...WIN9, open: false, rounds: [] }, draft: withdrawal, previous: { createdAt: serverNow } }));
    check('a withdrawal is never held to limits, even with every round closed', withdrawn === null && submitted.length === 1 && submitted[0].tags.find((t: string[]) => t[0] === 'status')[1] === 'withdrawn');

    reset();
    refuse = ['stale_clock'];
    let tick = 0;
    client.serverNowSeconds = () => (tick++ === 0 ? serverNow - 3600 : serverNow);
    const retried = await throws(() => sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }) }));
    check('stale_clock: the clock is read again and it is signed again, once', retried === null && log.join() === 'me:t1,submit:t1,me:t1,submit:t1' && submitted[0].created_at === serverNow - 3600 && submitted[1].created_at === serverNow && submitted[0].id !== submitted[1].id, { log, at: submitted.map((e) => e.created_at) });
    client.serverNowSeconds = () => serverNow;
    reset();
    refuse = ['stale_clock', 'stale_clock', 'stale_clock'];
    const twice = await throws(() => sendInterest({ client, withSession, win: WIN9, draft: draftOf({ 1: '1000' }) }));
    check('stale_clock twice: said, not a third try', codeOf(twice) === 'stale_clock' && submitted.length === 2, submitted.length);

    reset();
    const otherMe = { ...client, person: { me: async () => ({ hex: 'f'.repeat(64), expiresAt: 0, serverTime: serverNow, person }) } };
    const changed = await throws(() => sendInterest({ client: otherMe, withSession, win: WIN9, draft: draftOf({ 1: '1000' }) }));
    check('BEF names another person for the token: nothing signed or sent', codeOf(changed) === 'account_changed' && submitted.length === 0);

    reset();
    // The provider replaces a session BEF no longer knows and runs the call once
    // more: the event is built and signed again, with the new token.
    let lost = true;
    const renewing = async <T,>(fn: (a: typeof auth) => Promise<T>) => {
      try {
        return await fn(auth);
      } catch (err) {
        if (!(err instanceof BefApiError && err.code === 'not_signed_in')) throw err;
        return fn({ ...auth, token: 't2' });
      }
    };
    const expiring = {
      ...client,
      person: {
        me: async (token: string) => {
          log.push(`me:${token}`);
          if (token === 't1' && lost) {
            lost = false;
            throw new BefApiError('not_signed_in', 401);
          }
          return { hex: key.hex, expiresAt: 0, serverTime: serverNow, person };
        },
      },
    };
    await sendInterest({ client: expiring, withSession: renewing, win: WIN9, draft: draftOf({ 1: '1000' }) });
    check('a lost session: the whole call runs again on the new token', log.join() === 'me:t1,me:t2,submit:t2' && submitted.length === 1, log);
  }

  console.log('— every answer has words, and says what to read again —');
  {
    const said = (code: string, status = 409, body: Record<string, unknown> = {}) => interestSendProblem(new BefApiError(code, status, body as any), 'EUR');
    const cases: [string, string, 'windows' | 'mine' | null][] = [
      ['params_changed', 'interest.err.params_changed', 'windows'],
      ['window_closed', 'interest.err.window_closed', 'windows'],
      ['split_not_available', 'interest.err.split_not_available', 'windows'],
      ['stale_event', 'interest.err.stale_event', 'mine'],
      ['nothing_to_withdraw', 'interest.err.nothing_to_withdraw', 'mine'],
      ['outcome_unknown', 'interest.outcomeUnknown', 'mine'],
      ['relay_writes_disabled', 'interest.relayWritesOff', null],
      ['stale_clock', 'interest.err.stale_clock', null],
      ['no_parameters', 'interest.noParameters', null],
      ['rate_limited', 'person.err.rateLimited', null],
      ['network', 'door.unreachable', null],
      ['timeout', 'person.err.network', null],
      ['key_unreadable', 'door.keyUnreadable', null],
      ['wallet_mismatch', 'door.keyUnreadable', null],
    ];
    for (const [code, text, reload] of cases) {
      const p = said(code);
      check(`${code} → ${text}${reload ? ` (reads ${reload} again)` : ''}`, p.text === text && p.reload === reload && !!en[p.text], p);
    }
    const limits = said('limits', 422, { errors: [{ code: 'round_above_size', round: 1, limit: 5 }] });
    check('limits: BEF’s errors, listed in the currency sent', limits.text === 'interest.err.limits' && limits.limits?.length === 1 && limits.currency === 'EUR');
    // BEF ahead of this build: a limit code the vendored copy does not know. The
    // card's problem box says every entry with limitMessage, as here — an entry
    // with no words would take the whole page down.
    const ahead = said('limits', 422, {
      errors: [
        { code: 'total_above_person_max', limit: 9000 },
        { code: 'params_changed', round: 2 },
        { code: 'round_not_open', round: 3 },
      ],
    });
    const aheadLines = (ahead.limits ?? []).map((e) => {
      const message = limitMessage(e, ahead.currency ?? 'EUR');
      let text = message ? en[message.key] ?? '' : '';
      for (const [k, v] of Object.entries(message?.vars ?? {})) text = text.split(`{${k}}`).join(String(v));
      return { key: message?.key, text };
    });
    check('a limit code this build does not know still has words', aheadLines.length === 3 && aheadLines.every((l) => !!l.text && !/\{\w+\}/.test(l.text)), aheadLines);
    check('…a plain refusal when this build has none for it', aheadLines[0]?.key === 'interest.err.rejected', aheadLines[0]);
    check('…BEF’s own words when this build has them, as BEF’s limitText does', aheadLines[1]?.key === 'interest.err.params_changed', aheadLines[1]);
    check('…and the known ones are said as before', aheadLines[2]?.key === 'interest.err.round_not_open' && aheadLines[2].text.includes('3'), aheadLines[2]);
    const failed = said('publish_failed', 502, { accepted: 1, total: 4 });
    check('publish_failed: N of M', failed.vars?.accepted === 1 && failed.vars?.total === 4 && en[failed.text].includes('{accepted}'));
    check('bad_event: this build is behind BEF, with its link', said('bad_event', 400).openBef === true && said('bad_event', 400).text === 'door.behind');
    check('an unknown 500: busy, not "report it"', said('http_500', 500).text === 'person.err.busy');
    const unknown = said('something_new', 400);
    check('an unknown refusal: report it, with the code', unknown.text === 'door.generic' && unknown.vars?.code === 'something_new');
    check('a thrown non-BEF error: network', interestSendProblem(new TypeError('x'), 'EUR').text === 'door.unreachable');
    check('no answer: befexplorer.com offered too (BEF not letting this app in looks the same)', said('network', 0).openBef === true && said('timeout', 0).openBef !== true);

    const mine = [view(9, [{ round: 1, amount: 1 }], 'active', { eventId: 'b'.repeat(64) }), view(10, [], 'withdrawn', { eventId: 'c'.repeat(64) })];
    check('arrived: the signed event is what BEF holds', arrivedInterest(mine, 9, ['x', 'b'.repeat(64)])?.eventId === 'b'.repeat(64));
    check('not arrived: BEF holds another event', arrivedInterest(mine, 9, ['x']) === null && arrivedInterest(null, 9, ['b'.repeat(64)]) === null);
    check('not arrived: the event is held for another split', arrivedInterest(mine, 10, ['b'.repeat(64)]) === null);
  }

  /* ─────────────────────────────────────────────────────────────── words ── */
  console.log('— the page’s words exist, in every language —');
  {
    const langs = ['sl', 'de', 'hu', 'it'] as const;
    const ownText = read('src/i18n/modules/befInterest.ts');
    const ownKeys = [...(/const befInterest = \{([\s\S]*?)\} as const;/.exec(ownText)?.[1] ?? '').matchAll(/"([a-zA-Z.]+)":/g)].map((m) => m[1]);
    check('own keys read', ownKeys.length >= 2, ownKeys);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const lang of langs) {
      const dict = befInterestText[lang] as Record<string, string> | undefined;
      const missing = ownKeys.filter((k) => !dict?.[k]);
      check(`${lang}: every own key`, missing.length === 0, missing);
      const wrongHoles = ownKeys.filter((k) => dict?.[k] && holes(dict[k]) !== holes(en[k]));
      check(`${lang}: the same placeholders as English`, wrongHoles.length === 0, wrongHoles);
    }
    const used = new Set<string>();
    for (const rel of PAGE_FILES.filter((f) => /\.tsx?$/.test(f) && !f.includes('i18n'))) {
      for (const m of read(rel).matchAll(/["'`]((?:interest|door|reg|person|common)\.[A-Za-z_.]+)["'`]/g)) used.add(m[1]);
    }
    const unknown = [...used].filter((k) => !en[k]);
    check(`every key the page uses has English words (${used.size} keys)`, used.size > 40 && unknown.length === 0, unknown);
  }

  console.log('— safe display, no promise vocabulary —');
  {
    const offenders = PAGE_FILES.filter((rel) => /dangerouslySetInnerHTML|innerHTML/.test(read(rel)));
    check('no HTML injected', offenders.length === 0, offenders);
    check('no key typed or stored: no WIF field, no storage write', PAGE_FILES.every((rel) => !/lanaPrivateKey|nostrPrivateKey|setItem\(/.test(read(rel))));
    let banned: RegExp[] = [
      /guaranteed\s+(return|profit|resale|buyback|liquidity|exit|price)/i,
      /expected\s+return/i,
      /\byou\s+will\s+(earn|profit|gain)\b/i,
      /risk[-\s]free/i,
      /\bbest\s+investment\b/i,
      /recommended\s+(round|company|investment)/i,
    ];
    if (HAVE_BEF) {
      const list = /const BANNED = \[([\s\S]*?)\n\];/.exec(readFileSync(path.join(BEF, 'server/tests/copy.test.ts'), 'utf8'))?.[1] ?? '';
      const fromBef = [...list.matchAll(/^\s*\/(.+)\/([a-z]*),\s*$/gm)].map((m) => new RegExp(m[1], m[2]));
      if (fromBef.length) banned = fromBef;
    }
    const found: string[] = [];
    for (const rel of PAGE_FILES) {
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
    check(`nothing assertive found (${banned.length} patterns, ${PAGE_FILES.length} files)`, found.length === 0, found);
  }

  /* ──────────────────────────────────────────────── against BEF’s own route ── */
  console.log('— against BEF Explorer’s own interest route (fake publisher, no Registrar) —');
  if (HAVE_BEF) {
    const helpers = await bef('server/tests/personHelpers.ts');
    const { createApp } = await bef('server/app.ts');
    const { createPersonSession, upsertPerson } = await bef('server/lib/personStore.ts');

    const db = helpers.freshDb();
    let params = helpers.insertKind38888(db, {
      split: '9',
      createdAt: 1757000000,
      splitRounds: {
        current: [
          { round: 1, currency: 'EUR', size: 5000, buy_fee_percent: 20, sell_fee_percent: 20 },
          { round: 2, currency: 'EUR', size: 10000, buy_fee_percent: 20, sell_fee_percent: 20 },
          { round: 3, currency: 'EUR', size: 0, buy_fee_percent: 20, sell_fee_percent: 20 },
        ],
        next: [{ round: 1, currency: 'EUR', size: 20000, buy_fee_percent: 20, sell_fee_percent: 20 }],
      },
      maxInvestment: { current: { EUR: 12000 }, next: { EUR: 50000 } },
      maxPerPerson: { current: [{ round: 2, currency: 'EUR', amount: 4000 }], next: [] },
      interestOpen: { current: [1, 2], next: [] },
    });
    const publisher = helpers.fakePublisher();
    const listen = async (relayWrites: boolean) => {
      const app = createApp(db, helpers.SITE, { publisher: publisher.publish, relayWrites, personRateLimit: { challenge: 100000, post: 100000, cardStatus: 100000 }, log: () => {} });
      const server = await new Promise<any>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
    };
    const live = await listen(true);
    const off = await listen(false);

    try {
      const key = await throwawayKey();
      upsertPerson(db, { hex: key.hex, wallet: key.address, name: 'Ana Novak', displayName: 'Ana Novak', details: { country: 'SI', email: 'ana@example.com', phone: '41123456', phoneCountryCode: '+386', lanaWalletID: key.address, eventId: 'e'.repeat(64), createdAt: 1 } });
      const { token } = createPersonSession(db, key.hex, key.address);
      const person = { hex: key.hex, name: 'Ana Novak', displayName: 'Ana Novak', country: 'SI', wallet: key.address };

      const bodies: string[] = [];
      let dropNextInterestAnswer = false;
      const fetchImpl: typeof fetch = async (input, init) => {
        if (typeof init?.body === 'string') bodies.push(init.body);
        const res = await fetch(input, init);
        // BEF did it, but the answer is lost on the way back (a proxy that gave up).
        if (dropNextInterestAnswer && String(input).endsWith('/api/interest') && init?.method === 'POST') {
          dropNextInterestAnswer = false;
          await res.text();
          throw new TypeError('fetch failed');
        }
        return res;
      };
      const clientFor = (base: string) => createBefClient({ base, fetchImpl });
      const client = clientFor(live.base);
      const auth = { token, key, person };
      const withSession = async <T,>(fn: (a: typeof auth) => Promise<T>) => fn(auth);
      const heldCreatedAt = () => (db.prepare('SELECT event_created_at AS at, status FROM interests WHERE hex = ? AND split_number = 9').get(key.hex) as { at: number; status: string } | undefined);

      const windows = await client.interest.windows();
      const win9 = windows.windows.find((w) => w.split === 9)!;
      check('windows: Split 9 open in rounds 1 and 2, with BEF’s limits', win9.open && win9.rounds.filter((r) => r.open).map((r) => r.round).join() === '1,2' && win9.rounds[1].perPerson?.EUR === 4000, win9);

      const typed = (t: Record<number, string>, w = win9, p = windows.paramsEventId) => readInterestForm(w, editor(t), person.wallet, p);

      // Parity: what the page refuses before signing is exactly what BEF refuses after.
      const overForm = typed({ 1: '6000', 2: '4500' });
      const direct = await throws(async () => {
        await client.person.me(token);
        return client.interest.submit(token, signInterest(key, overForm.draft, client.serverNowSeconds()));
      });
      check('BEF refuses the same limits the page finds before signing', codeOf(direct) === 'limits' && JSON.stringify((direct as BefApiError).body.errors) === JSON.stringify(overForm.limitErrors), { server: (direct as BefApiError)?.body?.errors, page: overForm.limitErrors });
      check('…and nothing reached the publisher', publisher.published.length === 0);
      const refusedFirst = await throws(() => sendInterest({ client, withSession, win: win9, draft: overForm.draft }));
      check('the page itself never sends it', codeOf(refusedFirst) === 'limits' && publisher.published.length === 0);

      const signed: string[] = [];
      const sent = await sendInterest({ client, withSession, win: win9, draft: typed({ 1: '5.000', 2: '1500' }).draft, onSigned: (id) => signed.push(id) });
      const published = publisher.published[0];
      check('send: BEF took it, 4 of 4 relays', sent.relays.accepted === 4 && sent.relays.total === 4 && sent.interest.status === 'active' && sent.interest.total === 6500, sent);
      check('send: the published KIND 30970 is the signed one, client befexplorer.com, params and wallet', published?.id === signed[0] && published.kind === 30970 && published.tags.some((t: string[]) => t[0] === 'client' && t[1] === 'befexplorer.com') && published.tags.some((t: string[]) => t[0] === 'params' && t[1] === params) && published.tags.some((t: string[]) => t[0] === 'wallet' && t[1] === key.address));
      const mine1 = await client.interest.mine(token);
      check('mine: the interest, with its relay count', mine1.interests.length === 1 && mine1.interests[0].eventId === signed[0] && mine1.interests[0].relaysAccepted === 4, mine1);

      const change = await sendInterest({ client, withSession, win: win9, draft: typed({ 1: '2000' }).draft, previous: sent.interest });
      check('change right after: accepted, one second newer at least', change.interest.total === 2000 && change.interest.createdAt > sent.interest.createdAt, [sent.interest.createdAt, change.interest.createdAt]);
      const noPrevious = await throws(() => sendInterest({ client, withSession, win: win9, draft: typed({ 1: '3000' }).draft }));
      check('without the previous created_at BEF refuses stale_event — why it is passed', codeOf(noPrevious) === 'stale_event', codeOf(noPrevious));
      const withdrawn = await sendInterest({ client, withSession, win: win9, draft: withdrawalDraft(change.interest, person.wallet, windows.paramsEventId), previous: change.interest });
      check('withdraw right after: accepted, held as withdrawn', withdrawn.interest.status === 'withdrawn' && heldCreatedAt()?.status === 'withdrawn');
      const again = await throws(() => sendInterest({ client, withSession, win: win9, draft: withdrawalDraft(change.interest, person.wallet, windows.paramsEventId), previous: withdrawn.interest }));
      check('withdraw what is withdrawn: nothing_to_withdraw, reads mine again', codeOf(again) === 'nothing_to_withdraw' && interestSendProblem(again, 'EUR').reload === 'mine');

      // stale_clock against BEF's own check: the first signature is an hour behind.
      let first = true;
      const skewed = { ...client, serverNowSeconds: () => (first ? ((first = false), client.serverNowSeconds() - 3600) : client.serverNowSeconds()) };
      const beforeSkew = publisher.published.length;
      const clockFixed = await sendInterest({ client: skewed, withSession, win: win9, draft: typed({ 2: '1000' }).draft, previous: withdrawn.interest });
      check('stale_clock from BEF: signed again on BEF’s clock, accepted, published once', clockFixed.interest.total === 1000 && publisher.published.length === beforeSkew + 1);

      // The limits change: a newer KIND 38888 (a new event id), same rounds open.
      params = helpers.insertKind38888(db, {
        split: '9',
        createdAt: 1757000100,
        splitRounds: { current: [{ round: 1, currency: 'EUR', size: 5000, buy_fee_percent: 20, sell_fee_percent: 20 }, { round: 2, currency: 'EUR', size: 10000, buy_fee_percent: 20, sell_fee_percent: 20 }], next: [] },
        maxInvestment: { current: { EUR: 12000 }, next: {} },
        interestOpen: { current: [1, 2], next: [] },
      });
      const changed = await throws(() => sendInterest({ client, withSession, win: win9, draft: typed({ 1: '1000' }).draft, previous: clockFixed.interest }));
      const changedProblem = interestSendProblem(changed, 'EUR');
      check('params_changed: said, and the limits are read again', codeOf(changed) === 'params_changed' && changedProblem.reload === 'windows');
      const fresh = await client.interest.windows();
      const freshWin = fresh.windows.find((w) => w.split === 9)!;
      check('the windows read again carry the new params', fresh.paramsEventId === params);
      const resent = await sendInterest({ client, withSession, win: freshWin, draft: typed({ 1: '1000' }, freshWin, fresh.paramsEventId).draft, previous: clockFixed.interest });
      check('pressed again with the new limits: accepted', resent.interest.total === 1000);

      // The answer is lost on the way back: it may have gone through.
      dropNextInterestAnswer = true;
      const lateSigned: string[] = [];
      const late = await throws(() => sendInterest({ client, withSession, win: freshWin, draft: typed({ 1: '1200' }, freshWin, fresh.paramsEventId).draft, previous: resent.interest, onSigned: (id) => lateSigned.push(id) }));
      check('a lost answer to a publish: outcome_unknown, mine read again', codeOf(late) === 'outcome_unknown' && interestSendProblem(late, 'EUR').reload === 'mine', codeOf(late));
      const afterLate = (await client.interest.mine(token)).interests;
      check('…and what BEF holds shows it arrived', arrivedInterest(afterLate, 9, lateSigned)?.total === 1200, afterLate);

      publisher.state.accepted = 1;
      const tooFew = await throws(() => sendInterest({ client, withSession, win: freshWin, draft: typed({ 1: '1300' }, freshWin, fresh.paramsEventId).draft, previous: arrivedInterest(afterLate, 9, lateSigned) }));
      const tooFewProblem = interestSendProblem(tooFew, 'EUR');
      check('publish_failed: 1 of 4, nothing kept', codeOf(tooFew) === 'publish_failed' && tooFewProblem.vars?.accepted === 1 && tooFewProblem.vars?.total === 4 && (await client.interest.mine(token)).interests[0].total === 1200);
      publisher.reset();

      const offClient = clientFor(off.base);
      const writesOff = await throws(() => sendInterest({ client: offClient, withSession, win: freshWin, draft: typed({ 1: '1300' }, freshWin, fresh.paramsEventId).draft, previous: arrivedInterest(afterLate, 9, lateSigned) }));
      check('relay writes off on BEF: said as BEF Explorer’s, not "this server"', codeOf(writesOff) === 'relay_writes_disabled' && interestSendProblem(writesOff, 'EUR').text === 'interest.relayWritesOff');

      // Every round closed by a newer KIND 38888: a change is refused, a withdrawal is not.
      params = helpers.insertKind38888(db, { split: '9', createdAt: 1757000200, splitRounds: { current: [{ round: 1, currency: 'EUR', size: 5000, buy_fee_percent: 20, sell_fee_percent: 20 }], next: [] }, interestOpen: { current: [], next: [] } });
      const closed = await client.interest.windows();
      const closedWin = closed.windows.find((w) => w.split === 9)!;
      const held = (await client.interest.mine(token)).interests[0];
      check('closed: the card stays for the active interest', !closedWin.open && visibleWindows(closed, [held], []).some((w) => w.split === 9));
      const closedSend = await throws(() => sendInterest({ client, withSession, win: freshWin, draft: typed({ 1: '100' }, freshWin, fresh.paramsEventId).draft, previous: held }));
      check('a change sent on an old page after closing: window_closed', codeOf(closedSend) === 'window_closed', codeOf(closedSend));
      const lastWithdraw = await sendInterest({ client, withSession, win: closedWin, draft: withdrawalDraft(held, person.wallet, closed.paramsEventId), previous: held });
      check('withdrawal with every round closed: accepted', lastWithdraw.interest.status === 'withdrawn');

      const leaked = bodies.filter((b) => b.includes(key.privateKeyHex));
      check(`no request body carries the private key (${bodies.length} bodies)`, bodies.length > 5 && leaked.length === 0, leaked.length);
    } finally {
      live.close();
      off.close();
    }
  } else {
    skipped('BEF interest route run');
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
