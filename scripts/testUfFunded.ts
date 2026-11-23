/**
 * Unconditional Financing — once a request is funded, "Prispevaj" is no longer active and the
 * request reads "Financiran" (Jasna asked, Brilly confirmed, 16. 11. 2026; src/lib/ufFunded.ts).
 *
 * 1. the rule on its own: funded = raised reaches the goal, in cents as the page prints both;
 * 2. what the pages do with it: the "Prispevaj" place, and the check right before LANA is sent;
 * 3. the REAL router and the REAL relay indexer, on a THROWAWAY database (MEJMO_DB_PATH in the OS
 *    temp dir) with a fake relay on 127.0.0.1: the API answers what the pages need, the pre-send
 *    check stops a payment to a funded request, and the server still records and re-indexes every
 *    real contribution — also one that lands after the goal (its LANA is already on-chain when it
 *    is recorded) — and repaying is untouched;
 * 4. at most what is still missing (Brilly, 16. 11. 2026, point c): the form refuses more than
 *    goal − raised in cents, and right before LANA is sent a payment that others overtook in the
 *    meantime is refused with the new maximum — never sent, never changed — also on the real API
 *    (1000 of 1300 → 300 at most; someone pays 100 → 300 refused, 200 at most; 200 → funded);
 * 5. the pages are wired to the rule;
 * 6. the raised amount reads as a whole number, rounded DOWN (Jasna, Brilly 16. 11. 2026): it
 *    reaches the goal exactly when the request reads "Financiran"; nothing that is paid uses it;
 * 7. the main figures — raised and goal — carry a thousands separator (Jasna, Brilly 17. 11. 2026;
 *    src/lib/ufMainFigures.ts): "100.000", "1.300" in Slovenian, "100,000", "1,300" otherwise;
 *    raised still rounded down, the goal never rounded ("1.300,50"); nothing that is paid uses it.
 * Nothing near data/mejmosefajn.db, no real relay.
 *   npx tsx scripts/testUfFunded.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';
import { ufAmountVerdict, ufCents, ufChosenFiat, ufContributeCta, ufFreshRemainingCents, ufIsFullyFunded, ufPreSendRefusal, ufReadsFunded, ufRemainingCents, ufRepaymentStarted } from '../src/lib/ufFunded.js';
import { ufRaisedWhole } from '../src/lib/ufRaisedWhole.js';
import { ufGoalText, ufGroupThousands, ufRaisedText } from '../src/lib/ufMainFigures.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-funded-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');
if (path.resolve(process.env.MEJMO_DB_PATH).startsWith(path.resolve(new URL('../data', import.meta.url).pathname))) throw new Error('refusing to run against the real data directory');

const { default: express } = await import('express');
const { getDb } = await import('../server/db/connection.js');
const { default: ufRoutes } = await import('../server/routes/unconditionalFinancing.js');
const { indexUnconditionalFinancingFromRelays, resetUfIndexerCaches } = await import('../server/lib/nostr.js');
const { closeRelayPool } = await import('../server/lib/relayPool.js');
const { fundingRefusal } = await import('../server/lib/ufApproval.js');

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 300) : ''); }
};

console.log('— the rule, on its own: raised reaches the goal, in cents as the page prints both —');
{
  check('1300.00 of 1300 → funded (the request in Jasna’s screenshot)', ufIsFullyFunded(1300, 1300));
  check('1299.99 of 1300 → not funded', !ufIsFullyFunded(1299.99, 1300));
  check('1300.01 of 1300 → funded (more than the goal is still funded)', ufIsFullyFunded(1300.01, 1300));
  const floatSum = Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0); // ten contributions of 0.10 → 0.9999999999999999
  check('a float sum a hair under the goal, which the page prints as 1.00 of 1 → funded', floatSum < 1 && floatSum.toFixed(2) === '1.00' && ufIsFullyFunded(floatSum, 1), floatSum);
  check('1299.994 (printed 1299.99) → not funded', (1299.994).toFixed(2) === '1299.99' && !ufIsFullyFunded(1299.994, 1300));
  check('1299.995 → as the page prints it', ufIsFullyFunded(1299.995, 1300) === ((1299.995).toFixed(2) === '1300.00'));
  check('a goal of 0 is never funded', !ufIsFullyFunded(0, 0) && !ufIsFullyFunded(50, 0));
  check('a goal that is not a number is never funded', !ufIsFullyFunded(50, undefined) && !ufIsFullyFunded(50, NaN) && !ufIsFullyFunded(50, 'x'));
  check('nothing raised → not funded', !ufIsFullyFunded(0, 1300) && !ufIsFullyFunded(undefined, 1300) && !ufIsFullyFunded(null, 1300));
  check('cents: 1300 → 130000, 0.1 + 0.2 → 30, NaN → 0', ufCents(1300) === 130000 && ufCents(0.1 + 0.2) === 30 && ufCents(NaN) === 0);
}

console.log('— what the pages do with it —');
{
  const open = { phase: 'repaying', fiatGoal: 1300, fundable: true, isArchived: false };
  check('open and funded → reads "Financiran"', ufReadsFunded(open, 1300));
  check('open, not yet funded → does not', !ufReadsFunded(open, 1000));
  check('repaid reads "Poplačano", not "Financiran"', !ufReadsFunded({ ...open, phase: 'repaid' }, 1300));
  check('"V odplačevanju": funded but nothing repaid yet → not started; first repayment → started',
    !ufRepaymentStarted(open, 0) && !ufRepaymentStarted(open, undefined) && !ufRepaymentStarted(open, 0.004) && ufRepaymentStarted(open, 0.01) && ufRepaymentStarted(open, 50));
  check('"V odplačevanju": maturing, repaid or pending phases are never listed there', ['maturing', 'repaid', 'pending'].every((ph) => !ufRepaymentStarted({ phase: ph }, 50)));
  check('tab labels: "V zorenju", "Poplačani", and the repaying tab reads the filtered list', (() => {
    const l = readFileSync(new URL('../src/pages/unconditional-financing/UFRequests.tsx', import.meta.url), 'utf8');
    return l.includes('sl ? "V zorenju" : "Maturing"') && l.includes('sl ? "Poplačani" : "Repaid"') && l.includes('fundedList.repaying');
  })());
  check('maturing or waiting for approval → not "Financiran"', !ufReadsFunded({ ...open, phase: 'maturing' }, 1300) && !ufReadsFunded({ ...open, phase: 'pending' }, 1300));
  check('the "Prispevaj" place: open, below the goal → the button', ufContributeCta(open, 1000, false) === 'contribute');
  check('…funded → the disabled "Financiran", not the button', ufContributeCta(open, 1300, false) === 'funded');
  check('…more than funded → the disabled "Financiran"', ufContributeCta(open, 5000, false) === 'funded');
  check('…the author never sees "Prispevaj" (nor the disabled one)', ufContributeCta(open, 1000, true) === 'none' && ufContributeCta(open, 1300, true) === 'none');
  check('…archived → nothing', ufContributeCta({ ...open, isArchived: true, fundable: false }, 1300, false) === 'none');
  check('…not fundable (waiting, maturing) → nothing', ufContributeCta({ ...open, fundable: false, phase: 'maturing' }, 0, false) === 'none');

  const shown = { wallet: 'LOwnMain', currency: 'EUR', fiatAmount: 100 };
  const fresh = (req: Record<string, unknown>, totalFunded?: number) => ({ request: { fundable: true, isArchived: false, fiatGoal: 1300, totalFunded: 0, wallet: 'LOwnMain', currency: 'EUR', ...req }, totalFunded });
  check('right before LANA is sent: open, below the goal, same wallet → may send', ufPreSendRefusal(fresh({}, 1000), shown) === null);
  check('…others funded it to the goal since the page opened → nothing is sent ("funded")', ufPreSendRefusal(fresh({}, 1300), shown) === 'funded');
  check('…the detail total is what counts, the request’s own total when that is all there is', ufPreSendRefusal(fresh({ totalFunded: 1300 }), shown) === 'funded' && ufPreSendRefusal(fresh({ totalFunded: 1300 }, 1000), shown) === null);
  check('…totals that cannot be read → nothing is sent ("unchecked")', ufPreSendRefusal(fresh({ totalFunded: undefined }), shown) === 'unchecked' && ufPreSendRefusal(fresh({ totalFunded: undefined }, NaN), shown) === 'unchecked');
  check('…no answer → nothing is sent ("unchecked")', ufPreSendRefusal(null, shown) === 'unchecked' && ufPreSendRefusal({}, shown) === 'unchecked');
  check('…archived → "archived"', ufPreSendRefusal(fresh({ isArchived: true, fundable: false }, 0), shown) === 'archived');
  check('…not fundable → "not_fundable"', ufPreSendRefusal(fresh({ fundable: false }, 0), shown) === 'not_fundable');
  check('…another wallet or currency → "changed"', ufPreSendRefusal(fresh({ wallet: 'LOther' }, 0), shown) === 'changed' && ufPreSendRefusal(fresh({ currency: 'GBP' }, 0), shown) === 'changed');
}

console.log('— at most what is still missing (Brilly 16. 11. 2026, c) —');
{
  check('missing at 1000 of 1300 → 300.00 (30000 cents)', ufRemainingCents(1000, 1300) === 30000);
  check('…at the goal, or over it → 0, never below', ufRemainingCents(1300, 1300) === 0 && ufRemainingCents(2000, 1300) === 0);
  check('…nothing raised → the whole goal', ufRemainingCents(0, 1300) === 130000 && ufRemainingCents(undefined, 1300) === 130000);
  const floatSum = Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0); // 0.9999999999999999, printed 1.00
  check('…in cents as the page prints: a float sum printed 1.00 of 2 → 1.00 missing', ufRemainingCents(floatSum, 2) === 100, ufRemainingCents(floatSum, 2));
  check('…a goal that cannot be read → null (no maximum to show, nothing may be given)', ufRemainingCents(10, 0) === null && ufRemainingCents(10, undefined) === null && ufRemainingCents(10, 'x') === null);
  check('the example: at 1000 of 1300, 300 → ok', ufAmountVerdict(300, 1000, 1300) === 'ok');
  check('…1000 (which would end at 2000 of 1300) → over', ufAmountVerdict(1000, 1000, 1300) === 'over');
  check('…300.01 → over (one cent too many)', ufAmountVerdict(300.01, 1000, 1300) === 'over');
  check('…299.99 → ok', ufAmountVerdict(299.99, 1000, 1300) === 'ok');
  check('…0, nothing, under a cent, negative → empty', ['0', '', 0.004, -5, NaN, undefined].every((a) => ufAmountVerdict(a, 1000, 1300) === 'empty'));
  check('…no readable goal → no_goal, whatever the amount', ufAmountVerdict(10, 0, 0) === 'no_goal' && ufAmountVerdict(10, 5, undefined) === 'no_goal');
  check('the chosen amount is passed on in whole cents as printed: "300.004" → 300, "299.99" → 299.99, "abc" → 0',
    ufChosenFiat('300.004') === 300 && String(ufChosenFiat('300.004')) === '300' && String(ufChosenFiat('299.99')) === '299.99' && ufChosenFiat('abc') === 0 && ufChosenFiat('') === 0);
  check('…so a sub-cent input cannot slip a fraction over the goal: "300.004" at 1000 of 1300 → 300 → total exactly the goal',
    ufAmountVerdict(ufChosenFiat('300.004'), 1000, 1300) === 'ok' && 1000 + ufChosenFiat('300.004') === 1300);

  const shown = (fiatAmount: number) => ({ wallet: 'LOwnMain', currency: 'EUR', fiatAmount });
  const fresh = (totalFunded: number, req: Record<string, unknown> = {}) => ({ request: { fundable: true, isArchived: false, fiatGoal: 1300, totalFunded: 0, wallet: 'LOwnMain', currency: 'EUR', ...req }, totalFunded });
  check('right before LANA is sent: 300 chosen at 1000 of 1300, still 1000 → may send', ufPreSendRefusal(fresh(1000), shown(300)) === null);
  check('…someone paid 100 meanwhile (1100 of 1300) → 300 is not sent ("over_remaining")', ufPreSendRefusal(fresh(1100), shown(300)) === 'over_remaining');
  check('…and the page can tell the new maximum: 200.00', ufFreshRemainingCents(fresh(1100)) === 20000);
  check('…choosing 200 then may send', ufPreSendRefusal(fresh(1100), shown(200)) === null);
  check('…200.01 may not', ufPreSendRefusal(fresh(1100), shown(200.01)) === 'over_remaining');
  check('…funded meanwhile → "funded" (not "over_remaining")', ufPreSendRefusal(fresh(1300), shown(300)) === 'funded');
  check('…another wallet AND too much → "changed" first (the old amount means nothing for a changed request)', ufPreSendRefusal(fresh(1100, { wallet: 'LOther' }), shown(300)) === 'changed');
  check('…an amount that cannot be read, or under a cent → nothing is sent ("unchecked")', ufPreSendRefusal(fresh(1000), shown(0)) === 'unchecked' && ufPreSendRefusal(fresh(1000), shown(NaN)) === 'unchecked' && ufPreSendRefusal(fresh(1000), shown(0.004)) === 'unchecked');
  check('…a goal that cannot be read → nothing is sent ("unchecked")', ufPreSendRefusal(fresh(10, { fiatGoal: 0 }), shown(5)) === 'unchecked');
  check('…the new maximum cannot be read from no answer → null', ufFreshRemainingCents(null) === null && ufFreshRemainingCents({}) === null && ufFreshRemainingCents({ request: { fiatGoal: 1300 } }) === null);
}

console.log('— the raised amount as a whole number, rounded down (Jasna, Brilly 16. 11. 2026) —');
{
  check('1300.00 raised → "1300" (the card in Jasna’s screenshot)', ufRaisedWhole(1300) === '1300' && ufRaisedWhole(1300.0) === '1300');
  check('1299.60 → "1299", never "1300" next to a goal of 1300 while not funded', ufRaisedWhole(1299.6) === '1299' && !ufIsFullyFunded(1299.6, 1300));
  check('1299.99 → "1299"; 1300.40 → "1300"; 1300.99 → "1300"', ufRaisedWhole(1299.99) === '1299' && ufRaisedWhole(1300.4) === '1300' && ufRaisedWhole(1300.99) === '1300');
  const floatSum = Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0); // 0.9999999999999999, printed 1.00, funded at a goal of 1
  check('a float sum a hair under 1 that the page prints 1.00 → "1" (same cents as "Financiran")', ufRaisedWhole(floatSum) === '1' && ufIsFullyFunded(floatSum, 1), floatSum);
  check('1299.995 → as "Financiran" reads it', ufRaisedWhole(1299.995) === (ufIsFullyFunded(1299.995, 1300) ? '1300' : '1299'));
  check('0, nothing, not a number → "0"', [0, undefined, null, NaN, 'x', 0.004].every((v) => ufRaisedWhole(v) === '0'));
  check('a number that comes as text reads the same: "1299.60" → "1299"', ufRaisedWhole('1299.60') === '1299');
  let disagree: number | null = null;
  for (let c = 129800; c <= 130200 && disagree === null; c++) {
    const raised = c / 100;
    if ((Number(ufRaisedWhole(raised)) >= 1300) !== ufIsFullyFunded(raised, 1300)) disagree = raised;
  }
  check('cent by cent from 1298.00 to 1302.00: the whole number reaches 1300 exactly when the request is funded', disagree === null, disagree);
}

console.log('— the main figures with a thousands separator (Jasna, Brilly 17. 11. 2026) —');
{
  check('raised 100000 → "100.000" (the card in Jasna’s screenshot), 1300 → "1.300" — also four digits', ufRaisedText(100000, true) === '100.000' && ufRaisedText(1300, true) === '1.300', [ufRaisedText(100000, true), ufRaisedText(1300, true)]);
  check('…in English "100,000" and "1,300"', ufRaisedText(100000, false) === '100,000' && ufRaisedText(1300, false) === '1,300');
  check('…three digits and less stay as they are: 999, 0', ufRaisedText(999, true) === '999' && ufRaisedText(0, true) === '0' && ufRaisedText(999, false) === '999');
  check('…millions: 1234567.89 → "1.234.567" / "1,234,567" (still rounded down)', ufRaisedText(1234567.89, true) === '1.234.567' && ufRaisedText(1234567.89, false) === '1,234,567');
  check('…still rounded DOWN: 1299.60 → "1.299", 99999.99 → "99.999", never the goal while not funded',
    ufRaisedText(1299.6, true) === '1.299' && ufRaisedText(99999.99, true) === '99.999' && !ufIsFullyFunded(99999.99, 100000));
  check('…not a number → "0", as before', [undefined, null, NaN, 'x'].every((v) => ufRaisedText(v, true) === '0' && ufRaisedText(v, false) === '0'));
  const samples = [0, 0.99, 1, 999.99, 1000, 1299.6, 1300, 9999.99, 10000, 99999.99, 100000, 100000.5, 1234567.89, 0.1 + 0.2, Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0)];
  check('…it is yesterday’s whole number with only the separators added (sl and en)',
    samples.every((v) => ufRaisedText(v, true).replace(/\./g, '') === ufRaisedWhole(v) && ufRaisedText(v, false).replace(/,/g, '') === ufRaisedWhole(v)));
  for (const goal of [1300, 100000]) {
    let disagree: number | null = null;
    for (let c = goal * 100 - 200; c <= goal * 100 + 200 && disagree === null; c++) {
      const raised = c / 100;
      if ((Number(ufRaisedText(raised, true).replace(/\./g, '')) >= goal) !== ufIsFullyFunded(raised, goal)) disagree = raised;
    }
    check(`…cent by cent around a goal of ${ufGoalText(goal, true)}: the grouped number reaches the goal exactly when the request is funded`, disagree === null, disagree);
  }
  check('goal 1300 → "1.300", 100000 → "100.000"; in English "1,300", "100,000"',
    ufGoalText(1300, true) === '1.300' && ufGoalText(100000, true) === '100.000' && ufGoalText(1300, false) === '1,300' && ufGoalText(100000, false) === '100,000');
  check('…a goal with cents shows them: 1300.50 → "1.300,50" / "1,300.50"; 1300.05 → "1.300,05"',
    ufGoalText(1300.5, true) === '1.300,50' && ufGoalText(1300.5, false) === '1,300.50' && ufGoalText(1300.05, true) === '1.300,05' && ufGoalText(0.5, true) === '0,50');
  check('…never rounded: 1299.99 → "1.299,99" (not "1.300"), 1300.50 is not "1.301" (the card used to print toFixed(0))',
    ufGoalText(1299.99, true) === '1.299,99' && ufGoalText(1300.5, true) !== '1.301' && ufGoalText(1300.5, true) !== '1.300');
  check('…not even below a cent (only a hand-made event could carry one): 1300.555 → "1.300,555"', ufGoalText(1300.555, true) === '1.300,555');
  check('…millions and huge numbers: 1234567.89 → "1.234.567,89"; 1e21 → every zero written out',
    ufGoalText(1234567.89, true) === '1.234.567,89' && ufGoalText(1234567.89, false) === '1,234,567.89' && ufGoalText(1e21, true) === '1.000.000.000.000.000.000.000');
  check('…a goal that comes as text reads the same; not a number → "0"', ufGoalText('1300.50', true) === '1.300,50' && [undefined, null, NaN, 'x'].every((v) => ufGoalText(v, true) === '0'));
  const back = (t: string, sl: boolean) => Number(sl ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  let changed: number | null = null;
  for (let c = 1; c <= 1_000_000 && changed === null; c += c < 200_000 ? 1 : 997) {
    const goal = c / 100;
    if (back(ufGoalText(goal, true), true) !== goal || back(ufGoalText(goal, false), false) !== goal) changed = goal;
  }
  check('…every goal from 0.01 to 2000.00 cent by cent, and on to 10000: the text reads back as exactly the goal', changed === null, changed);
  check('grouping only ever touches whole digits', ufGroupThousands('1300', true) === '1.300' && ufGroupThousands('1300', false) === '1,300' && ufGroupThousands('1e+21', true) === '1e+21' && ufGroupThousands('-1300', true) === '-1.300');
}

// ── the real router and indexer, on a throwaway database with a fake relay ──
interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const service = newKey(), registrar = newKey(), admin = newKey(), owner = newKey(), supporter = newKey(), late = newKey();
const randomHex = () => Buffer.from(generateSecretKey()).toString('hex').slice(0, 32);

const relay = { store: [] as Event[] };
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>((r) => wss.on('listening', () => r()));
const RELAY_URL = `ws://127.0.0.1:${(wss.address() as any).port}`;
wss.on('connection', (ws) => ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m[0] !== 'REQ') return;
  const [, sub, f] = m;
  for (const e of relay.store) {
    if (f.kinds && !f.kinds.includes(e.kind)) continue;
    if (f.authors && !f.authors.includes(e.pubkey)) continue;
    if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) continue;
    if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))) continue;
    ws.send(JSON.stringify(['EVENT', sub, e]));
  }
  ws.send(JSON.stringify(['EOSE', sub]));
}));

// The signed calendar production publishes, moved to this test's now (see testUfIndexer.ts).
const calendar = {
  tags: [['split', '9'], ['split_started_at', String(now - 27 * DAY)],
    ...[[1, 305], [2, 275], [3, 245], [4, 215], [5, 185], [6, 155], [7, 125], [8, 95], [9, 27]].map(([n, d]) => ['split_history', String(n), String(now - d * DAY)])],
  content: '{}',
};
const db = getDb();
db.prepare('DELETE FROM kind_38888').run();
db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
            VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, ?)`)
  .run(now, JSON.stringify([RELAY_URL]), JSON.stringify({ Lana8Wonder: [service.pk], LanaRegistrar: [registrar.pk] }), JSON.stringify(calendar));
const setting = (k: string, v: string) => db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, v);
setting('unconditional_financing_maturing_days', '0');        // production's setting on 16. 11. 2026
setting('unconditional_financing_last_indexed_at', String(now - 600));
db.prepare('INSERT INTO admin_users (nostr_hex_id) VALUES (?)').run(admin.pk);
relay.store.push(finalizeEvent({ kind: 88888, created_at: now - 200 * DAY, tags: [['d', `plan:${owner.pk.slice(0, 8)}`], ['p', owner.pk]], content: '{}' }, service.sk));
const W = (addr: string, type: string) => ['w', addr, type, 'LANA', '9', '0', ''];
relay.store.push(finalizeEvent({ kind: 30889, created_at: now - DAY, tags: [['d', owner.pk], ['p', owner.pk], ['status', 'active'], W('LOwnMain', 'Main Wallet')], content: '' }, registrar.sk));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}/api/unconditional-financing`;
const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
};
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

const ID = 'uf:funded-test';
const requestEvent = finalizeEvent({
  kind: 31240, created_at: now - 1000,
  tags: [['d', ID], ['service', 'unconditional-financing'], ['title', 'Preobrazba prostora'], ['summary', 'Nov dekor'],
    ['request_type', 'personal_hardship'], ['fiat_goal', '20'], ['currency', 'EUR'], ['wallet', 'LOwnMain'],
    ['published_at', String(now - 2000)], ['funding_opens_at', String(now - 2000)], ['status', 'active'], ['client', 'mejmosefajn']],
  content: 'Zgodba',
}, owner.sk);
let txN = 0;
const contribution = (who: Key, fiat: string, at: number, requestId = ID) => finalizeEvent({
  kind: 60210, created_at: at,
  tags: [['service', 'unconditional-financing'], ['request', requestId], ['amount_lanoshis', String(Math.round(Number(fiat) * 1e9))], ['amount_fiat', fiat], ['currency', 'EUR'],
    ['rate', '0.1'], ['from_wallet', 'LSup'], ['repayment_wallet', 'LSupMain'], ['to_wallet', 'LOwnMain'], ['tx', `tx-${++txN}`], ['timestamp_paid', String(at)]],
  content: '',
}, who.sk);
const detail = async () => (await call('GET', `/requests/${encodeURIComponent(ID)}`)).data;
const contributionRows = () => db.prepare('SELECT id, amount_fiat FROM uf_contributions WHERE request_id = ? ORDER BY id').all(ID) as { id: string; amount_fiat: number }[];
const shown = { wallet: 'LOwnMain', currency: 'EUR', fiatAmount: 5 };

console.log('— on the real API: below the goal the request is open —');
{
  const up = await quiet(() => call('POST', '/requests/upsert', { event: requestEvent }));
  const row = db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(ID) as any;
  const ap = await call('POST', `/requests/${encodeURIComponent(ID)}/approve`, {
    event: finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${BASE}/x`], ['method', 'POST'], ['nonce', randomHex()]],
      content: JSON.stringify({ action: 'uf-request-approve', id: ID, event_id: row?.event_id, fiat_goal: 20, currency: 'EUR' }) }, admin.sk),
  });
  check('(setup) the request is listed and approved at 20 EUR', up.status === 200 && ap.status === 200, { up, ap });
  const c1 = await call('POST', '/contributions/record', { event: contribution(supporter, '10', now - 300) });
  const d = await detail();
  check('one contribution of 10 → 10 of 20, open', c1.status === 200 && d.totalFunded === 10 && d.request.fiatGoal === 20 && d.request.fundable === true, d?.request);
  check('…the page offers "Prispevaj"', ufContributeCta(d.request, d.totalFunded, false) === 'contribute' && !ufReadsFunded(d.request, d.totalFunded));
  check('…and right before sending, the fresh answer lets the payment go', ufPreSendRefusal(d, shown) === null);
  check('…10 missing: 10 may go, 10.01 may not, and the API says 10.00 is the most', ufFreshRemainingCents(d) === 1000
    && ufPreSendRefusal(d, { ...shown, fiatAmount: 10 }) === null && ufPreSendRefusal(d, { ...shown, fiatAmount: 10.01 }) === 'over_remaining'
    && ufAmountVerdict(10.01, d.totalFunded, d.request.fiatGoal) === 'over', d.totalFunded);
}

console.log('— the goal is reached —');
{
  const c2 = await call('POST', '/contributions/record', { event: contribution(late, '10', now - 200) });
  const d = await detail();
  check('a second contribution of 10 is recorded → 20 of 20', c2.status === 200 && d.totalFunded === 20, d);
  check('…the request page reads "Financiran"; "Prispevaj" is the disabled "Financiran"', ufReadsFunded(d.request, d.totalFunded) && ufContributeCta(d.request, d.totalFunded, false) === 'funded');
  const listed = ((await call('GET', '/requests?tab=all')).data.requests || []).find((r: any) => r.id === ID);
  check('…the list card reads "Financiran" from the list’s own totals', !!listed && ufReadsFunded(listed, listed.totalFunded), listed);
  const mine = ((await call('GET', `/my-financings/${owner.pk}`)).data.financings || [])[0];
  check('…and so does "Moje"', !!mine && ufReadsFunded(mine.request, mine.totalFunded), mine);
  check('…a payment started on a page opened before the goal was reached is stopped before any LANA moves', ufPreSendRefusal(d, shown) === 'funded');
}

console.log('— the server records and re-indexes every real contribution, also after the goal —');
{
  const before = contributionRows();
  // Two financiers paying in the same minute: the second one's LANA is on-chain before it is recorded.
  const inFlight = contribution(supporter, '5', now - 100);
  const c3 = await call('POST', '/contributions/record', { event: inFlight });
  check('a contribution recorded after the goal (its LANA already sent) is counted, not refused (200)', c3.status === 200 && contributionRows().some((r) => r.id === inFlight.id), c3);
  check('…the shared route/re-index rule does not close a funded request (fundingRefusal is null)',
    fundingRefusal(db.prepare('SELECT * FROM uf_requests WHERE id = ?').get(ID)) === null);
  check('…the API field `fundable` is unchanged by the goal (the server rule stays as it was)', (await detail()).request.fundable === true);

  const direct = contribution(late, '7', now - 50);
  relay.store.push(direct);
  resetUfIndexerCaches();
  await quiet(() => indexUnconditionalFinancingFromRelays(db));
  check('a contribution published straight to the relays after the goal is counted by the re-index', contributionRows().some((r) => r.id === direct.id));
  const after = contributionRows();
  check('…every contribution recorded before is still there, with its amount', before.every((b) => after.some((a) => a.id === b.id && a.amount_fiat === b.amount_fiat)), { before, after });
  const d = await detail();
  check('…the total counts them all (10 + 10 + 5 + 7 = 32 of 20), and the request still reads "Financiran"', d.totalFunded === 32 && ufReadsFunded(d.request, d.totalFunded), d.totalFunded);
}

console.log('— repaying is untouched —');
{
  const rp = await call('POST', '/repayments/record', {
    event: finalizeEvent({
      kind: 60211, created_at: now - 30,
      tags: [['service', 'unconditional-financing'], ['request', ID], ['amount_lanoshis_total', '50000000'], ['amount_fiat_total', '5'], ['currency', 'EUR'],
        ['rate', '0.1'], ['tx', 'tx-repay-1'], ['out', supporter.pk, 'LSupMain', '50000000', '5']],
      content: '',
    }, owner.sk),
  });
  const d = await detail();
  check('the owner of a funded request repays (200)', rp.status === 200 && d.totalRepaid === 5, rp);
  check('…still "Financiran" while it is being repaid', ufReadsFunded(d.request, d.totalFunded));
}

console.log('— on the real API: at 1000 of 1300 the most is 300; someone pays first; the payment waits for a new choice —');
{
  const ID2 = 'uf:cap-test';
  const ev2 = finalizeEvent({
    kind: 31240, created_at: now - 900,
    tags: [['d', ID2], ['service', 'unconditional-financing'], ['title', 'Kavarna'], ['summary', 'Prostor'],
      ['request_type', 'personal_hardship'], ['fiat_goal', '1300'], ['currency', 'EUR'], ['wallet', 'LOwnMain'],
      ['published_at', String(now - 2000)], ['funding_opens_at', String(now - 2000)], ['status', 'active'], ['client', 'mejmosefajn']],
    content: 'Zgodba',
  }, owner.sk);
  const up = await quiet(() => call('POST', '/requests/upsert', { event: ev2 }));
  const row = db.prepare('SELECT event_id FROM uf_requests WHERE id = ?').get(ID2) as { event_id?: string } | undefined;
  const ap = await call('POST', `/requests/${encodeURIComponent(ID2)}/approve`, {
    event: finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${BASE}/x`], ['method', 'POST'], ['nonce', randomHex()]],
      content: JSON.stringify({ action: 'uf-request-approve', id: ID2, event_id: row?.event_id, fiat_goal: 1300, currency: 'EUR' }) }, admin.sk),
  });
  const r0 = await call('POST', '/contributions/record', { event: contribution(late, '1000', now - 80, ID2) });
  const detail2 = async () => (await call('GET', `/requests/${encodeURIComponent(ID2)}`)).data;
  const rows2 = () => db.prepare('SELECT id, amount_fiat FROM uf_contributions WHERE request_id = ? ORDER BY id').all(ID2) as { id: string; amount_fiat: number }[];
  const opened = await detail2();
  check('(setup) approved at 1300 EUR, 1000 raised', up.status === 200 && ap.status === 200 && r0.status === 200 && opened.totalFunded === 1000 && opened.request.fiatGoal === 1300, { up, ap, r0, t: opened.totalFunded });
  check('the form: 300.00 is what is missing; 1000 is refused, 300 is not', ufRemainingCents(opened.totalFunded, opened.request.fiatGoal) === 30000
    && ufAmountVerdict(1000, opened.totalFunded, opened.request.fiatGoal) === 'over' && ufAmountVerdict(300, opened.totalFunded, opened.request.fiatGoal) === 'ok');
  // The person chose 300 on the page opened at 1000 — before they press Send, someone else pays 100.
  const meanwhile = await call('POST', '/contributions/record', { event: contribution(supporter, '100', now - 60, ID2) });
  const before = rows2();
  const atSend = await detail2();
  check('right before sending: 1100 of 1300 now → 300 is NOT sent ("over_remaining"), the new maximum is 200.00',
    meanwhile.status === 200 && ufPreSendRefusal(atSend, { ...shown, fiatAmount: 300 }) === 'over_remaining' && ufFreshRemainingCents(atSend) === 20000, atSend.totalFunded);
  check('…nothing recorded changes from the refusal (the same 2 contributions, same amounts)', JSON.stringify(rows2()) === JSON.stringify(before) && before.length === 2);
  check('…choosing 200 again may send', ufPreSendRefusal(atSend, { ...shown, fiatAmount: 200 }) === null);
  const last = await call('POST', '/contributions/record', { event: contribution(supporter, String(ufChosenFiat('200')), now - 40, ID2) });
  const done = await detail2();
  check('…recorded: exactly 1300 of 1300, "Financiran", and no one is offered more', last.status === 200 && done.totalFunded === 1300
    && ufReadsFunded(done.request, done.totalFunded) && ufPreSendRefusal(done, { ...shown, fiatAmount: 0.01 }) === 'funded', done.totalFunded);
  check('…the recorded fiat is the chosen amount, as it was signed (not worked back from LANA)', rows2().some((r) => r.amount_fiat === 200));
}

console.log('— the pages are wired to the rule —');
{
  const src = (f: string) => readFileSync(new URL(`../src/pages/unconditional-financing/${f}`, import.meta.url), 'utf8');
  const detailPage = src('UFRequestDetail.tsx');
  const list = src('UFRequests.tsx');
  const contribute = src('UFContribute.tsx');
  const pay = src('UFContributePrivateKey.tsx');
  const my = src('UFMy.tsx');
  for (const [name, s] of [['UFRequestDetail', detailPage], ['UFRequests', list], ['UFContribute', contribute], ['UFContributePrivateKey', pay], ['UFMy', my]] as const) {
    check(`${name} takes the rule from src/lib/ufFunded.ts`, s.includes('from "@/lib/ufFunded"'));
  }
  for (const [name, s] of [['UFRequestDetail', detailPage], ['UFRequests', list], ['UFContribute', contribute], ['UFMy', my]] as const) {
    check(`${name} says "Financiran" / "Funded"`, s.includes('"Financiran"') && s.includes('"Funded"'));
  }
  check('request page: "Prispevaj" only when the rule says "contribute", the disabled "Financiran" when it says "funded"',
    /contributeCta === "contribute" && \(\s*<Button[\s\S]{0,400}"Prispevaj"/.test(detailPage) && /contributeCta === "funded" && \(\s*<Button\s+disabled/.test(detailPage)
    && !detailPage.includes('request.fundable && !isRequester &&'));
  check('list card: a funded request gets the disabled "Financiran" before the "Prispevaj" branch',
    /request\.phase === "repaying" && isFunded \? \(\s*<Button\s+disabled/.test(list) && list.indexOf('request.phase === "repaying" && isFunded') < list.indexOf('{sl ? "Prispevaj" : "Contribute"}'));
  check('contribute page: no payment form for a funded request, and Continue stays off',
    /\) : isFunded \? \(/.test(contribute) && /request\.fundable &&\s*!isFunded &&/.test(contribute));
  const gate = pay.indexOf('ufPreSendRefusal(fresh');
  const send = pay.indexOf('"send-lana-transaction"');
  check('pay page: the fresh check runs before the LANA is sent, and stops on any refusal', gate > 0 && send > gate && /if \(refusal\) \{[\s\S]{0,2500}setIsSending\(false\);\s*return;/.test(pay.slice(gate, send)));
  check('…the old inline check is gone (it knew nothing of the goal)', !pay.includes('!now?.fundable || now.wallet !== request.wallet'));
  check('…the fresh check is given the chosen amount', /ufPreSendRefusal\(fresh, \{[\s\S]{0,160}fiatAmount: fiatAmount/.test(pay));
  const overBranch = pay.slice(gate, send).match(/if \(refusal === "over_remaining"\) \{([\s\S]*?)\n {6}\}\n {6}if \(refusal\) \{/);
  check('…"over_remaining" stops before the LANA is sent, keeps the new maximum from the FRESH answer, and never touches the amount',
    !!overBranch && /const left = ufFreshRemainingCents\(fresh\)/.test(overBranch[1]) && /setOverRemainingCents\(left\);/.test(overBranch[1])
    && /setIsSending\(false\);\s*return;\s*$/.test(overBranch[1])
    && !/setFiatAmount|fiatAmount\s*=(?!=)|state\.fiatAmount\s*=/.test(pay));
  check('…the page then says the new maximum and offers to choose again on the form',
    /overRemainingCents !== null && \([\s\S]{0,1600}\(overRemainingCents \/ 100\)\.toFixed\(2\)[\s\S]{0,1600}navigate\(`\/unconditional-financing\/contribute\/\$\{id\}`\)[\s\S]{0,200}"Izberi znesek znova"/.test(pay));
  check('…and Send stays off until the person chooses again', /disabled=\{[^}]*overRemainingCents !== null\}/.test(pay) && /paidUnrecorded \|\| overRemainingCents !== null\) return;/.test(pay));
  check('contribute form: Continue only for an amount within what is missing', /!!selectedWalletId &&\s*amountVerdict === "ok" &&/.test(contribute) && !contribute.includes('parsedFiat'));
  check('…the verdict is the shared rule, on the same raised total and goal as "Financiran"',
    /ufAmountVerdict\(fiatAmount, raised, request\.fiatGoal\)/.test(contribute) && /ufReadsFunded\(request, raised\)/.test(contribute) && /ufRemainingCents\(raised, request\.fiatGoal\)/.test(contribute));
  check('…the amount passed on is the cents-rounded one the form checked', /const fiatAmount = ufChosenFiat\(fiatInput\)/.test(contribute) && /state: \{\s*selectedWalletId,\s*fiatAmount,\s*lanaAmount,/.test(contribute) && /fiatAmount \/ rate/.test(contribute));
  check('…it shows what is missing and says it in both languages', contribute.includes('`Do cilja manjka še ${remainingText} ${currency}`') && contribute.includes('`${remainingText} ${currency} left to reach the goal`'));
  check('…the input carries the maximum, and the one preset is exactly what is missing (off when nothing is)',
    /max=\{remainingCents !== null \? remainingText : undefined\}/.test(contribute) && /disabled=\{remainingCents <= 0\}\s*onClick=\{\(\) => setFiatInput\(remainingText\)\}/.test(contribute));
  const repay = src('UFRepay.tsx');
  const figures = readFileSync(new URL('../src/lib/ufMainFigures.ts', import.meta.url), 'utf8');
  const fundedRule = readFileSync(new URL('../src/lib/ufFunded.ts', import.meta.url), 'utf8');
  check('the grouped raised amount is yesterday’s whole number (ufRaisedWhole), not a new rounding', /return ufGroupThousands\(ufRaisedWhole\(totalFunded\), sl\);/.test(figures));
  check('raised and goal with a thousands separator: the list card', /<span className="text-3xl font-bold">\{ufRaisedText\(totalFunded, sl\)\}<\/span>/.test(list)
    && list.includes('{sl ? "Cilj:" : "Goal:"} {ufGoalText(goalAmount, sl)} {request.currency}') && !list.includes('goalAmount.toFixed(0)') && list.includes('from "@/lib/ufMainFigures"'));
  check('…the request page', /\{ufRaisedText\(totalFunded, sl\)\} \{request\.currency\}/.test(detailPage) && detailPage.includes('{sl ? "od" : "of"} {ufGoalText(fiatGoal, sl)} {request.currency}') && detailPage.includes('from "@/lib/ufMainFigures"'));
  check('…"Moje"', /\{ufRaisedText\(financing\.totalFunded, sl\)\} \{request\.currency\}/.test(my) && my.includes('/ {ufGoalText(goal, sl)} {request.currency}') && my.includes('from "@/lib/ufMainFigures"'));
  check('…each in the page’s own language (sl = useLang() === "sl", passed down to the card)', [list, detailPage, my].every((s) => s.includes('const sl = useLang() === "sl";')) && /<UfRequestCard[\s\S]{0,200}sl=\{sl\}/.test(list) && /<FinancingCard[\s\S]{0,200}sl=\{sl\}/.test(my));
  // Code only: the doc comment may name the formatter to say this rule does NOT read it.
  const fundedRuleCode = fundedRule.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('…the funded rule does not read the display', fundedRuleCode.includes('export function ufIsFullyFunded') && !fundedRuleCode.includes('ufMainFigures') && !fundedRuleCode.includes('ufRaisedWhole') && !fundedRuleCode.includes('ufRaisedText') && !fundedRuleCode.includes('ufGoalText'));
  check('…"Financiran" and the percent still read the exact total', /ufReadsFunded\(request, totalFunded\)/.test(list) && /ufIsFullyFunded\(totalFunded, goalAmount\)/.test(list) && /ufReadsFunded\(request, totalFunded\)/.test(detailPage) && /ufReadsFunded\(request, financing\.totalFunded\)/.test(my));
  check('…nothing that is paid uses it: the contribute and pay pages, and repaying, keep exact amounts',
    [contribute, pay, repay].every((s) => !s.includes('ufRaisedWhole') && !s.includes('ufMainFigures') && !s.includes('ufRaisedText') && !s.includes('ufGoalText'))
    && repay.includes('{totalFunded.toFixed(2)} {currency}')
    && list.includes('`Poplačano ${totalRepaid.toFixed(2)} / zbrano ${totalFunded.toFixed(2)} ${request.currency}`'));
  check('…the shared formatters stay exact (repayments and contributions go through them)', my.includes('const fiat = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;') && detailPage.includes('const fmtFiat = (n: number) => `${n.toFixed(2)} ${request.currency}`;'));
  check('…the resume of a payment already on-chain does not go through the gate (it only records)', !/recordContribution[\s\S]{0,40}ufPreSendRefusal/.test(pay) && pay.indexOf('ufPreSendRefusal(fresh') > pay.indexOf('const handleConfirm'));
}

closeRelayPool();
http.close();
wss.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
