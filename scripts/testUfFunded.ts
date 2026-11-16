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
 * 4. the pages are wired to the rule.
 * Nothing near data/mejmosefajn.db, no real relay.
 *   npx tsx scripts/testUfFunded.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';
import { ufCents, ufContributeCta, ufIsFullyFunded, ufPreSendRefusal, ufReadsFunded } from '../src/lib/ufFunded.js';

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
  check('maturing or waiting for approval → not "Financiran"', !ufReadsFunded({ ...open, phase: 'maturing' }, 1300) && !ufReadsFunded({ ...open, phase: 'pending' }, 1300));
  check('the "Prispevaj" place: open, below the goal → the button', ufContributeCta(open, 1000, false) === 'contribute');
  check('…funded → the disabled "Financiran", not the button', ufContributeCta(open, 1300, false) === 'funded');
  check('…more than funded → the disabled "Financiran"', ufContributeCta(open, 5000, false) === 'funded');
  check('…the author never sees "Prispevaj" (nor the disabled one)', ufContributeCta(open, 1000, true) === 'none' && ufContributeCta(open, 1300, true) === 'none');
  check('…archived → nothing', ufContributeCta({ ...open, isArchived: true, fundable: false }, 1300, false) === 'none');
  check('…not fundable (waiting, maturing) → nothing', ufContributeCta({ ...open, fundable: false, phase: 'maturing' }, 0, false) === 'none');

  const shown = { wallet: 'LOwnMain', currency: 'EUR' };
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
const contribution = (who: Key, fiat: string, at: number) => finalizeEvent({
  kind: 60210, created_at: at,
  tags: [['service', 'unconditional-financing'], ['request', ID], ['amount_lanoshis', String(Math.round(Number(fiat) * 1e9))], ['amount_fiat', fiat], ['currency', 'EUR'],
    ['rate', '0.1'], ['from_wallet', 'LSup'], ['repayment_wallet', 'LSupMain'], ['to_wallet', 'LOwnMain'], ['tx', `tx-${++txN}`], ['timestamp_paid', String(at)]],
  content: '',
}, who.sk);
const detail = async () => (await call('GET', `/requests/${encodeURIComponent(ID)}`)).data;
const contributionRows = () => db.prepare('SELECT id, amount_fiat FROM uf_contributions WHERE request_id = ? ORDER BY id').all(ID) as { id: string; amount_fiat: number }[];
const shown = { wallet: 'LOwnMain', currency: 'EUR' };

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
  check('…the resume of a payment already on-chain does not go through the gate (it only records)', !/recordContribution[\s\S]{0,40}ufPreSendRefusal/.test(pay) && pay.indexOf('ufPreSendRefusal(fresh') > pay.indexOf('const handleConfirm'));
}

closeRelayPool();
http.close();
wss.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
