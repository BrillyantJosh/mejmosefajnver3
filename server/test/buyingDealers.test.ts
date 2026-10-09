/**
 * GET /api/buying-dealers, the reader behind it: WHICH FIRMS, FROM WHERE, AND
 * WHAT A SILENCE DOES. Ported from lana.discount server/lib/buyingDealers.test.ts
 * (1996af0) onto node:test, case for case, plus what is particular to this app
 * (its own kind_38888 table and boot seed, its own authority constant).
 *   npm run test:sell-moved
 *
 *   the source   relays and reliable people come from the stored KIND 38888
 *                only when it is the system parameters event and its signature
 *                verifies — never from the `relays` column, never from the
 *                boot seed (server/db/seed.ts) or a forged row;
 *   the firms    BEF dealers whose own profile says "buys": a seller-only firm,
 *                a retired one and a stranger's are not named; each link is
 *                built on the verified host;
 *   the memory   a good read is kept ten minutes; an older one is answered at
 *                once while one read runs behind it; one older than twenty
 *                minutes waits for that read; a read that decides nothing
 *                keeps the last good list and says it is stale; with no good
 *                read ever, the answer is "unknown" with no firm; the shared
 *                reader reads by itself, without a visitor;
 *   a silence    a firm whose own site, or the relays, did not answer once is
 *                still named — for an hour at most — and a real refusal takes
 *                it off at once.
 *
 * Nothing here reaches a relay or a website, and nothing opens
 * data/mejmosefajn.db: every database is in memory.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import {
  BEF_DIRECTORY_URL, HOLD_UNCONFIRMED_MS, KEEP_FRESH_TICK_MS, MAX_ANSWER_AGE_MS, RETRY_AFTER_FAILURE_MS,
  buyersOf, createBuyingDealersReader, removedBySilence, type BuyingDealersAnswer, type BuyingDealersReaderDeps,
} from '../lib/buyingDealers.js';
import { SYSTEM_PARAMETERS_PUBKEY, parseVerified38888, verifiedKind38888 } from '../lib/befDealers/systemParams.js';
import {
  DEALER_REFRESH_INTERVAL_MS, MAX_HOSTS_PER_RUN, type DealerRead, type DealerFilter, type ListedDealer,
} from '../lib/befDealers/dealers.js';
import {
  dealerContent, dealerEvent, fakeRelays, fakeSites, makeKey, newIdentity, signEvent, NOW_MS, NOW_S,
  TEST_EUR_WALLET, TEST_GBP_WALLET, TEST_PAYOUT_WALLET, TEST_RECEIVE_WALLET,
  type SiteReply, type TestKey,
} from '../lib/befDealers/dealerTestKit.js';
import type { NostrEvent } from '../lib/befDealers/relayRead.js';
import { initializeSchema } from '../db/schema.js';
import { seedData } from '../db/seed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../lib');

/** Stands in for the Lana Core Authority: the reader is told to trust this key instead (opts.author). */
const authority: TestKey = makeKey();

function params38888(opts: { reliable?: string[]; relays?: string[]; content?: Record<string, unknown>; d?: string; kind?: number } = {}): NostrEvent {
  const tags: string[][] = [['d', opts.d ?? 'main']];
  for (const r of opts.relays ?? ['wss://relay.one.test', 'wss://relay.two.test']) tags.push(['relay', r]);
  for (const hex of opts.reliable ?? []) tags.push(['reliable_person', hex, 'Someone']);
  return signEvent(authority, { kind: opts.kind ?? 38888, created_at: NOW_S - 86_400, tags, content: JSON.stringify(opts.content ?? {}) });
}

function paramsDb(raw: string | null, relaysColumn = '["wss://relay.from-the-column.test"]'): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE kind_38888 (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, relays TEXT NOT NULL, raw_event TEXT NOT NULL)');
  if (raw !== null) db.prepare('INSERT INTO kind_38888 (id, created_at, relays, raw_event) VALUES (?, ?, ?, ?)').run('main', NOW_S, relaysColumn, raw);
  return db;
}

const json = (v: unknown) => JSON.stringify(v);

/* ── the source ───────────────────────────────────────────────────────────── */

describe('the stored KIND 38888, verified', () => {
  it('relays and reliable people come from the signed event itself — wss only, each once, nothing added', () => {
    const reliable = 'A'.repeat(64);
    const event = params38888({
      reliable: [` ${reliable} `, reliable.toLowerCase(), 'not-a-key', 'b'.repeat(64)],
      relays: ['wss://relay.one.test/', 'wss://relay.one.test', 'ws://in-the-clear.test', 'wss://user:pw@relay.test', 'wss://relay.two.test'],
    });
    const v = parseVerified38888(JSON.stringify(event), authority.pub)!;
    assert.equal(v.eventId, event.id);
    assert.deepEqual(v.relays, ['wss://relay.one.test', 'wss://relay.two.test']);
    assert.deepEqual([...v.reliable], ['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('the content stands in only where the tags say nothing', () => {
    const event = signEvent(authority, {
      kind: 38888, created_at: NOW_S, tags: [['d', 'main']],
      content: JSON.stringify({ relays: ['wss://from-content.test', 42], reliable_people: [{ hex: 'C'.repeat(64) }, { hex: 'x' }] }),
    });
    const v = parseVerified38888(JSON.stringify(event), authority.pub)!;
    assert.deepEqual(v.relays, ['wss://from-content.test']);
    assert.deepEqual([...v.reliable], ['c'.repeat(64)]);
  });

  it('a seed row, a forged or altered event, another author, another d or kind — all unknown', () => {
    const good = params38888({ reliable: ['a'.repeat(64)] });
    assert.notEqual(parseVerified38888(JSON.stringify(good), authority.pub), null);
    // A seed-like signature on a real event.
    assert.equal(parseVerified38888(JSON.stringify({ ...good, sig: 'local_seed' }), authority.pub), null);
    // One reliable person more, written into a real event.
    const altered = { ...good, tags: [...good.tags, ['reliable_person', 'f'.repeat(64)]] };
    assert.equal(parseVerified38888(JSON.stringify(altered), authority.pub), null);
    // Correctly signed — by somebody else.
    assert.equal(parseVerified38888(JSON.stringify(signEvent(makeKey(), { ...good, tags: good.tags })), authority.pub), null);
    assert.equal(parseVerified38888(JSON.stringify(good)), null); // the real authority is not this test key
    assert.equal(parseVerified38888(JSON.stringify(params38888({ d: 'other' })), authority.pub), null);
    assert.equal(parseVerified38888(JSON.stringify(params38888({ kind: 30972 })), authority.pub), null);
    assert.equal(parseVerified38888('not json', authority.pub), null);
  });

  it('pins the real authority by default — the same key nostr.ts trusts for KIND 38888', () => {
    assert.equal(SYSTEM_PARAMETERS_PUBKEY, '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3');
    // nostr.ts keeps its constant unexported; read the line, so the two can never drift apart.
    const nostr = fs.readFileSync(path.join(LIB, 'nostr.ts'), 'utf8');
    const pinned = /const AUTHORIZED_PUBKEY = '([0-9a-f]{64})'/.exec(nostr)?.[1];
    assert.equal(pinned, SYSTEM_PARAMETERS_PUBKEY);
  });

  it('never reads the relays column, and never throws on a table without the raw event', () => {
    const event = params38888({ reliable: ['a'.repeat(64)] });
    const v = verifiedKind38888(paramsDb(JSON.stringify(event)), { author: authority.pub })!;
    assert.deepEqual(v.relays, ['wss://relay.one.test', 'wss://relay.two.test']);
    assert.ok(!v.relays.includes('wss://relay.from-the-column.test'));
    const bare = new Database(':memory:');
    bare.exec('CREATE TABLE kind_38888 (id TEXT PRIMARY KEY, created_at INTEGER, relays TEXT)');
    assert.equal(verifiedKind38888(bare, { author: authority.pub }), null);
    assert.equal(verifiedKind38888(paramsDb(null), { author: authority.pub }), null);
  });

  it("this app's own table: the boot seed is unknown; a synced row is read from its raw event, not its relays column", () => {
    // The production schema and seed, in memory (server/db/schema.ts, server/db/seed.ts).
    const db = new Database(':memory:');
    initializeSchema(db);
    seedData(db);
    const seed = db.prepare('SELECT id, relays, raw_event FROM kind_38888').all() as { id: string; relays: string; raw_event: string }[];
    assert.equal(seed.length, 1);
    assert.equal(seed[0].id, 'seed_kind_38888');
    assert.ok(seed[0].relays.includes('lanacoin-eternity'), 'the seed carries the old alias — exactly why the column is not read');
    assert.equal(verifiedKind38888(db), null);
    assert.equal(verifiedKind38888(db, { author: authority.pub }), null);

    // What syncKind38888ToDb (server/index.ts) writes: DELETE, then one row
    // with raw_event = JSON.stringify(event) — here signed by the test authority.
    const event = params38888({ reliable: ['a'.repeat(64)] });
    db.prepare('DELETE FROM kind_38888').run();
    db.prepare(`
      INSERT INTO kind_38888 (id, event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, split, version, valid_from, trusted_signers, raw_event)
      VALUES (?, ?, ?, ?, ?, '[]', '{}', '8', '1', 0, '{}', ?)
    `).run('synced_1', event.id, authority.pub, event.created_at, '["wss://relay.lanacoin-eternity.com"]', JSON.stringify(event));
    const v = verifiedKind38888(db, { author: authority.pub })!;
    assert.equal(v.eventId, event.id);
    assert.deepEqual(v.relays, ['wss://relay.one.test', 'wss://relay.two.test']);
  });
});

/* ── the firms ────────────────────────────────────────────────────────────── */

describe('the firms that buy LANA', () => {
  const krog = newIdentity();
  const ravena = newIdentity();
  const sellerOnly = newIdentity();
  const retired = newIdentity();
  const stranger = newIdentity();
  const reliable = [krog.hex, ravena.hex, sellerOnly.hex, retired.hex];

  const events = [
    dealerEvent(krog, 'krog-menjave', dealerContent({ host: 'krogmenjave.test', name: 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.' })),
    dealerEvent(ravena, 'ravena-plus', dealerContent({ host: 'ravenaplus.test', name: 'Ravena Plus d.o.o.' })),
    dealerEvent(sellerOnly, 'only-sells', dealerContent({ host: 'onlysells.test', name: 'Only Sells d.o.o.', roles: ['sells'] })),
    dealerEvent(retired, 'gone', dealerContent({ host: 'gone.test', name: 'Gone d.o.o.', status: 'retired' })),
    dealerEvent(stranger, 'stranger', dealerContent({ host: 'stranger.test', name: 'Stranger Buys d.o.o.', roles: ['buys'] })),
  ];
  const sites: Record<string, SiteReply> = {
    'krogmenjave.test': { dealers: { 'krog-menjave': { admins: [krog.hex] } } },
    'ravenaplus.test': { dealers: { 'ravena-plus': { admins: [ravena.hex] } } },
    'onlysells.test': { dealers: { 'only-sells': { admins: [sellerOnly.hex] } } },
    'gone.test': { dealers: { gone: { admins: [retired.hex] } } },
    'stranger.test': { dealers: { stranger: { admins: [stranger.hex] } } },
  };

  const readerOn = (db: Database.Database, asked: { relays: string[][]; filters: DealerFilter[] }) => {
    const relays = fakeRelays(events, 2, 2, true);
    const files = fakeSites(sites);
    return createBuyingDealersReader({
      db: () => db,
      author: authority.pub,
      now: () => NOW_MS,
      reader: {
        fetchEvents: async (r, f) => { asked.relays.push(r); asked.filters.push(f); return relays.source(r, f); },
        fetchWellKnown: files.lookup,
      },
    });
  };

  it('names Krog menjave and Ravena Plus — not a firm that only sells, a retired one, or a stranger', async () => {
    const asked = { relays: [] as string[][], filters: [] as DealerFilter[] };
    const reader = readerOn(paramsDb(JSON.stringify(params38888({ reliable }))), asked);
    const answer = await reader.get();
    assert.equal(answer.status, 'read');
    assert.equal(answer.readAt, new Date(NOW_MS).toISOString());
    assert.equal(answer.directoryUrl, BEF_DIRECTORY_URL);
    assert.equal(BEF_DIRECTORY_URL, 'https://befexplorer.com/companies');
    assert.deepEqual(answer.buyers, [
      {
        slug: 'krog-menjave', name: 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.', host: 'krogmenjave.test',
        website: 'https://krogmenjave.test/', registerUrl: 'https://krogmenjave.test/prijava',
        sellUrl: 'https://krogmenjave.test/ko-kreacija/prodaj', eventId: events[0].id, signedAt: new Date((NOW_S - 3600) * 1000).toISOString(),
      },
      {
        slug: 'ravena-plus', name: 'Ravena Plus d.o.o.', host: 'ravenaplus.test',
        website: 'https://ravenaplus.test/', registerUrl: 'https://ravenaplus.test/prijava',
        sellUrl: 'https://ravenaplus.test/ko-kreacija/prodaj', eventId: events[1].id, signedAt: new Date((NOW_S - 3600) * 1000).toISOString(),
      },
    ]);
    // The relays asked are the event's, never the column's.
    assert.ok(asked.relays.length > 0);
    assert.ok(asked.relays.every((r) => json(r) === json(['wss://relay.one.test', 'wss://relay.two.test'])));
    // No admin key, signer, bank account or owner goes out.
    const text = JSON.stringify(answer);
    for (const secret of [krog.hex, ravena.hex, 'e'.repeat(64), 'd'.repeat(64), 'SI56191000000123438', 'GB29NWBK60161331926819', 'Ana Novak', 'npub']) {
      assert.ok(!text.includes(secret), `${secret} must not be in the answer`);
    }
  });

  it('a seed row asks no relay and names no firm', async () => {
    const asked = { relays: [] as string[][], filters: [] as DealerFilter[] };
    const seed = { ...params38888({ reliable }), sig: 'local_seed' };
    const answer = await readerOn(paramsDb(JSON.stringify(seed)), asked).get();
    assert.deepEqual([answer.status, answer.readAt, answer.buyers], ['unknown', null, []]);
    assert.deepEqual(asked.relays, []);
  });

  it('a firm whose newest profile is 1.4.0 (a receive wallet per currency, KIND 30972 v1.6.0) is named like any other — no wallet goes out', async () => {
    const v140 = dealerEvent(krog, 'krog-menjave', dealerContent({
      host: 'krogmenjave.test', name: 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.',
      payoutWallet: TEST_PAYOUT_WALLET, receiveWallet: TEST_RECEIVE_WALLET, receiveWallets: { EUR: TEST_EUR_WALLET, GBP: TEST_GBP_WALLET },
    }), { at: NOW_S - 60 });
    assert.equal(JSON.parse(v140.content).version, '1.4.0');
    // Ravena Plus names only its wallets per currency — no default, no payout wallet — and buys only.
    const ravena140 = dealerEvent(ravena, 'ravena-plus', dealerContent({
      host: 'ravenaplus.test', name: 'Ravena Plus d.o.o.', roles: ['buys'], receiveWallets: { EUR: TEST_EUR_WALLET },
    }), { at: NOW_S - 60 });
    const relays = fakeRelays([...events, v140, ravena140], 2, 2, true);
    const files = fakeSites(sites);
    const answer = await createBuyingDealersReader({
      db: () => paramsDb(JSON.stringify(params38888({ reliable }))),
      author: authority.pub,
      now: () => NOW_MS,
      reader: { fetchEvents: relays.source, fetchWellKnown: files.lookup },
    }).get();
    assert.equal(answer.status, 'read');
    assert.deepEqual(answer.buyers.map((b) => [b.slug, b.eventId, b.signedAt]), [
      ['krog-menjave', v140.id, new Date((NOW_S - 60) * 1000).toISOString()],
      ['ravena-plus', ravena140.id, new Date((NOW_S - 60) * 1000).toISOString()],
    ]);
    const text = JSON.stringify(answer);
    for (const wallet of [TEST_EUR_WALLET, TEST_GBP_WALLET, TEST_RECEIVE_WALLET, TEST_PAYOUT_WALLET]) {
      assert.ok(!text.includes(wallet), 'no wallet is in the answer');
    }
  });

  it('buyersOf keeps only "buys", in name order, links on the host', () => {
    const d = (name: string, host: string, roles: ('sells' | 'buys')[]): ListedDealer => ({
      host, slug: host.split('.')[0], name, website: `https://${host}/o-nas`, roles, admins: [], eventId: 'x', pubkey: 'y', signedAt: NOW_S, contentVersion: '1.1.0',
    });
    const out = buyersOf([d('zeta', 'z.test', ['buys']), d('Alpha', 'a.test', ['sells', 'buys']), d('Beta', 'b.test', ['sells'])]);
    assert.deepEqual(out.map((b) => b.name), ['Alpha', 'zeta']);
    assert.equal(out[0].website, 'https://a.test/');
  });
});

/* ── the memory ───────────────────────────────────────────────────────────── */

describe('what is kept, and for how long', () => {
  const listed = (name: string, host: string, admins = ['a'.repeat(64)]): ListedDealer => ({
    host, slug: host.split('.')[0], name, website: `https://${host}/`, roles: ['sells', 'buys'], admins, eventId: '1'.repeat(64), pubkey: admins[0], signedAt: NOW_S, contentVersion: '1.1.0',
  });
  const good = (...dealers: ListedDealer[]): DealerRead => ({ read: true, listed: dealers, removed: [], notListed: [], relays: { asked: 2, answered: 2 } });
  const silence = (removed: string[] = []): DealerRead => ({
    read: false, skipped: 'the relays did not answer', reason: 'the relays did not answer', removed: removed.map((dealer) => ({ dealer, reason: 'gone' })),
  });

  let clock = NOW_MS;
  let reads = 0;
  let next: () => Promise<DealerRead>;
  const reader = (extra: Partial<BuyingDealersReaderDeps> = {}) => createBuyingDealersReader({
    db: () => paramsDb(null),
    now: () => clock,
    read: async () => { reads++; return next(); },
    ...extra,
  });
  beforeEach(() => { clock = NOW_MS; reads = 0; });

  it('a good read is answered as it is for ten minutes, with no second read', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    assert.deepEqual((await r.get()).buyers.map((b) => b.name), ['Krog']);
    clock += DEALER_REFRESH_INTERVAL_MS - 1;
    const again = await r.get();
    assert.equal(again.status, 'read');
    assert.equal(reads, 1);
  });

  it('an older one is answered at once, stale, while exactly one read runs behind it', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    await r.get();
    let release!: () => void;
    next = () => new Promise<DealerRead>((resolve) => { release = () => resolve(good(listed('Krog', 'krog.test'), listed('Ravena', 'ravena.test'))); });
    clock += DEALER_REFRESH_INTERVAL_MS;
    const [a, b] = await Promise.all([r.get(), r.get()]);
    assert.deepEqual([a.status, b.status], ['stale', 'stale']);
    assert.deepEqual(a.buyers.map((x) => x.name), ['Krog']);
    assert.equal(reads, 2);
    release();
    await r.refresh();
    const after = await r.get();
    assert.equal(after.status, 'read');
    assert.deepEqual(after.buyers.map((x) => x.name), ['Krog', 'Ravena']);
  });

  it('never read: waits at most maxWaitMs for the first read, then answers unknown with no firm', async () => {
    next = () => new Promise<DealerRead>(() => { /* a read that never ends */ });
    const r = reader();
    const started = Date.now();
    const answer = await r.get({ maxWaitMs: 50 });
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(answer, { status: 'unknown', readAt: null, staleSince: null, directoryUrl: BEF_DIRECTORY_URL, buyers: [] } satisfies BuyingDealersAnswer);
    // peek() never waits at all.
    assert.equal(r.peek().status, 'unknown');
    assert.equal(reads, 1);
  });

  it('a read that decides nothing keeps the last good list, says since when — and drops only a dealer the KIND 38888 no longer backs', async () => {
    next = async () => good(listed('Krog', 'krog.test'), listed('Ravena', 'ravena.test'));
    const r = reader();
    await r.get();
    clock += DEALER_REFRESH_INTERVAL_MS;
    next = async () => silence(['ravena.test/ravena']);
    await r.refresh();
    const answer = r.peek();
    assert.equal(answer.status, 'stale');
    assert.equal(answer.staleSince, new Date(clock).toISOString());
    assert.equal(answer.readAt, new Date(NOW_MS).toISOString());
    assert.deepEqual(answer.buyers.map((b) => b.name), ['Krog']);
    // …and does not try again for a minute.
    const before = reads;
    clock += RETRY_AFTER_FAILURE_MS - 1;
    r.peek();
    assert.equal(reads, before);
    clock += 1;
    r.peek();
    assert.equal(reads, before + 1);
  });

  it('a good read that lists nobody is an answer: no firm, status read', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    await r.get();
    clock += DEALER_REFRESH_INTERVAL_MS;
    next = async () => good();
    await r.refresh();
    const answer = r.peek();
    assert.deepEqual([answer.status, answer.buyers], ['read', []]);
  });

  it('a read that throws is a silence, not a crash', async () => {
    next = async () => { throw new Error('boom'); };
    const r = reader();
    const answer = await r.get();
    assert.equal(answer.status, 'unknown');
  });

  it('a read that throws before its first await does not block every read after it', async () => {
    // A settled promise left in `inFlight` made due() false for good: no read
    // ever again, and the answer frozen as it was.
    const r = reader({ read: () => { reads++; throw new Error('the database handle is closed'); } });
    assert.equal((await r.get({ maxWaitMs: 50 })).status, 'unknown');
    assert.equal(reads, 1);
    clock += RETRY_AFTER_FAILURE_MS;
    await r.get({ maxWaitMs: 50 });
    assert.equal(reads, 2);
  });
});

/* ── how old an answer may be ─────────────────────────────────────────────── */

describe('an answer is never older than a read cycle or two', () => {
  const listed = (name: string, host: string): ListedDealer => ({
    host, slug: host.split('.')[0], name, website: `https://${host}/`, roles: ['sells', 'buys'], admins: ['a'.repeat(64)],
    eventId: '1'.repeat(64), pubkey: 'a'.repeat(64), signedAt: NOW_S, contentVersion: '1.1.0',
  });
  const good = (...dealers: ListedDealer[]): DealerRead => ({ read: true, listed: dealers, removed: [], notListed: [], relays: { asked: 2, answered: 2 } });
  const silence: DealerRead = { read: false, skipped: 'the relays did not answer', reason: 'the relays did not answer', removed: [] };
  const later = <T,>(value: T, ms = 20) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  let clock = NOW_MS;
  let reads = 0;
  let next: () => Promise<DealerRead>;
  const reader = (extra: Partial<BuyingDealersReaderDeps> = {}) => createBuyingDealersReader({
    db: () => paramsDb(null),
    now: () => clock,
    read: async () => { reads++; return next(); },
    ...extra,
  });
  beforeEach(() => { clock = NOW_MS; reads = 0; });

  it('an answer more than twenty minutes old is not served as it is when a read can finish within the wait', async () => {
    assert.equal(MAX_ANSWER_AGE_MS, 2 * DEALER_REFRESH_INTERVAL_MS);
    next = async () => good(listed('Krog', 'krog.test'), listed('Ravena', 'ravena.test'));
    const r = reader();
    await r.get();
    // Three hours of nobody. Meanwhile Ravena has retired.
    clock += 3 * 60 * 60 * 1000;
    next = () => later(good(listed('Krog', 'krog.test')));
    const answer = await r.get({ maxWaitMs: 5_000 });
    assert.equal(answer.status, 'read');
    assert.equal(answer.readAt, new Date(clock).toISOString());
    assert.deepEqual(answer.buyers.map((b) => b.name), ['Krog']);
  });

  it('…and is still answered, stale, when that read does not finish within the wait', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    await r.get();
    clock += MAX_ANSWER_AGE_MS;
    next = () => new Promise<DealerRead>(() => { /* never */ });
    const started = Date.now();
    const answer = await r.get({ maxWaitMs: 50 });
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual([answer.status, answer.buyers.map((b) => b.name)], ['stale', ['Krog']]);
  });

  it('after a failed read nobody waits for the next one: the stale answer comes at once', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    await r.get();
    clock += DEALER_REFRESH_INTERVAL_MS;
    next = async () => silence;
    await r.refresh();
    clock += MAX_ANSWER_AGE_MS;
    next = () => new Promise<DealerRead>(() => { /* the relays are still silent */ });
    const started = Date.now();
    const answer = await r.get({ maxWaitMs: 5_000 });
    assert.ok(Date.now() - started < 1000);
    assert.equal(answer.status, 'stale');
    assert.equal(reads, 3);
  });

  it('peek() never waits, however old the answer', async () => {
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader();
    await r.get();
    clock += 3 * 60 * 60 * 1000;
    next = () => new Promise<DealerRead>(() => { /* never */ });
    assert.equal(r.peek().status, 'stale');
  });

  it('keepFresh reads by itself every ten minutes from first use — no visitor needed', async () => {
    const ticks: { ms: number; tick: () => void }[] = [];
    next = async () => good(listed('Krog', 'krog.test'), listed('Ravena', 'ravena.test'));
    const r = reader({ keepFresh: true, every: (ms, tick) => { ticks.push({ ms, tick }); } });
    // Nothing is scheduled by creating it — a test that imports a route starts no timer.
    assert.equal(ticks.length, 0);
    await r.get();
    r.peek();
    assert.deepEqual(ticks.map((t) => t.ms), [KEEP_FRESH_TICK_MS]);
    // A tick before a read is due reads nothing.
    clock += DEALER_REFRESH_INTERVAL_MS - 1;
    ticks[0].tick();
    assert.equal(reads, 1);
    // Ravena retires; ten minutes on, the tick reads — nobody has asked.
    next = async () => good(listed('Krog', 'krog.test'));
    clock += 1;
    ticks[0].tick();
    assert.equal(reads, 2);
    await r.refresh();
    const answer = r.peek();
    assert.deepEqual([answer.status, answer.buyers.map((b) => b.name)], ['read', ['Krog']]);
  });

  it('without keepFresh nothing is scheduled', async () => {
    const ticks: number[] = [];
    next = async () => good(listed('Krog', 'krog.test'));
    const r = reader({ every: (ms) => { ticks.push(ms); } });
    await r.get();
    r.peek();
    assert.deepEqual(ticks, []);
  });

  it('the shared reader keeps itself fresh, and its timer never keeps the process alive', () => {
    const shared = fs.readFileSync(path.join(LIB, 'buyingDealersShared.ts'), 'utf8');
    assert.match(shared, /createBuyingDealersReader\(\{ db: getDb, keepFresh: true \}\)/);
    assert.match(shared, /import \{ getDb \} from '\.\.\/db\/connection\.js'/);
    const reader = fs.readFileSync(path.join(LIB, 'buyingDealers.ts'), 'utf8');
    assert.match(reader, /const timer = setInterval\(tick, ms\);\s*timer\.unref\?\.\(\);/);
  });
});

/* ── a silence ────────────────────────────────────────────────────────────── */

/**
 * Real reads (readDealers, BEF's rule, unchanged) against relays and sites in
 * memory: what a site that does not answer once, or a relay that misses a
 * profile, does to the firms named — and what a real refusal does.
 */
describe('a firm whose site or relays are silent once is still named', () => {
  const krog = newIdentity();
  const ravena = newIdentity();
  const KROG = 'Krog menjave, trgovanje in kroženje vrednosti d.o.o.';
  const RAVENA = 'Ravena Plus d.o.o.';
  const krogEvent = dealerEvent(krog, 'krog-menjave', dealerContent({ host: 'krogmenjave.test', name: KROG }));
  const ravenaEvent = dealerEvent(ravena, 'ravena-plus', dealerContent({ host: 'ravenaplus.test', name: RAVENA }));
  const ravenaRetired = dealerEvent(ravena, 'ravena-plus', dealerContent({ host: 'ravenaplus.test', name: RAVENA, status: 'retired' }), { at: NOW_S - 60 });
  const ravenaSite: SiteReply = { dealers: { 'ravena-plus': { admins: [ravena.hex] } } };

  let clock = NOW_MS;
  let events: NostrEvent[];
  let sites: Record<string, SiteReply>;
  let db: Database.Database;
  const setReliable = (hexes: string[]) => {
    db.prepare('UPDATE kind_38888 SET raw_event = ? WHERE id = ?').run(JSON.stringify(params38888({ reliable: hexes })), 'main');
  };
  const make = () => createBuyingDealersReader({
    db: () => db,
    author: authority.pub,
    now: () => clock,
    reader: {
      fetchEvents: async (r, f) => fakeRelays(events, 2, 2).source(r, f),
      fetchWellKnown: async (host) => fakeSites(sites).lookup(host),
    },
  });
  const names = (a: BuyingDealersAnswer) => a.buyers.map((b) => b.name);
  /** One read cycle later. */
  const cycle = async (r: ReturnType<typeof make>) => {
    clock += DEALER_REFRESH_INTERVAL_MS;
    await r.refresh();
    return r.peek();
  };

  beforeEach(() => {
    clock = NOW_MS;
    events = [krogEvent, ravenaEvent];
    sites = {
      'krogmenjave.test': { dealers: { 'krog-menjave': { admins: [krog.hex] } } },
      'ravenaplus.test': ravenaSite,
    };
    db = paramsDb(JSON.stringify(params38888({ reliable: [krog.hex, ravena.hex] })));
  });

  const bothNamed = async () => {
    const r = make();
    const first = await r.get();
    assert.equal(first.status, 'read');
    assert.deepEqual(names(first), [KROG, RAVENA]);
    return r;
  };

  it('a site timeout does not turn two firms into one — and the next good answer says "read" again', async () => {
    const r = await bothNamed();
    sites['ravenaplus.test'] = { down: 'timed out after 8000 ms' };
    const silent = await cycle(r);
    assert.deepEqual(names(silent), [KROG, RAVENA]);
    assert.equal(silent.status, 'stale');
    assert.equal(silent.staleSince, new Date(clock).toISOString());
    assert.equal(silent.readAt, new Date(clock).toISOString());
    // The link is the one the last good read built, on the verified host.
    assert.equal(silent.buyers[1].registerUrl, 'https://ravenaplus.test/prijava');

    sites['ravenaplus.test'] = ravenaSite;
    const back = await cycle(r);
    assert.deepEqual([back.status, back.staleSince], ['read', null]);
    assert.deepEqual(names(back), [KROG, RAVENA]);
  });

  it('a relay that misses the profile once does not either', async () => {
    const r = await bothNamed();
    events = [krogEvent];
    const silent = await cycle(r);
    assert.deepEqual(names(silent), [KROG, RAVENA]);
    assert.equal(silent.status, 'stale');
  });

  it('kept for an hour at most: a site silent that long is taken off, as BEF Explorer does at once', async () => {
    const r = await bothNamed();
    sites['ravenaplus.test'] = { down: 'unreachable (ECONNREFUSED)' };
    const since = clock + DEALER_REFRESH_INTERVAL_MS;
    let answer = await cycle(r);
    while (clock + DEALER_REFRESH_INTERVAL_MS - since < HOLD_UNCONFIRMED_MS) {
      answer = await cycle(r);
      assert.deepEqual(names(answer), [KROG, RAVENA]);
      assert.equal(answer.staleSince, new Date(since).toISOString());
    }
    answer = await cycle(r);
    assert.equal(clock - since, HOLD_UNCONFIRMED_MS);
    assert.deepEqual(names(answer), [KROG]);
    assert.deepEqual([answer.status, answer.staleSince], ['read', null]);
    // And when the site answers again, the firm is back on the next read.
    sites['ravenaplus.test'] = ravenaSite;
    assert.deepEqual(names(await cycle(r)), [KROG, RAVENA]);
  });

  it('a real refusal takes it off at once: retired', async () => {
    const r = await bothNamed();
    events = [krogEvent, ravenaEvent, ravenaRetired];
    const answer = await cycle(r);
    assert.deepEqual(names(answer), [KROG]);
    assert.equal(answer.status, 'read');
  });

  it('a real refusal takes it off at once: its own site no longer lists it', async () => {
    const r = await bothNamed();
    sites['ravenaplus.test'] = { dealers: {} };
    assert.deepEqual(names(await cycle(r)), [KROG]);
  });

  it('a silent site is no shelter for a firm the KIND 38888 no longer backs', async () => {
    const r = await bothNamed();
    sites['ravenaplus.test'] = { down: 'timed out after 8000 ms' };
    setReliable([krog.hex]);
    assert.deepEqual(names(await cycle(r)), [KROG]);
  });

  it('removedBySilence knows exactly the three silences, for that dealer only', () => {
    const d = { host: 'ravenaplus.test', slug: 'ravena-plus' };
    const line = (reason: string, dealer = 'ravenaplus.test/ravena-plus') => ({ dealer, reason });
    assert.equal(removedBySilence(line('ravenaplus.test did not answer: timed out after 8000 ms'), d), true);
    assert.equal(removedBySilence(line(`ravenaplus.test was not asked in this run (more than ${MAX_HOSTS_PER_RUN} sites)`), d), true);
    assert.equal(removedBySilence(line('no valid profile signed by a key ravenaplus.test lists for "ravena-plus" came back from the relays'), d), true);
    for (const refusal of [
      'its own profile says it is retired',
      'ravenaplus.test does not list "ravena-plus" in its dealer file',
      'none of the admins ravenaplus.test lists for "ravena-plus" is a reliable person in KIND 38888',
      'ravenaplus.test no longer lists the key that signed its profile',
      'its newest profile names another website (elsewhere.test)',
      'its profile does not say whether it buys or sells LANA (content.version 1.0.0, no roles)',
      'KIND 38888 names no reliable person',
      'none of the admins its site listed is a reliable person in KIND 38888 any more',
    ]) assert.equal(removedBySilence(line(refusal), d), false, refusal);
    // Another dealer's silence, or another host's, is not this one's.
    assert.equal(removedBySilence(line('ravenaplus.test did not answer: x', 'krogmenjave.test/krog-menjave'), d), false);
    assert.equal(removedBySilence(line('krogmenjave.test did not answer: x'), d), false);
  });
});

/* ── the copies ───────────────────────────────────────────────────────────── */

/**
 * Three files are BEF Explorer's own, byte for byte (bef-explorer a7d3702;
 * dealerShape.ts as BEF Explorer reads KIND 30972 content "1.4.0" on top of it
 * — spec v1.6.0, a receive wallet per currency), and wellKnown.ts differs from
 * its original in the user-agent line only — it names this app, not BEF
 * Explorer, to the dealer's server. A change to any of them is a change to the
 * dealer rule: make it in bef-explorer first, copy it here (and to
 * lana.discount), and update the hash in the same commit.
 */
describe('the files copied from BEF Explorer', () => {
  const file = (rel: string) => fs.readFileSync(path.join(LIB, 'befDealers', rel));
  const sha = (rel: string) => createHash('sha256').update(file(rel)).digest('hex');
  it('are the copies they claim to be', () => {
    assert.equal(sha('bankSchemes.ts'), '25f6993f075bf37be1b70fcffd0e95284aec6d8f8d8ee4a3e259659c95865488');
    assert.equal(sha('lanaAddress.ts'), 'f709b6a06475413d4dfcaf4179328e3bf7726b410b40633504a9e26afeea9b02');
    assert.equal(sha('dealerShape.ts'), '244b5fbf5c9442eaa4eb05647230016ca01bb9988980f45b794335da74c7b01d');
    // bef-explorer's is c5669bb3…c229, lana.discount's c6be9bec…7289.
    assert.equal(sha('wellKnown.ts'), '4c5eafb2d0452264cecea6d008f14121c13d4509c90051a628b3d7ac25aaf524');
    assert.ok(file('wellKnown.ts').toString('utf8').includes("'user-agent': 'MejmoSefajn (app.mejmosefajn.org) KIND 30972 reader'"));
  });
});
