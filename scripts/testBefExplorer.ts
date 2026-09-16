/**
 * The BEF module's Explorer: BEF Explorer's scenario calculator, rebuilt in
 * MejmoSefajn's look. What it works out itself (which rounds are offered, which
 * published limit binds, what "Express interest" carries, how a typed amount
 * reads), what it asks BEF for, and that it shows BEF's words and BEF's
 * numbers — never its own.
 *   npx tsx scripts/testBefExplorer.ts
 *   BEF_EXPLORER_DIR=/path/to/bef-explorer npx tsx scripts/testBefExplorer.ts
 *   npx tsx scripts/testBefExplorer.ts --without-bef   (on purpose, with no bef-explorer)
 *
 * Where bef-explorer is at hand (next to this repo, or BEF_EXPLORER_DIR), BEF's
 * REAL server is started in this process on 127.0.0.1 with an in-memory
 * database of made-up published parameters, and every round, currency and
 * split is asked of it through the module's own client: the rounds the page
 * offers, the limit it names and the amount it refuses must be exactly BEF's.
 * BEF's calculator source is also read, so a change there fails here until the
 * port follows. Without it those parts say "skipped", the rest still runs, and
 * the run fails unless --without-bef was given: a green run has compared this
 * build with BEF.
 *
 * BEF's server is created with its defaults: no Registrar, no relay writes, a
 * publisher that publishes nothing. Nothing leaves this machine.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BefApiError, createBefClient, type Company, type ScenarioResponse, type SplitsResponse } from '../src/lib/bef/api.js';
import { readPrefill } from '../src/lib/bef/prefill.js';
import { offersBef, SCENARIO_PROBLEMS } from '../src/lib/bef/problems.js';
import befVendorTranslations from '../src/i18n/modules/befVendor.js';
import befTranslations from '../src/i18n/modules/bef.js';
import befExplorerTranslations from '../src/i18n/modules/befExplorer.js';
import explorerText, { fillText, hasExplorerText } from '../src/components/bef/explorer/explorerText.js';
import {
  bindingLimit,
  CALC_CURRENCIES,
  CALC_DEFAULTS,
  CALC_ROUNDS,
  companyTradesIn,
  interestQuery,
  loadFigures,
  nextHasAnyPublished,
  offeredRounds,
  parseCalcAmount,
  publishedLimits,
  roundIsOffered,
  runScenario,
  scenarioIsStale,
  type CalcScope,
  type PublishedLimit,
} from '../src/components/bef/explorer/scenarioModel.js';
import { anyBeyondLimit, entryKey, roundsToShow, roundTotals, splitIsEmpty } from '../src/components/bef/explorer/publicInterests.js';
import type { PublicInterestRound, PublicInterestSplit } from '../src/lib/bef/api.js';
import { befDir, ROOT } from './syncBef.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)?.slice(0, 400)}`);
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
const HAVE_BEF = existsSync(path.join(BEF, 'src/components/Calculator.tsx')) && existsSync(path.join(BEF, 'server/tests/personHelpers.ts'));
const bef = async <T,>(rel: string): Promise<T> => import(pathToFileURL(path.join(BEF, rel)).href);

/** What this script uses of BEF's server/tests/personHelpers.ts. */
interface BefTestDb {
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
}
interface BefTestHelpers {
  freshDb: () => BefTestDb;
  insertKind38888: (db: BefTestDb, input: typeof KIND) => string;
  startApp: (deps: Record<string, unknown>, db: BefTestDb) => Promise<{ base: string; close: () => void }>;
}
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const readBef = (rel: string) => readFileSync(path.join(BEF, rel), 'utf8');

/** The Explorer's own files: the page, its components, its texts. */
const EXPLORER_DIR = 'src/components/bef/explorer';
const PAGE = 'src/pages/bef/BefExplorer.tsx';
const EXPLORER_SOURCES = [PAGE, ...readdirSync(path.join(ROOT, EXPLORER_DIR)).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${EXPLORER_DIR}/${f}`)];
const EXPLORER_FILES = [...EXPLORER_SOURCES, 'src/i18n/modules/befExplorer.ts'];

/* ── made-up published parameters, the same for the model and for BEF's server ── */

/** KIND 38888 split 9 as BEF stores it (server/tests/personHelpers.ts insertKind38888). */
const KIND = {
  split: '9',
  splitRounds: {
    current: [
      { round: 1, currency: 'EUR', size: 100000, buy_fee_percent: 20, sell_fee_percent: 22 },
      { round: 2, currency: 'EUR', size: 40000, buy_fee_percent: 20, sell_fee_percent: 25 },
      // Published with no room: shown, not offered.
      { round: 3, currency: 'EUR', size: 0, buy_fee_percent: 20, sell_fee_percent: 25 },
      { round: 1, currency: 'GBP', size: 20000, buy_fee_percent: 18, sell_fee_percent: 21 },
    ],
    next: [{ round: 1, currency: 'EUR', size: 150000, buy_fee_percent: 19, sell_fee_percent: 23 }],
  },
  maxInvestment: { current: { EUR: 90000, GBP: 15000 }, next: { EUR: 140000 } },
  maxPerPerson: {
    current: [
      { round: 2, currency: 'EUR', amount: 3000 },
      // The same as the GBP ceiling: on a tie the ceiling, pushed first, is the limit named.
      { round: 1, currency: 'GBP', amount: 15000 },
    ],
    next: [{ round: 1, currency: 'EUR', amount: 5000 }],
  },
};

/** What BEF's /api/splits answers for KIND (only the fields the calculator reads). */
function splitsFixture(): SplitsResponse {
  const row = (round: number, size: number | null, buy: number | null, sell: number | null, perPerson: number | null = null) => ({
    round, enabled: false, status: 'INDICATIVE', feePercent: sell, buyFeePercent: buy, raisedFiat: null, maxFiat: size,
    sizeIsPublished: size != null, maxPerPerson: perPerson, sizeConflict: false, investors: null, boughtLana: null,
    maxLana: null, percentFilled: null, indicativeReturnPercent: null, offerPrice: null, offerPriceIsPublished: false,
  });
  const planned = (round: number, size: number | null, perPerson: number | null = null) => ({
    round, plannedMaxAmount: size, maxPerPerson: perPerson, buyFeePercent: size != null ? 19 : null, sellFeePercent: size != null ? 23 : null,
    indicativeReturnPercent: null, plannedIsPublished: size != null, status: size != null ? 'INDICATIVE' : 'NOT_ACTIVE',
  });
  return {
    notice: '',
    current: {
      number: 9, status: 'CURRENT', effectiveDate: null, splitApproaching: false,
      maxInvestment: { EUR: 90000, GBP: 15000, USD: null },
      byCurrency: {
        EUR: [row(1, 100000, 20, 22), row(2, 40000, 20, 25, 3000), row(3, 0, 20, 25)],
        GBP: [row(1, 20000, 18, 21, 15000)],
        USD: [],
      },
    },
    next: {
      number: 10, status: 'AWAITING_ACTIVATION', expectedDate: null, expectedDateIsEstimate: true, note: null,
      maxInvestment: { EUR: 140000, GBP: null, USD: null },
      byCurrency: {
        EUR: [planned(1, 150000, 5000), planned(2, null), planned(3, null)],
        GBP: [planned(1, null), planned(2, null), planned(3, null)],
        USD: [planned(1, null), planned(2, null), planned(3, null)],
      },
    },
    historical: [],
    sources: [],
  };
}

const COMBINATIONS = (['current', 'next'] as CalcScope[]).flatMap((scope) =>
  CALC_CURRENCIES.flatMap((currency) => CALC_ROUNDS.map((round) => ({ scope, currency, round }))),
);

async function main() {
  /* ─────────────────────────────────────────────────────────────── amount ── */
  console.log('— a typed amount reads as the reader wrote it —');
  {
    const cases: [string, number][] = [
      ['1000', 1000], ['1,000', 1000], ['1.000', 1000], ['10.000', 10000], ['10 000', 10000], ["10'000", 10000],
      ['1\u00a0000', 1000], ['1,000,000', 1000000], ['1000.5', 1000.5], ['1000,50', 1000.5], ['1.000,50', 1000.5],
      ['1,000.50', 1000.5], ['0,5', 0.5], [' 250 ', 250],
    ];
    for (const [text, expected] of cases) check(`"${text}" is ${expected}`, parseCalcAmount(text) === expected, parseCalcAmount(text));
    for (const text of ['', 'abc', '-5', '1,0000', '1.000.50', '1,000,50', '1.000,5.0', '12e3', '0x10', '1,5,0']) {
      check(`"${text}" is not a number`, Number.isNaN(parseCalcAmount(text)), parseCalcAmount(text));
    }
  }

  /* ─────────────────────────────────────────────────────────────── rounds ── */
  console.log('— only rounds the published parameters cover are offered —');
  {
    const splits = splitsFixture();
    check('current EUR: rounds 1 and 2 (round 3 is published with no room)', JSON.stringify(offeredRounds(splits, 'current', 'EUR')) === '[1,2]');
    check('current GBP: round 1 only', JSON.stringify(offeredRounds(splits, 'current', 'GBP')) === '[1]');
    check('current USD: none', offeredRounds(splits, 'current', 'USD').length === 0);
    check('next EUR: round 1 only', JSON.stringify(offeredRounds(splits, 'next', 'EUR')) === '[1]');
    check('next split offered in EUR, not in GBP', nextHasAnyPublished(splits, 'EUR') && !nextHasAnyPublished(splits, 'GBP'));
    check('before the splits arrive, nothing is known to be missing', CALC_ROUNDS.every((n) => roundIsOffered(null, 'next', 'USD', n)));
    const noFees = splitsFixture();
    noFees.current!.byCurrency.EUR[0].buyFeePercent = null;
    check('a round without its buy fee cannot be calculated', !roundIsOffered(noFees, 'current', 'EUR', 1));
    check('the defaults are BEF’s: 1000 EUR, round 1, the current split', CALC_DEFAULTS.amount === '1000' && CALC_DEFAULTS.currency === 'EUR' && CALC_DEFAULTS.round === 1 && CALC_DEFAULTS.scope === 'current');
  }

  /* ─────────────────────────────────────────────────────────────── limits ── */
  console.log('— the published limit that binds the amount —');
  {
    const splits = splitsFixture();
    const limits = (scope: CalcScope, currency: string, round: number) => publishedLimits(splits, scope, currency, round, 9);
    const summary = (list: PublishedLimit[]) => list.map((l) => `${l.key}:${l.amount}`).join(',');
    check('current EUR 1: split ceiling, round size', summary(limits('current', 'EUR', 1)) === 'calc.limitSplitCeiling:90000,calc.limitRoundSize:100000', summary(limits('current', 'EUR', 1)));
    check('…the ceiling binds', bindingLimit(limits('current', 'EUR', 1))?.amount === 90000);
    check('current EUR 2: the maximum per co-creator binds', bindingLimit(limits('current', 'EUR', 2))?.key === 'calc.limitPerPerson' && bindingLimit(limits('current', 'EUR', 2))?.amount === 3000);
    const tie = bindingLimit(limits('current', 'GBP', 1));
    check('a tie names the limit pushed first (the ceiling), as BEF’s server does', tie?.key === 'calc.limitSplitCeiling' && tie.amount === 15000, tie);
    check('the ceiling label names the split and currency', JSON.stringify(limits('current', 'GBP', 1)[0].vars) === JSON.stringify({ number: 9, currency: 'GBP' }));
    check('a round size of 0 is not a limit', summary(limits('current', 'EUR', 3)) === 'calc.limitSplitCeiling:90000');
    check('next EUR 1: its own ceiling, size and per person', summary(limits('next', 'EUR', 1)) === 'calc.limitSplitCeiling:140000,calc.limitRoundSize:150000,calc.limitPerPerson:5000');
    check('…and the next split’s number in the label', limits('next', 'EUR', 1)[0].vars.number === 10);
    check('no splits: no limits', publishedLimits(null, 'current', 'EUR', 1, 9).length === 0 && bindingLimit([]) === null);
  }

  /* ──────────────────────────────────────────────────── express interest ── */
  console.log('— "Express interest" carries what BEF’s calculator carries —');
  {
    const splits = splitsFixture();
    const q = (scope: CalcScope, amount: string, currentSplit: number | null = 9, s: SplitsResponse | null = splits) =>
      interestQuery({ splits: s, scope, currentSplit, currency: 'GBP', round: 2, amount: parseCalcAmount(amount) });
    check('current: split number, currency, round, whole amount', q('current', '1234.99') === 'split=9&currency=GBP&round=2&amount=1234', q('current', '1234.99'));
    check('next: the next split’s number', q('next', '5000') === 'split=10&currency=GBP&round=2&amount=5000');
    check('next without the splits: the current number + 1', q('next', '5000', 9, null) === 'split=10&currency=GBP&round=2&amount=5000');
    check('no split known: left out', q('current', '5000', null) === 'currency=GBP&round=2&amount=5000');
    check('an amount under 1 or unreadable: left out', q('current', '0,5') === 'split=9&currency=GBP&round=2' && q('current', 'abc') === 'split=9&currency=GBP&round=2');
    check('"10.000" goes as 10000', q('current', '10.000').endsWith('amount=10000'));
    const back = readPrefill(new URLSearchParams(q('next', '7.500')));
    check('the Interest page reads it back exactly', back.split === 10 && back.currency === 'GBP' && back.round === 2 && back.amount === 7500, back);
    const page = read(PAGE);
    check('the page links to /bef/interest with that query', /to=\{\{ pathname: "\/bef\/interest", search: `\?\$\{query\}` \}\}/.test(page));
  }

  /* ─────────────────────────────────────────────────────────── companies ── */
  console.log('— who has already expressed interest: what of BEF’s list is shown —');
  {
    const entry = (patch: Record<string, unknown> = {}) => ({ name: 'Ana Novak', key: 'abcd1234…9f2a', currency: 'EUR' as const, amount: 1000, signedAt: 1_757_000_000, beyondLimit: false, ...patch });
    const round = (n: number, patch: Partial<PublicInterestRound> = {}): PublicInterestRound => ({ round: n, openForInterest: false, entries: [], totals: {}, people: 0, ...patch });
    const busy = round(1, { openForInterest: true, entries: [entry(), entry({ name: null, currency: 'GBP', amount: 50 })], totals: { EUR: 1000, GBP: 50 }, people: 2 });
    const split: PublicInterestSplit = { split: 9, scope: 'current', people: 2, rounds: [busy, round(2, { openForInterest: true }), round(3, { entries: [entry({ amount: 5, beyondLimit: true })], totals: { EUR: 5 }, people: 1 })] };
    check('shown: a round somebody is in, and an open round; not a closed empty one', roundsToShow(split).map((r) => r.round).join() === '1,2,3' && roundsToShow({ ...split, rounds: [busy, round(2), round(3)] }).map((r) => r.round).join() === '1');
    check('a split nobody is in says so instead of empty rounds', splitIsEmpty({ ...split, rounds: [round(1, { openForInterest: true }), round(2)] }) && !splitIsEmpty(split));
    check('totals: per currency, biggest first, never added across currencies', JSON.stringify(roundTotals(busy)) === JSON.stringify([{ currency: 'EUR', amount: 1000 }, { currency: 'GBP', amount: 50 }]) && roundTotals(round(2)).length === 0);
    check('a zero total is not shown as a currency', roundTotals(round(1, { totals: { EUR: 0, GBP: 20 } })).map((t) => t.currency).join() === 'GBP');
    check('the note about the published limit is shown only when somebody is above one', anyBeyondLimit({ splits: [split], paramsEventId: 'x' }) && !anyBeyondLimit({ splits: [{ ...split, rounds: [busy] }], paramsEventId: 'x' }));
    check('two people with no name in the same round are still two rows', entryKey(entry({ name: null }), 0) !== entryKey(entry({ name: null }), 1));
  }

  console.log('— a route lists only companies trading LANA in the currency —');
  {
    const company = (over: Record<string, unknown>) => ({ id: 1, role: 'seller', name: 'X', asset: 'LANA', currency: 'EUR', currencies: ['EUR'], enabled: 1, ...over }) as unknown as Company;
    check('trades in EUR', companyTradesIn(company({}), 'EUR') && !companyTradesIn(company({}), 'GBP'));
    check('several currencies', companyTradesIn(company({ currencies: ['EUR', 'GBP'] }), 'GBP'));
    check('an older answer without currencies: its one currency', companyTradesIn(company({ currencies: undefined, currency: 'USD' }), 'USD'));
    check('another asset or a disabled company: no', !companyTradesIn(company({ asset: 'BTC' }), 'EUR') && !companyTradesIn(company({ enabled: 0 }), 'EUR'));
    check('asset case does not matter', companyTradesIn(company({ asset: 'lana' }), 'EUR'));
  }

  /* ──────────────────────────────────────────────────────── reads (fake) ── */
  console.log('— what the Explorer asks BEF, and what an answer becomes —');
  {
    type Call = { url: string; init: RequestInit };
    const calls: Call[] = [];
    let respond: (call: Call) => Promise<Response> = async () => json({});
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return respond(call);
    }) as unknown as typeof fetch;
    function json(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    const client = createBefClient({ base: 'https://befexplorer.com', fetchImpl: fakeFetch });
    const bootstrap = { ok: true, notice: '', currentSplit: 9, splitApproaching: false, rates: { EUR: 0.128 }, ratesSource: null, settings: { splitMultiplier: 2, carryStatus: 'CONDITIONAL', carryNote: '' }, directFund: null };
    const companies = { companies: [{ id: 1, role: 'seller', name: 'A' }, { id: 2, role: 'treasury', name: 'B' }, { id: 3, role: 'seller', name: 'C' }] };

    respond = async ({ url }) => json(url.endsWith('/api/bootstrap') ? bootstrap : url.endsWith('/api/splits') ? splitsFixture() : companies);
    const loaded = await loadFigures(client);
    check('three reads: bootstrap, splits, companies — nothing else', JSON.stringify(calls.map((c) => c.url).sort()) === JSON.stringify(['https://befexplorer.com/api/bootstrap', 'https://befexplorer.com/api/companies', 'https://befexplorer.com/api/splits']), calls.map((c) => c.url));
    check('…all GET, no token, no cookies', calls.every((c) => c.init.method === 'GET' && !('x-person-token' in (c.init.headers as Record<string, string>)) && c.init.credentials === 'omit'));
    check('sellers and treasuries split by role', 'figures' in loaded && loaded.figures.sellers.map((c) => c.id).join() === '1,3' && loaded.figures.treasuries.map((c) => c.id).join() === '2');

    respond = async ({ url }) => (url.endsWith('/api/bootstrap') ? Promise.reject(new TypeError('Failed to fetch')) : json(splitsFixture()));
    const offline = await loadFigures(client);
    // BEF not letting this app in looks exactly like this in a browser: its refusal
    // carries no CORS header, so fetch throws the same TypeError. The words say both.
    check('no bootstrap: nothing to calculate — "could not be reached", Try again', 'problem' in offline && offline.problem.text === 'door.unreachable' && offline.problem.action === 'retry', offline);
    check('…and befexplorer.com, which still works if BEF does not let this app in', 'problem' in offline && offersBef(offline.problem));
    respond = async ({ url }) => (url.endsWith('/api/bootstrap') ? json(bootstrap) : new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const partial = await loadFigures(client);
    check('no splits and no companies: the calculator still runs, as BEF’s does', 'figures' in partial && partial.figures.splits === null && partial.figures.sellers.length === 0 && partial.figures.treasuries.length === 0, partial);

    const scenario = (over: Partial<ScenarioResponse> = {}) => ({
      notice: '', input: { amount: 10000, currency: 'EUR', round: 1, sellerId: null, treasuryId: null, split: 'current' }, currentSplit: 9, purchaseSplit: 9, saleSplit: 10,
      result: { amount: 10000, rate: 0.128, commissionPercent: 20, splitMultiplier: 2, feePercent: 22, purchasePrice: 0.1536, purchasePriceIsPublished: false, lanaQty: 65104.17, lanaValue: 0, postSplitRate: 0.256, salePrice: 0.19968, salePriceIsPublished: false, saleGross: 0, feeAmount: 0, saleNet: 13000, difference: 3000, differencePercent: 30 },
      statuses: { round: 'CURRENT', carry: 'CONDITIONAL', purchaseLeg: 'COMPUTED', saleLeg: 'COMPUTED', seller: null, treasury: null },
      carryNote: '', limits: { applied: [], binding: null, personLanaCap: null }, assumptions: [], sources: [], ...over,
    });
    const input = { amountText: '10.000', currency: 'EUR', round: 1, scope: 'current' as CalcScope, sellerId: 7, treasuryId: null, binding: null };

    calls.length = 0;
    for (const amountText of ['', '0', '-5', 'abc']) {
      const out = await runScenario(client, { ...input, amountText });
      check(`"${amountText}": enter a positive amount, nothing asked`, out.kind === 'enterPositive' && calls.length === 0, out);
    }
    const binding: PublishedLimit = { key: 'calc.limitSplitCeiling', vars: { number: 9, currency: 'EUR' }, amount: 9000 };
    const over = await runScenario(client, { ...input, binding });
    check('above the binding limit: refused here, nothing asked', over.kind === 'overLimit' && over.limit === binding && calls.length === 0, over);
    const exact = await runScenario(client, { ...input, amountText: '9000', binding });
    check('exactly the limit is asked', exact.kind !== 'overLimit' && calls.length === 1);

    calls.length = 0;
    respond = async () => json(scenario());
    const ok = await runScenario(client, input);
    check('a result, asked exactly as BEF asks', ok.kind === 'result' && calls[0].url === 'https://befexplorer.com/api/scenario?amount=10000&currency=EUR&round=1&split=current&sellerId=7', calls[0]?.url);
    check('…and never with a token', !('x-person-token' in (calls[0].init.headers as Record<string, string>)));

    respond = async () => json({ error: 'amount_above_limit', limit: 5000, limitLabel: 'Round 1 size', currency: 'EUR', limits: [] }, 400);
    const above = await runScenario(client, input);
    check('BEF refusing it as above a limit: the limit BEF named', above.kind === 'aboveLimit' && above.limit === 5000, above);
    respond = async () => json({ error: 'no_round_parameters', split: 'current', round: 1, currency: 'EUR' }, 503);
    const unavailable = await runScenario(client, input);
    check('no published round parameters: BEF’s "not available", Try again', unavailable.kind === 'problem' && unavailable.problem.text === 'calc.unavailableError' && unavailable.problem.action === 'retry', unavailable);
    respond = async () => json({ error: 'bad_amount' }, 400);
    const bad = await runScenario(client, input);
    check('bad_amount: enter a positive amount', bad.kind === 'problem' && bad.problem.text === 'calc.enterPositive', bad);
    respond = async () => new Response('slow down', { status: 429 });
    const limited = await runScenario(client, input);
    check('429: too many attempts', limited.kind === 'problem' && limited.problem.text === 'person.err.rateLimited', limited);
    respond = async () => json({ result: { amount: 'x' } });
    const odd = await runScenario(client, input);
    check('an answer that is not a scenario: "MejmoSefajn is behind BEF Explorer"', odd.kind === 'problem' && odd.problem.text === 'door.behind' && odd.problem.action === 'openBef', odd);

    const shown = scenario() as ScenarioResponse;
    const same = { amountText: '10,000', currency: 'EUR', round: 1, scope: 'current' as CalcScope, sellerId: null, treasuryId: null };
    check('a result for the chosen inputs is not stale', !scenarioIsStale(shown, same));
    check('another amount, currency, round, split or company: stale', ['amountText:10001', 'currency:GBP', 'round:2', 'scope:next', 'sellerId:3', 'treasuryId:4'].every((change) => {
      const [field, value] = change.split(':');
      const changed = { ...same, [field]: /Id$|round/.test(field) ? Number(value) : value };
      return scenarioIsStale(shown, changed);
    }));
    check('no result: nothing is stale', !scenarioIsStale(null, same));
  }

  /* ─────────────────────────────────────────────────────────────── texts ── */
  console.log('— BEF’s words, and the Explorer’s own —');
  {
    const en = explorerText.en as Record<string, string>;
    const vendor = befVendorTranslations.en as Record<string, string>;
    const own = befExplorerTranslations.en as Record<string, string>;
    const used = new Set<string>();
    for (const rel of EXPLORER_SOURCES) {
      for (const m of read(rel).matchAll(/\bt\(\s*"([a-zA-Z][\w.]*)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in en));
    check(`every text the Explorer shows exists (${used.size} keys)`, used.size > 40 && missing.length === 0, missing);
    const unused = Object.keys(own).filter((k) => !used.has(k));
    check('every text of its own is shown', unused.length === 0, unused);
    const shared = Object.keys(own).filter((k) => k in vendor || k in (befTranslations.en as Record<string, string>));
    check('befExplorer.ts shares no key with the module’s texts', shared.length === 0, shared);
    check('every status and assumption BEF names has its words', ['status.CURRENT', 'status.INDICATIVE', 'status.CONDITIONAL', 'status.NOT_ACTIVE', 'assume.saleSettles', 'assume.nextReference'].every(hasExplorerText) && !hasExplorerText('status.SOMETHING_NEW'));
    check('fillText puts a value in exactly as it is', fillText('Max {v} ({c}) {x}', { v: "$&5 $' $$", c: 'USD' }) === "Max $&5 $' $$ (USD) {x}");

    if (HAVE_BEF) {
      const { en: befEn } = await bef<{ en: Record<string, string> }>('src/i18n/en.ts');
      check('the disclaimer is BEF’s site-wide one, word for word', own['explorer.disclaimer'] === befEn['footer.disclaimer'] && own['explorer.disclaimerTitle'] === befEn['footer.disclaimerTitle']);
      const bits = readBef('src/components/Bits.tsx');
      check('"Source:" and "Last checked: … UTC" are BEF’s', bits.includes('<div key={i}>Source: {sourceText(s)}</div>') && bits.includes('parts.push(`Last checked: ${source.fetchedAt} UTC`)') && own['explorer.source'] === 'Source: {source}' && own['explorer.lastChecked'] === 'Last checked: {time} UTC');

      // Every text BEF's calculator page shows is shown here too — or replaced on purpose.
      const REPLACED: Record<string, string> = {
        // BEF's note says it opens a sign-in with the LANA key; here nothing is typed.
        'calc.expressInterestNote': 'explorer.expressInterestNote',
      };
      const befKeys = new Set<string>();
      for (const rel of ['src/pages/CalculatorPage.tsx', 'src/components/Calculator.tsx']) {
        for (const m of readBef(rel).matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)) befKeys.add(m[1]);
      }
      const explorerSource = EXPLORER_SOURCES.map(read).join('\n');
      // A refusal's words come through runScenario from the module's problems table.
      const refusalTexts = new Set<string>(Object.values(SCENARIO_PROBLEMS).map(([text]) => text));
      const notShown = [...befKeys].filter(
        (k) => !explorerSource.includes(`"${k}"`) && !refusalTexts.has(k) && !(REPLACED[k] && explorerSource.includes(`"${REPLACED[k]}"`)),
      );
      check(`every text of BEF’s calculator is on the page (${befKeys.size} keys)`, befKeys.size > 50 && notShown.length === 0, notShown);
      const noWords = [...befKeys].filter((k) => !(k in vendor));
      check('…and every one is in the generated BEF texts', noWords.length === 0, noWords);
    } else {
      skipped('comparison with BEF’s texts');
    }
  }

  /* ─────────────────────────────────────────── BEF’s calculator, as ported ── */
  console.log('— BEF’s calculator still works the way it was ported —');
  if (HAVE_BEF) {
    const calc = readBef('src/components/Calculator.tsx');
    const PORTED = [
      // Calculator.tsx:14, 30-33 — currencies and where the page starts
      "const CURRENCIES = ['EUR', 'GBP', 'USD'];",
      "const [amount, setAmount] = useState('1000');",
      "const [currency, setCurrency] = useState('EUR');",
      'const [round, setRound] = useState(1);',
      "const [scope, setScope] = useState<'current' | 'next'>('current');",
      // :45-66 — which rounds are offered, and moving off one that is not
      "const nextHasAnyPublished = nextRows.some((r) => r.plannedIsPublished);",
      'if (!splits) return true;',
      'return !!row && row.plannedIsPublished && (row.plannedMaxAmount ?? 0) > 0;',
      'return !!row && row.buyFeePercent != null && row.feePercent != null && row.maxFiat !== 0;',
      'if (!selectedIsOffered && firstOffered != null) setRound(firstOffered);',
      // :72-113 — the published limits and the one that binds
      'const ceiling = splits?.current?.maxInvestment?.[currency];',
      "label: t('calc.limitSplitCeiling', { number: currentSplit ?? '—', currency }),",
      'if (cur?.sizeIsPublished && cur.maxFiat != null && cur.maxFiat > 0) {',
      'if (cur?.maxPerPerson != null && cur.maxPerPerson > 0) {',
      'const ceilingNext = splits?.next?.maxInvestment?.[currency];',
      "label: t('calc.limitSplitCeiling', { number: splits?.next?.number ?? '—', currency }),",
      'if (nxt?.plannedIsPublished && nxt.plannedMaxAmount) {',
      'if (nxt?.maxPerPerson != null && nxt.maxPerPerson > 0) {',
      'publishedLimits.reduce((a, b) => (b.amount < a.amount ? b : a))',
      "const typedAmount = Number(amount.replace(/[,\\s]/g, ''));",
      // :117-123 — what Express interest carries
      "const interestSplit = scope === 'next' ? (splits?.next?.number ?? (currentSplit != null ? currentSplit + 1 : null)) : currentSplit;",
      "...(Number.isFinite(typedAmount) && typedAmount >= 1 ? { amount: String(Math.floor(typedAmount)) } : {}),",
      // :125-162 — asking, and asking again after every change
      'if (bindingLimit && value > bindingLimit.amount) {',
      'const result = await api.scenario({ amount: value, currency, round, split: scope, sellerId, treasuryId });',
      'const timer = setTimeout(() => void calculate(), 350);',
      // :170-173 — companies in a route
      "(c.currencies ?? [c.currency]).includes(currency) && c.asset.toUpperCase() === 'LANA' && c.enabled === 1;",
      '<select value={currency} onChange={(e) => { setCurrency(e.target.value); setSellerId(null); setTreasuryId(null); }}>',
      // :305-311, :337 — the only two links
      "to={{ pathname: '/interest', search: `?${interestQuery}` }}",
      '<Link to="/risks">{t(\'calc.viewAllAssumptions\')}</Link>',
      // :348 — an assumption without words reads as the server's English
      '<li key={i}>{t(a.key as Key) === a.key ? a.text : t(a.key as Key, a.vars)}</li>',
    ];
    const changed = PORTED.filter((line) => !calc.includes(line));
    check(`the ${PORTED.length} ported lines of Calculator.tsx are unchanged in BEF`, changed.length === 0, changed);
    const links = [...calc.matchAll(/<Link[\s\S]*?to=\{?["{]/g)].length + [...readBef('src/pages/CalculatorPage.tsx').matchAll(/<Link/g)].length;
    check('BEF’s calculator page still has exactly two links (interest, risks)', links === 2, links);
    const app = readBef('src/App.tsx');
    check('BEF’s App still reads exactly bootstrap, splits and companies for it',
      /Promise\.all\(\[\s*api\.bootstrap\(\)\.catch\(\(\) => null\),\s*api\.splits\(\)\.catch\(\(\) => null\),\s*api\.companies\(\)\.catch\(\(\) => \(\{ companies: \[\] as Company\[\] \}\)\),\s*\]\)/.test(app));
  } else {
    skipped('reading BEF’s calculator source');
  }

  /* ────────────────────────────────────────────── BEF’s own server agrees ── */
  console.log('— against BEF’s real server: the same rounds, limits and refusals —');
  if (HAVE_BEF) {
    const helpers = await bef<BefTestHelpers>('server/tests/personHelpers.ts');
    const db = helpers.freshDb();
    helpers.insertKind38888(db, KIND);
    const addCompany = db.prepare('INSERT INTO companies (role, name, asset, currency, currencies, enabled, status, ord) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
    addCompany.run('seller', 'Alpha Seller', 'LANA', 'EUR', 'EUR,GBP', 1, 'CURRENT');
    addCompany.run('treasury', 'Beta Treasury', 'LANA', 'EUR', 'EUR', 1, 'INDICATIVE');
    addCompany.run('seller', 'Gamma Coins', 'BTC', 'EUR', 'EUR', 1, 'CURRENT');
    addCompany.run('seller', 'Delta Off', 'LANA', 'EUR', 'EUR', 0, 'CURRENT');
    const app = await helpers.startApp({}, db);
    try {
      const client = createBefClient({ base: app.base });
      const loaded = await loadFigures(client);
      check('the figures load from BEF', 'figures' in loaded && loaded.figures.bootstrap.currentSplit === 9 && !!loaded.figures.splits?.current, loaded);
      if (!('figures' in loaded)) throw new Error('no figures');
      const { splits, sellers, treasuries } = loaded.figures;

      const disagreements: unknown[] = [];
      for (const { scope, currency, round } of COMBINATIONS) {
        const offered = roundIsOffered(splits, scope, currency, round);
        const binding = bindingLimit(publishedLimits(splits, scope, currency, round, 9));
        let answer: ScenarioResponse | null = null;
        let refusal: BefApiError | null = null;
        try {
          answer = await client.figures.scenario({ amount: 1, currency, round, split: scope });
        } catch (err) {
          refusal = err as BefApiError;
        }
        const where = `${scope} ${currency} ${round}`;
        if (offered !== !!answer) disagreements.push({ where, offered, refusal: refusal?.code });
        if (!answer) continue;
        const server = answer.limits.binding;
        const label = { 'calc.limitSplitCeiling': /Co-creation maximum/, 'calc.limitRoundSize': /^Round \d size$/, 'calc.limitPerPerson': /^Maximum per co-creator/ };
        if ((server?.amount ?? null) !== (binding?.amount ?? null) || (binding && !label[binding.key].test(server?.label ?? ''))) {
          disagreements.push({ where, page: binding, server });
        }
        const applied = publishedLimits(splits, scope, currency, round, 9).map((l) => l.amount).join();
        if (applied !== answer.limits.applied.map((l) => l.amount).join()) disagreements.push({ where, page: applied, server: answer.limits.applied });
        if (binding) {
          const atLimit = await runScenario(client, { amountText: String(binding.amount), currency, round, scope, sellerId: null, treasuryId: null, binding });
          const refused = await runScenario(client, { amountText: String(binding.amount + 1), currency, round, scope, sellerId: null, treasuryId: null, binding: null });
          if (atLimit.kind !== 'result' || refused.kind !== 'aboveLimit' || refused.limit !== binding.amount) {
            disagreements.push({ where, atLimit: atLimit.kind, refused });
          }
        }
      }
      check(`all ${COMBINATIONS.length} combinations: offered rounds, limits and refusals are BEF’s`, disagreements.length === 0, disagreements);
      check('…and some of each were tried', COMBINATIONS.filter((c) => roundIsOffered(splits, c.scope, c.currency, c.round)).length === 4);

      const typed = await runScenario(client, { amountText: '10.000', currency: 'EUR', round: 1, scope: 'current', sellerId: null, treasuryId: null, binding: null });
      check('"10.000" is asked as 10000 and BEF says so back', typed.kind === 'result' && typed.scenario.input.amount === 10000 && typed.scenario.result.amount === 10000, typed.kind);
      check('every assumption BEF names has words here', typed.kind === 'result' && typed.scenario.assumptions.length > 3 && typed.scenario.assumptions.every((a) => hasExplorerText(a.key)), typed.kind === 'result' && typed.scenario.assumptions.map((a) => a.key));
      check('every status BEF names has words here', typed.kind === 'result' && Object.values(typed.scenario.statuses).filter(Boolean).every((s) => hasExplorerText(`status.${s}`)), typed.kind === 'result' && typed.scenario.statuses);
      const next = await runScenario(client, { amountText: '1000', currency: 'EUR', round: 2, scope: 'next', sellerId: null, treasuryId: null, binding: null });
      check('an unpublished next round: BEF’s "not available"', next.kind === 'problem' && next.problem.text === 'calc.unavailableError', next);

      check('EUR routes: the LANA seller and treasury, not the BTC or disabled one',
        sellers.filter((c) => companyTradesIn(c, 'EUR')).map((c) => c.name).join() === 'Alpha Seller' && treasuries.filter((c) => companyTradesIn(c, 'EUR')).map((c) => c.name).join() === 'Beta Treasury');
      check('GBP routes: the seller trading in both, no treasury', sellers.filter((c) => companyTradesIn(c, 'GBP')).map((c) => c.name).join() === 'Alpha Seller' && treasuries.filter((c) => companyTradesIn(c, 'GBP')).length === 0);
      const alpha = sellers.find((c) => c.name === 'Alpha Seller')!;
      const withSeller = await runScenario(client, { amountText: '1000', currency: 'EUR', round: 1, scope: 'current', sellerId: alpha.id, treasuryId: null, binding: null });
      check('a chosen seller comes back with its published status', withSeller.kind === 'result' && withSeller.scenario.statuses.seller === 'CURRENT' && withSeller.scenario.input.sellerId === alpha.id && !scenarioIsStale(withSeller.scenario, { amountText: '1000', currency: 'EUR', round: 1, scope: 'current', sellerId: alpha.id, treasuryId: null }));
      const q = interestQuery({ splits, scope: 'next', currentSplit: 9, currency: 'EUR', round: 1, amount: parseCalcAmount('4.999') });
      check('Express interest on the next split names split 10', q === 'split=10&currency=EUR&round=1&amount=4999', q);

      // ── who has already expressed interest, from BEF's own /api/interests ──
      const hex = (c: string) => c.repeat(64);
      const addPerson = db.prepare('INSERT INTO people (hex, name, display_name, country, email, phone, wallet, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      addPerson.run(hex('a'), 'Ana Novak', 'Ana', 'SI', 'ana@example.test', '+38640111222', 'LAnaWalletAddress11111111111111111', '2026-09-16T10:00:00Z');
      addPerson.run(hex('d'), 'Dan Kovač', 'Dan', 'SI', 'dan@example.test', '+38640333444', 'LDanWalletAddress11111111111111111', '2026-09-16T10:00:00Z');
      const addInterest = db.prepare(
        `INSERT INTO interests (hex, split_number, currency, rounds_json, total, status, wallet, params_event_id, event_id,
           event_created_at, event_json, relays_accepted, relays_total, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 4, '2026-09-16T10:00:00Z')`,
      );
      const rounds = (list: [number, number][]) => JSON.stringify(list.map(([round, amount]) => ({ round, amount })));
      //                hex        split  ccy    rounds                          total  status       wallet                                params         event id    signed at
      addInterest.run(hex('a'), 9, 'EUR', rounds([[1, 1000], [2, 5000]]), 6000, 'active', 'LAnaWalletAddress11111111111111111', 'p', hex('1'), 1_757_000_100, '{}');
      addInterest.run(hex('b'), 9, 'GBP', rounds([[1, 50]]), 50, 'active', 'LNoProfileWallet1111111111111111111', 'p', hex('2'), 1_757_000_200, '{}');
      addInterest.run(hex('c'), 9, 'EUR', rounds([]), 0, 'withdrawn', 'LGoneWalletAddress1111111111111111', 'p', hex('3'), 1_757_000_300, '{}');
      addInterest.run(hex('d'), 10, 'EUR', rounds([[1, 900]]), 900, 'active', 'LDanWalletAddress11111111111111111', 'p', hex('4'), 1_757_000_400, '{}');

      const list = await client.figures.interests();
      const split9 = list.splits.find((x) => x.split === 9);
      const split10 = list.splits.find((x) => x.split === 10);
      check('the current split, and the next one once somebody is in it', list.splits.map((x) => `${x.split}:${x.scope}`).join() === '9:current,10:next', list.splits.map((x) => x.split));
      const r1 = split9?.rounds.find((r) => r.round === 1);
      check('round 1: both people, earliest signature first, each in its own currency', r1?.entries.map((e) => `${e.name ?? '—'}/${e.currency}/${e.amount}`).join() === 'Ana Novak/EUR/1000,—/GBP/50', r1?.entries);
      check('…its totals are per currency, and it counts the people', JSON.stringify(r1?.totals) === JSON.stringify({ EUR: 1000, GBP: 50 }) && r1?.people === 2 && split9?.people === 2);
      const r2 = split9?.rounds.find((r) => r.round === 2);
      check('round 2: above the maximum per co-creator published now, shown as signed and marked', r2?.entries.length === 1 && r2.entries[0].amount === 5000 && r2.entries[0].beyondLimit === true, r2?.entries);
      check('…and an amount within the limits is not marked', r1?.entries.every((e) => !e.beyondLimit) === true);
      check('an interest withdrawn before 16 Sept 2026 is in no round', split9?.rounds.every((r) => r.entries.every((e) => e.amount !== 0)) && split9?.rounds.flatMap((r) => r.entries).length === 3, split9?.rounds.flatMap((r) => r.entries));
      check('a round nobody is in is empty, not missing', split9?.rounds.map((r) => r.round).join() === '1,2,3' && split9?.rounds.find((r) => r.round === 3)?.entries.length === 0);
      check('every key is shortened, never whole', split9?.rounds.flatMap((r) => r.entries).every((e) => e.key.includes('…') && e.key.length < 20) === true, split9?.rounds.flatMap((r) => r.entries).map((e) => e.key));
      const payload = JSON.stringify(list);
      const secrets = [hex('a'), hex('b'), hex('d'), 'LAnaWalletAddress11111111111111111', 'LDanWalletAddress11111111111111111', 'ana@example.test', '+38640111222', 'SI'];
      check('nothing else about a person travels: no whole key, wallet, e-mail, telephone or country', secrets.every((secret) => !payload.includes(secret)), secrets.filter((secret) => payload.includes(secret)));
      check('the rounds carry whether they are open for interest', split9?.rounds.every((r) => typeof r.openForInterest === 'boolean') === true);
    } finally {
      app.close();
      db.close();
    }
  } else {
    skipped('BEF’s real server');
  }

  /* ──────────────────────────────────────────────── what the page may do ── */
  console.log('— the Explorer reads public figures only —');
  {
    const offenders = (re: RegExp) => EXPLORER_FILES.filter((rel) => re.test(read(rel)));
    check('no dangerouslySetInnerHTML', offenders(/dangerouslySetInnerHTML/).length === 0, offenders(/dangerouslySetInnerHTML/));
    check('no fetch of its own: every read goes through the module’s client', offenders(/\bfetch\(/).length === 0, offenders(/\bfetch\(/));
    check('never signs in, signs or sends: no person door, no interest, no cards', offenders(/useBefPerson|withSession|BefDoor|\.person\.|\.interest\.|\.cards\.|signing|finalizeEvent|lanaPrivateKey|nostrPrivateKey/).length === 0, offenders(/useBefPerson|withSession|BefDoor|\.person\.|\.interest\.|\.cards\.|signing|finalizeEvent|lanaPrivateKey|nostrPrivateKey/));
    const page = read(PAGE);
    check('the page uses the module’s one client', page.includes('import { befClient } from "@/lib/bef/config";') && /useExplorerFigures\(befClient\)/.test(page) && /useScenario\(befClient,/.test(page));
    const external = EXPLORER_SOURCES.flatMap((rel) => [...read(rel).matchAll(/href=\{?"?([^"}\s>]+)/g)].map((m) => m[1]));
    check('its links out are befexplorer.com’s, opened in a new tab', external.length > 0 && external.every((href) => /BEF_CALCULATOR_URL|risksUrl/.test(href)) && EXPLORER_SOURCES.every((rel) => [...read(rel).matchAll(/<a\s[^>]*>/g)].every((m) => /target="_blank"/.test(m[0]) && /rel="noopener noreferrer"/.test(m[0]))), external);
  }

  /* ───────────────────────────────────────────────────────────────── copy ── */
  console.log('— no promise vocabulary in the Explorer’s own words —');
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
      const list = /const BANNED = \[([\s\S]*?)\n\];/.exec(readBef('server/tests/copy.test.ts'))?.[1] ?? '';
      const fromBef = [...list.matchAll(/^\s*\/(.+)\/([a-z]*),\s*$/gm)].map((m) => new RegExp(m[1], m[2]));
      check('BEF copy.test.ts BANNED read', fromBef.length >= banned.length, fromBef.length);
      if (fromBef.length) banned = fromBef;
    }
    const found: string[] = [];
    for (const rel of EXPLORER_FILES) {
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

  if (failures) console.log(`\n❌ ${failures} FAILED${skips ? `, ${skips} skipped` : ''}`);
  else if (skips && !WITHOUT_BEF) console.log(`\n❌ passed, but ${skips} skipped (bef-explorer not found): nothing was compared with BEF. Set BEF_EXPLORER_DIR, or pass --without-bef.`);
  else console.log(skips ? `\n✅ passed, ${skips} skipped (--without-bef)` : '\n✅ all passed');
  process.exit(failures || (skips && !WITHOUT_BEF) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
