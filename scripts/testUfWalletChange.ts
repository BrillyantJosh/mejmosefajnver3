/**
 * An OPEN funding request may move its receiving wallet only to another of the owner's
 * own registered wallets (Brilly, 11. 11. 2026) — at the route AND in the relay re-index.
 *
 * The REAL router and the REAL indexer, on a THROWAWAY database (MEJMO_DB_PATH in the OS
 * temp dir) with a fake relay on 127.0.0.1 — nothing near data/mejmosefajn.db, no real relay.
 *   npx tsx scripts/testUfWalletChange.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-wallet-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');
if (path.resolve(process.env.MEJMO_DB_PATH).startsWith(path.resolve(new URL('../data', import.meta.url).pathname))) throw new Error('refusing to run against the real data directory');

const { default: express } = await import('express');
const { getDb } = await import('../server/db/connection.js');
const { default: ufRoutes } = await import('../server/routes/unconditionalFinancing.js');
const { indexUnconditionalFinancingFromRelays, resetUfIndexerCaches } = await import('../server/lib/nostr.js');
const { closeRelayPool } = await import('../server/lib/relayPool.js');
const { judgeReceivingWallet } = await import('../server/lib/ufWallet.js');

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 300) : ''); }
};
interface Key { sk: Uint8Array; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const registrar = newKey(), stranger = newKey(), owner = newKey(), owner2 = newKey();

const walletList = (who: Key, rows: string[][], o: { createdAt?: number; status?: string; signer?: Key } = {}) => finalizeEvent({
  kind: 30889, created_at: o.createdAt ?? now - DAY,
  tags: [['d', who.pk], ['p', who.pk], ['status', o.status ?? 'active'], ...rows.map((r) => ['w', ...r])],
  content: '',
}, (o.signer ?? registrar).sk);
const W = (addr: string, type: string, freeze = '') => [addr, type, 'LANA', '9', '0', freeze];

console.log('— the rule, on its own —');
{
  const list = walletList(owner, [W('LMain', 'Main Wallet'), W('LWal', 'Wallet'), W('LDisc', 'Lana.Discount'), W('LL8w', 'Lana8Wonder'), W('LFroz', 'Wallet', 'frozen_max_cap')]);
  const j = (addr: string, events: any[] = [list], signers = [registrar.pk]) => judgeReceivingWallet(events, owner.pk, addr, signers);
  check('own Main Wallet → yes', (j('LMain') as any).ok === true);
  check('own Wallet → yes', (j('LWal') as any).ok === true);
  check('own Lana.Discount → yes', (j('LDisc') as any).ok === true);
  check('own Lana8Wonder → no (cannot receive a financing)', (j('LL8w') as any).ok === false);
  check('own frozen Wallet → no', (j('LFroz') as any).ok === false && /frozen/.test((j('LFroz') as any).reason));
  check('an address not on the list → no', (j('LSomeoneElse') as any).ok === false);
  check('a whole account frozen → no', (judgeReceivingWallet([walletList(owner, [W('LMain', 'Main Wallet')], { status: 'frozen' })], owner.pk, 'LMain', [registrar.pk]) as any).ok === false);
  check('a list signed by someone who is not the registrar does not count', (j('LMain', [walletList(owner, [W('LMain', 'Main Wallet')], { signer: stranger })]) as any).ok === false);
  check('a list about another person does not count', (judgeReceivingWallet([list], owner2.pk, 'LMain', [registrar.pk]) as any).ok === false);
  const newer = walletList(owner, [W('LWal', 'Wallet')], { createdAt: now });
  check('the newest list decides: a wallet dropped from it no longer counts', (j('LMain', [list, newer]) as any).ok === false && (j('LWal', [list, newer]) as any).ok === true);
  const forged = { ...JSON.parse(JSON.stringify(list)), tags: [...list.tags, ['w', 'LForged', 'Main Wallet', 'LANA', '9', '0', '']] };
  check('a list altered after signing does not count', (j('LForged', [forged]) as any).ok === false);
  check('no registrar key known → cannot tell (never yes)', 'unknown' in judgeReceivingWallet([list], owner.pk, 'LMain', []));
}

// ── a fake relay ──
const relay = { store: [] as Event[], refuse30889: false };
const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise<void>((r) => wss.on('listening', () => r()));
const RELAY_URL = `ws://127.0.0.1:${(wss.address() as any).port}`;
wss.on('connection', (ws) => ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m[0] !== 'REQ') return;
  const [, sub, f] = m;
  if (relay.refuse30889 && f.kinds?.includes(30889)) { ws.send(JSON.stringify(['CLOSED', sub, 'blocked: test'])); return; }
  for (const e of relay.store) {
    if (f.kinds && !f.kinds.includes(e.kind)) continue;
    if (f.authors && !f.authors.includes(e.pubkey)) continue;
    if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) continue;
    if (f['#p'] && !e.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))) continue;
    ws.send(JSON.stringify(['EVENT', sub, e]));
  }
  ws.send(JSON.stringify(['EOSE', sub]));
}));

const db = getDb();
db.prepare('DELETE FROM kind_38888').run();
db.prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, trusted_signers, raw_event)
            VALUES ('test', 'x', ?, ?, '[]', '{}', '9', ?, '{"tags":[["split","9"]]}')`)
  .run(now, JSON.stringify([RELAY_URL]), JSON.stringify({ LanaRegistrar: [registrar.pk] }));
db.prepare(`INSERT INTO app_settings (key, value) VALUES ('unconditional_financing_maturing_days', '15') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
db.prepare(`INSERT INTO app_settings (key, value) VALUES ('unconditional_financing_last_indexed_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(now - 600));
relay.store.push(walletList(owner, [W('LOwnMain', 'Main Wallet'), W('LOwnWallet', 'Wallet'), W('LOwnFrozen', 'Wallet', 'frozen_max_cap'), W('LOwnL8w', 'Lana8Wonder')]));

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/unconditional-financing', ufRoutes);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => http.on('listening', () => r()));
const BASE = `http://127.0.0.1:${(http.address() as any).port}/api/unconditional-financing`;
const upsert = async (event: Event) => {
  const res = await fetch(`${BASE}/requests/upsert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
};
const seed = db.prepare(`INSERT INTO uf_requests (id, event_id, pubkey, title, wallet, published_at, funding_opens_at, is_hidden, nostr_created_at)
                         VALUES (?, ?, ?, 'Seeded', 'LOwnMain', ?, ?, 0, ?)`);
let seedN = 0;
const addRequest = (id: string, who: Key, state: 'open' | 'maturing') =>
  seed.run(id, `ev${++seedN}`, who.pk, now - 30 * DAY, state === 'open' ? now - 15 * DAY : now + 5 * DAY, now - 2 * DAY);
const walletOf = (id: string) => (db.prepare('SELECT wallet FROM uf_requests WHERE id = ?').get(id) as any)?.wallet;
let tick = 0;
const edit = (who: Key, id: string, wallet: string, createdAt = now - 100 + ++tick) => finalizeEvent({
  kind: 31240, created_at: createdAt,
  tags: [['d', id], ['service', 'unconditional-financing'], ['title', 'Edited'], ['summary', 's'], ['request_type', 'personal_hardship'],
    ['fiat_goal', '100'], ['currency', 'EUR'], ['wallet', wallet], ['published_at', String(now - 30 * DAY)], ['status', 'active']],
  content: 'story',
}, who.sk);

console.log('— the route: an OPEN request —');
{
  addRequest('uf:w-open', owner, 'open');
  let r = await upsert(edit(owner, 'uf:w-open', 'LOwnWallet'));
  check('to another of the owner’s own registered wallets → 200, and the wallet changes', r.status === 200 && walletOf('uf:w-open') === 'LOwnWallet', { r, w: walletOf('uf:w-open') });
  r = await upsert(edit(owner, 'uf:w-open', 'LSomeoneElsesWallet'));
  check('to an address that is not the owner’s → 403, unchanged', r.status === 403 && walletOf('uf:w-open') === 'LOwnWallet', { r, w: walletOf('uf:w-open') });
  r = await upsert(edit(owner, 'uf:w-open', 'LOwnFrozen'));
  check('to the owner’s own FROZEN wallet → 403, unchanged', r.status === 403 && /frozen/i.test(r.data.error || '') && walletOf('uf:w-open') === 'LOwnWallet', r);
  r = await upsert(edit(owner, 'uf:w-open', 'LOwnL8w'));
  check('to the owner’s own Lana8Wonder wallet → 403, unchanged', r.status === 403 && walletOf('uf:w-open') === 'LOwnWallet', r);
  relay.refuse30889 = true;
  await new Promise((res) => setTimeout(res, 50));
  r = await upsert(edit(owner, 'uf:w-open', 'LOwnMain'));
  check('the registry cannot be read → 503, unchanged (never guessed)', r.status === 503 && walletOf('uf:w-open') === 'LOwnWallet', r);
  relay.refuse30889 = false;
  r = await upsert(edit(owner, 'uf:w-open', 'LOwnWallet'));
  check('a text edit that keeps the wallet → 200, unchanged, no registry needed', r.status === 200 && walletOf('uf:w-open') === 'LOwnWallet', r);
  r = await upsert(edit(stranger, 'uf:w-open', 'LOwnMain'));
  check('someone else’s signature → 403 as before', r.status === 403 && walletOf('uf:w-open') === 'LOwnWallet', r);
}

console.log('— the route: a request still MATURING (unchanged rule) —');
{
  addRequest('uf:w-mat', owner, 'maturing');
  const r = await upsert(edit(owner, 'uf:w-mat', 'LAnythingWhileMaturing'));
  check('while maturing the wallet may still change, as before', r.status === 200 && walletOf('uf:w-mat') === 'LAnythingWhileMaturing', r);
}

console.log('— the relay re-index —');
{
  resetUfIndexerCaches();
  addRequest('uf:w-idx', owner2, 'open');
  relay.store.push(walletList(owner2, [W('L2Main', 'Main Wallet'), W('L2Wal', 'Wallet')]));
  const nostrAt = () => (db.prepare('SELECT nostr_created_at FROM uf_requests WHERE id = ?').get('uf:w-idx') as any)?.nostr_created_at;

  relay.store.push(edit(owner2, 'uf:w-idx', 'LForeign', now - 50));
  await indexUnconditionalFinancingFromRelays(db);
  check('a newer version asking for someone else’s wallet: kept the old one', walletOf('uf:w-idx') === 'LOwnMain', walletOf('uf:w-idx'));

  relay.store = relay.store.filter((e) => !(e.kind === 31240 && e.tags.some((t) => t[0] === 'd' && t[1] === 'uf:w-idx')));
  relay.refuse30889 = true;
  const before = nostrAt();
  const ownEdit = edit(owner2, 'uf:w-idx', 'L2Wal', now - 10);
  relay.store.push(ownEdit);
  await new Promise((res) => setTimeout(res, 50));
  await indexUnconditionalFinancingFromRelays(db);
  check('own wallet, registry unreadable: nothing of that version is written (it waits)', walletOf('uf:w-idx') === 'LOwnMain' && nostrAt() === before, { w: walletOf('uf:w-idx'), before, after: nostrAt() });
  relay.refuse30889 = false;
  await new Promise((res) => setTimeout(res, 50));
  await indexUnconditionalFinancingFromRelays(db);
  check('…and the next scan applies it: the owner’s own wallet', walletOf('uf:w-idx') === 'L2Wal' && nostrAt() === ownEdit.created_at, { w: walletOf('uf:w-idx'), at: nostrAt() });

  relay.store.push(edit(owner2, 'uf:w-idx', 'L2Main', now - 200));
  await indexUnconditionalFinancingFromRelays(db);
  check('an OLDER copy on a lagging relay does not move it back', walletOf('uf:w-idx') === 'L2Wal', walletOf('uf:w-idx'));
}

closeRelayPool();
http.close();
wss.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
