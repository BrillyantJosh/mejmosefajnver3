/**
 * LanaCrowd writes: each one rests on a signed event.
 *   npm run test:lanacrowd
 *
 *   PATCH  /projects/:id/admin  signed by an admin, the fields from the signed content
 *   DELETE /projects/:id        signed by the owner or an admin, or the owner's KIND 5
 *   POST   /projects/upsert     the owner's KIND 31234
 *   POST   /donations/record    the donor's KIND 60200
 *
 * The events are built the way their real senders build them: the admin screen and
 * My Projects through src/lib/lanacrowdSigned.ts, ProjectForm and DonatePrivateKey
 * with roles at tag index 2, LetsBalance.world and being3 with roles at index 3.
 *
 * The relay indexer reads the same events: a row it writes is the row the route
 * wrote, and an event from another author does not take a project over.
 *
 * The REAL router is mounted on a fresh express() at 127.0.0.1 on a THROWAWAY
 * database (MEJMO_DB_PATH, in the OS temp dir) with a fake relay on 127.0.0.1:
 * server/index.ts is never imported, and nothing near data/mejmosefajn.db or a
 * real relay is reached.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

// The database must be chosen BEFORE anything opens it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lanacrowd-signed-'));
process.env.MEJMO_DB_PATH = path.join(tmp, 'throwaway.db');

const { default: express } = await import('express');
const { getDb, closeDb } = await import('../db/connection.js') as any;
const { default: lanacrowdRoutes } = await import('../routes/lanacrowd.js');
const { indexLanacrowdFromRelays } = await import('../lib/nostr.js');
const { closeRelayPool } = await import('../lib/relayPool.js');
const { LANACROWD_ACTION_ADMIN, LANACROWD_ACTION_DELETE, signLanacrowdAction } = await import('../../src/lib/lanacrowdSigned.js');

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
interface Key { sk: Uint8Array; hex: string; pk: string }
const newKey = (): Key => { const sk = generateSecretKey(); return { sk, hex: toHex(sk), pk: getPublicKey(sk) }; };

const admin = newKey();
const owner = newKey();
const stranger = newKey();
const donor = newKey();
const now = () => Math.floor(Date.now() / 1000);
const PROJECT = `project:${'a'.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}`;
const OTHER = `project:${'b'.repeat(8)}-bbbb-4bbb-8bbb-${'b'.repeat(12)}`;
const WALLET = 'L'.padEnd(34, 'q');

const relayEvents: Event[] = [];
const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
relay.on('connection', (socket) => {
  socket.on('message', (raw) => {
    const [type, sub, filter] = JSON.parse(raw.toString());
    if (type !== 'REQ') return;
    for (const e of relayEvents) if (filter.kinds?.includes(e.kind)) socket.send(JSON.stringify(['EVENT', sub, e]));
    socket.send(JSON.stringify(['EOSE', sub]));
  });
});

let server: Server;
let api: string;
before(async () => {
  await new Promise<void>((resolve) => { if (relay.address()) resolve(); else relay.on('listening', () => resolve()); });
  // The seed points at the real relays: replace it before anything can read it.
  getDb().prepare('DELETE FROM kind_38888').run();
  getDb().prepare(`INSERT INTO kind_38888 (event_id, pubkey, created_at, relays, electrum_servers, exchange_rates, raw_event)
                   VALUES ('test', 'x', ?, ?, '[]', '{}', '{}')`).run(now(), JSON.stringify([`ws://127.0.0.1:${(relay.address() as AddressInfo).port}`]));

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/lanacrowd', lanacrowdRoutes);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lanacrowd`;
});
after(() => {
  server.closeAllConnections?.();
  server.close();
  closeRelayPool();
  for (const c of relay.clients) c.terminate();
  relay.close();
  closeDb?.();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const send = async (method: string, route: string, body: unknown) => {
  const r = await fetch(api + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};

function seedProject(id = PROJECT, flags: Record<string, number> = {}, by: Key = owner, at = now() - 1000) {
  const f = { is_hidden: 0, is_approved: 1, is_funded: 0, is_completed: 0, ...flags };
  getDb().prepare(`
    INSERT INTO lanacrowd_projects (id, event_id, pubkey, owner_pubkey, title, wallet, fiat_goal, is_hidden, is_approved, is_funded, is_completed, nostr_created_at)
    VALUES (?, ?, ?, ?, 'Seeded', ?, 100, ?, ?, ?, ?, ?)
  `).run(id, `seed-${id}`, by.pk, by.pk, WALLET, f.is_hidden, f.is_approved, f.is_funded, f.is_completed, at);
}
const row = (id = PROJECT) => getDb().prepare('SELECT * FROM lanacrowd_projects WHERE id = ?').get(id) as any;
const donationsOf = (id = PROJECT) => getDb().prepare('SELECT * FROM lanacrowd_donations WHERE project_id = ?').all(id) as any[];

beforeEach(() => {
  relayEvents.length = 0;
  const db = getDb();
  db.prepare('DELETE FROM lanacrowd_projects').run();
  db.prepare('DELETE FROM lanacrowd_donations').run();
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('100millionideas_admins', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify([admin.pk]));
});

const adminAction = (by: Key, id: string, fields: Record<string, unknown>) =>
  signLanacrowdAction({ method: 'PATCH', url: `/api/lanacrowd/projects/${id}/admin`, action: LANACROWD_ACTION_ADMIN, id, fields }, by.hex);
const deleteAction = (by: Key, id: string) =>
  signLanacrowdAction({ method: 'DELETE', url: `/api/lanacrowd/projects/${id}`, action: LANACROWD_ACTION_DELETE, id }, by.hex);

/** Any kind 27235 with chosen parts, for the requests the helper would never build. */
const action = (by: Key, content: unknown, method = 'PATCH', createdAt = now()) =>
  finalizeEvent({ kind: 27235, created_at: createdAt, tags: [['method', method]], content: JSON.stringify(content) }, by.sk);

const tampered = (e: Event, change: Partial<Event>) => ({ ...e, ...change });

/** As ProjectForm builds it. */
const projectEvent = (by: Key, opts: { id?: string; at?: number; wallet?: string; title?: string; ownerTag?: string[] } = {}) =>
  finalizeEvent({
    kind: 31234,
    created_at: opts.at ?? now(),
    content: 'What this project is about, in enough words.',
    tags: [
      ['d', opts.id ?? PROJECT],
      ['service', 'lanacrowd'],
      ['title', opts.title ?? 'A signed project'],
      ['short_desc', 'Short'],
      ['fiat_goal', '200.00'],
      ['currency', 'EUR'],
      ['wallet', opts.wallet ?? WALLET],
      ['responsibility_statement', 'I take responsibility for this.'],
      ['project_type', 'Inspiration'],
      ['status', 'active'],
      opts.ownerTag ?? ['p', by.pk, 'owner'],
      ['img', '/api/storage/project-images/a.png', 'cover'],
      ['img', '/api/storage/project-images/b.png', 'gallery'],
      ['video', 'https://example.test/v.mp4', 'primary'],
      ['file', 'https://example.test/f.pdf', 'pdf'],
    ],
  }, by.sk);

/** As DonatePrivateKey builds it: roles at index 2. */
const donationEvent = (by: Key, opts: { project?: string; fiat?: string; type?: string; at?: number } = {}) =>
  finalizeEvent({
    kind: 60200,
    created_at: opts.at ?? now(),
    content: 'For the project',
    tags: [
      ['service', 'lanacrowd'],
      ['project', opts.project ?? PROJECT],
      ['p', by.pk, 'supporter'],
      ['p', owner.pk, 'project_owner'],
      ['amount_lanoshis', '123456'],
      ['amount_fiat', opts.fiat ?? '10.00'],
      ['currency', 'EUR'],
      ['from_wallet', 'Lfrom'],
      ['to_wallet', WALLET],
      ['tx', 'c'.repeat(64)],
      ['type', opts.type ?? 'donation'],
    ],
  }, by.sk);

/** As LetsBalance's donationReceipts builds it: roles at index 3. */
const letsBalanceDonation = (by: Key) =>
  finalizeEvent({
    kind: 60200,
    created_at: now(),
    content: 'Donated through LetsBalance',
    tags: [
      ['service', 'lanacrowd'],
      ['project', PROJECT],
      ['e', 'e'.repeat(64)],
      ['p', by.pk, '', 'supporter'],
      ['p', owner.pk, '', 'project_owner'],
      ['amount_lanoshis', '777'],
      ['amount_fiat', '5.00'],
      ['currency', 'EUR'],
      ['from_wallet', 'Lfrom'],
      ['to_wallet', WALLET],
      ['tx', 'd'.repeat(64)],
      ['type', 'donation'],
      ['timestamp_paid', String(now())],
    ],
  }, by.sk);

/** As LetsBalance's DonateScreen builds it. */
const letsBalanceDeletion = (by: Key, opts: { id?: string; addressedTo?: string; at?: number } = {}) =>
  finalizeEvent({
    kind: 5,
    created_at: opts.at ?? now(),
    content: 'Project deleted by owner',
    tags: [
      ['a', `31234:${opts.addressedTo ?? by.pk}:${opts.id ?? PROJECT}`],
      ['k', '31234'],
      ['e', 'f'.repeat(64)],
    ],
  }, by.sk);

describe('PATCH /projects/:id/admin', () => {
  const flags = () => { const r = row(); return [r.is_hidden, r.is_approved, r.is_funded, r.is_completed]; };

  it('refuses a request without a signed event, whatever it names', async () => {
    seedProject();
    for (const body of [{}, { adminPubkey: admin.pk, is_hidden: true }, { adminPubkey: admin.pk, is_approved: false, event: null }]) {
      const r = await send('PATCH', `/projects/${PROJECT}/admin`, body);
      assert.equal(r.status, 401, JSON.stringify(body));
    }
    assert.deepEqual(flags(), [0, 1, 0, 0]);
  });

  it('refuses a signer who is not an admin, and an event that does not verify', async () => {
    seedProject();
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(stranger, PROJECT, { is_hidden: true }) })).status, 403);
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(owner, PROJECT, { is_hidden: true }) })).status, 403, 'the owner is not an admin');

    const real = adminAction(admin, PROJECT, { is_approved: false });
    const altered = { ...real, content: JSON.stringify({ action: LANACROWD_ACTION_ADMIN, id: PROJECT, is_hidden: true }) };
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: altered })).status, 401, 'content changed after signing');
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: tampered(real, { pubkey: stranger.pk }) })).status, 401, 'another key named on the event');
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: tampered(real, { sig: 'a'.repeat(128) }) })).status, 401, 'a made-up signature');
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: { ...real, tags: [null] } })).status, 401, 'malformed tags');
    assert.deepEqual(flags(), [0, 1, 0, 0]);
  });

  it('refuses an event signed for another project, method, action or time', async () => {
    seedProject();
    seedProject(OTHER);
    const send1 = async (event: unknown, why: string) =>
      assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event })).status, 401, why);
    await send1(adminAction(admin, OTHER, { is_hidden: true }), 'another project');
    await send1(action(admin, { action: LANACROWD_ACTION_ADMIN, id: PROJECT, is_hidden: true }, 'DELETE'), 'another method');
    await send1(action(admin, { action: LANACROWD_ACTION_DELETE, id: PROJECT, is_hidden: true }), 'another action');
    await send1(action(admin, { action: LANACROWD_ACTION_ADMIN, id: PROJECT, is_hidden: true }, 'PATCH', now() - 301), 'expired');
    await send1(action(admin, { action: LANACROWD_ACTION_ADMIN, id: PROJECT, is_hidden: true }, 'PATCH', now() + 310), 'dated ahead');
    assert.deepEqual(flags(), [0, 1, 0, 0]);
    assert.equal(row(OTHER).is_hidden, 0);
  });

  it('writes what the admin signed, and only that, once', async () => {
    seedProject();
    const event = adminAction(admin, PROJECT, { is_hidden: true });
    const r = await send('PATCH', `/projects/${PROJECT}/admin`, { event, is_hidden: false, is_approved: false, adminPubkey: stranger.pk });
    assert.equal(r.status, 200);
    assert.deepEqual(flags(), [1, 1, 0, 0], 'the flags in the body count for nothing');

    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { is_hidden: false }) })).status, 200);
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event })).status, 401, 'a replay does not undo what the admin did after');
    assert.deepEqual(flags(), [0, 1, 0, 0]);
  });

  it('handles each toggle of the admin screen, and two clicks in the same second', async () => {
    seedProject(PROJECT, { is_approved: 0 });
    for (const fields of [{ is_approved: true }, { is_approved: false }, { is_approved: true }]) {
      assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, fields) })).status, 200);
    }
    assert.equal(row().is_approved, 1);
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { is_completed: true, completion_comment: 'Funds delivered' }) })).status, 200);
    assert.equal(row().is_completed, 1);
    assert.equal(row().completion_comment, 'Funds delivered');
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { is_completed: false, completion_comment: null }) })).status, 200);
    assert.equal(row().is_completed, 0);
    assert.equal(row().completion_comment, null);
  });

  it('refuses fields of the wrong type or none at all, without spending the event', async () => {
    seedProject();
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { is_hidden: 'yes' }) })).status, 400);
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { completion_comment: 5 }) })).status, 400);
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, {}) })).status, 400);
    assert.deepEqual(flags(), [0, 1, 0, 0]);
  });

  it('answers 404 for a project that does not exist', async () => {
    assert.equal((await send('PATCH', `/projects/${PROJECT}/admin`, { event: adminAction(admin, PROJECT, { is_hidden: true }) })).status, 404);
  });
});

describe('DELETE /projects/:id', () => {
  it('refuses a request without a signed event, whatever it names', async () => {
    seedProject();
    for (const body of [{}, { requesterPubkey: owner.pk }, { requesterPubkey: admin.pk }]) {
      assert.equal((await send('DELETE', `/projects/${PROJECT}`, body)).status, 401, JSON.stringify(body));
    }
    assert.ok(row());
  });

  it('a signed action: the owner and an admin may, a stranger may not, a replay finds nothing to spend', async () => {
    seedProject();
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(stranger, PROJECT) })).status, 403);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: tampered(deleteAction(owner, PROJECT), { sig: 'a'.repeat(128) }) })).status, 401);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(owner, OTHER) })).status, 401, 'signed for another project');
    assert.ok(row());

    const event = deleteAction(owner, PROJECT);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event })).status, 200);
    assert.equal(row(), undefined);

    seedProject();
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event })).status, 401, 'the same event does not delete the project again');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(admin, PROJECT) })).status, 200);
    assert.equal(row(), undefined);
  });

  it('a hidden project stays an admin\'s to delete, whichever proof the owner brings', async () => {
    seedProject(PROJECT, { is_hidden: 1 });
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(owner, PROJECT) })).status, 403);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner) })).status, 403);
    assert.equal(row().is_hidden, 1);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(admin, PROJECT) })).status, 200);
  });

  it('a project with a recorded donation is not deleted', async () => {
    seedProject();
    assert.equal((await send('POST', '/donations/record', { event: donationEvent(donor) })).status, 200);
    const r = await send('DELETE', `/projects/${PROJECT}`, { event: deleteAction(owner, PROJECT) });
    assert.equal(r.status, 409);
    assert.equal(r.body.donationCount, 1);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner) })).status, 409);
    assert.ok(row());
  });

  it('LetsBalance: the owner\'s own KIND 5 deletes, and nobody else\'s does', async () => {
    seedProject();
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(stranger, { addressedTo: owner.pk }) })).status, 401, 'a KIND 5 naming someone else\'s project');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(stranger) })).status, 403, 'a stranger\'s own address on this id');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(admin) })).status, 403, 'a KIND 5 speaks for its author, not for an admin');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner, { id: OTHER }) })).status, 401, 'another project');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: tampered(letsBalanceDeletion(owner), { sig: 'a'.repeat(128) }) })).status, 401, 'does not verify');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner, { at: now() - 86401 }) })).status, 401, 'older than a day');
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner, { at: now() + 310 }) })).status, 401, 'dated ahead');
    assert.ok(row());

    const event = letsBalanceDeletion(owner);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event })).status, 200);
    assert.equal(row(), undefined);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event })).status, 404, 'LetsBalance retrying the same event');
  });

  it('a KIND 5 does not reach a version newer than itself', async () => {
    const signedAt = now() - 100;
    seedProject(PROJECT, {}, owner, signedAt + 10);
    assert.equal((await send('DELETE', `/projects/${PROJECT}`, { event: letsBalanceDeletion(owner, { at: signedAt }) })).status, 409);
    assert.ok(row());
  });
});

describe('POST /projects/upsert', () => {
  it('refuses a request without a signed project, and writes nothing', async () => {
    for (const body of [{}, { project: { id: PROJECT, title: 'Unsigned', pubkey: owner.pk, ownerPubkey: owner.pk, wallet: WALLET } }]) {
      assert.equal((await send('POST', '/projects/upsert', body)).status, 401, JSON.stringify(body));
    }
    assert.equal(row(), undefined);
  });

  it('refuses an event that does not verify or is another kind', async () => {
    const e = projectEvent(owner);
    const altered = { ...e, tags: e.tags.map((t) => (t[0] === 'wallet' ? ['wallet', 'Lother'] : t)) };
    assert.equal((await send('POST', '/projects/upsert', { event: altered })).status, 401, 'wallet changed after signing');
    assert.equal((await send('POST', '/projects/upsert', { event: tampered(e, { sig: 'a'.repeat(128) }) })).status, 401);
    assert.equal((await send('POST', '/projects/upsert', { event: donationEvent(owner) })).status, 401, 'kind 60200');
    assert.equal((await send('POST', '/projects/upsert', { project: { id: PROJECT, title: 'x' }, event: tampered(e, { id: 'a'.repeat(64) }) })).status, 401);
    assert.equal(row(), undefined);
  });

  it('stores a new project from the event alone, unapproved, whatever the body says', async () => {
    const event = projectEvent(owner);
    const r = await send('POST', '/projects/upsert', { event, project: { id: OTHER, title: 'Body', wallet: 'Lbody', pubkey: stranger.pk } });
    assert.equal(r.status, 200);
    assert.equal(row(OTHER), undefined);
    const p = row();
    assert.equal(p.event_id, event.id);
    assert.equal(p.pubkey, owner.pk);
    assert.equal(p.owner_pubkey, owner.pk);
    assert.equal(p.title, 'A signed project');
    assert.equal(p.wallet, WALLET);
    assert.equal(p.fiat_goal, 200);
    assert.equal(p.cover_image, '/api/storage/project-images/a.png');
    assert.deepEqual(JSON.parse(p.gallery_images), ['/api/storage/project-images/b.png']);
    assert.deepEqual(JSON.parse(p.videos), ['https://example.test/v.mp4']);
    assert.deepEqual(JSON.parse(p.files), ['https://example.test/f.pdf']);
    assert.equal(p.nostr_created_at, event.created_at);
    assert.deepEqual([p.is_hidden, p.is_approved, p.is_funded, p.is_completed], [0, 0, 0, 0]);
  });

  it('accepts the tag shape LetsBalance and being3 sign (the owner role at index 3)', async () => {
    const event = projectEvent(owner, { ownerTag: ['p', owner.pk, '', 'owner'] });
    assert.equal((await send('POST', '/projects/upsert', { event })).status, 200);
    assert.equal(row().owner_pubkey, owner.pk);
  });

  it('a project stays its owner\'s: another signer, or an owner tag naming someone else, changes nothing', async () => {
    seedProject(PROJECT, { is_approved: 1, is_hidden: 1, is_completed: 1 });
    const before = row();
    assert.equal((await send('POST', '/projects/upsert', { event: projectEvent(stranger, { wallet: 'Lstranger' }) })).status, 403);
    assert.equal((await send('POST', '/projects/upsert', { event: projectEvent(admin, { wallet: 'Ladmin' }) })).status, 403);
    assert.deepEqual(row(), before);

    assert.equal((await send('POST', '/projects/upsert', { event: projectEvent(stranger, { id: OTHER, ownerTag: ['p', owner.pk, 'owner'] }) })).status, 403);
    assert.equal(row(OTHER), undefined);
  });

  it('the owner\'s update replaces the content and keeps the admin\'s flags', async () => {
    seedProject(PROJECT, { is_approved: 1, is_hidden: 1, is_funded: 1, is_completed: 1 });
    assert.equal((await send('POST', '/projects/upsert', { event: projectEvent(owner, { title: 'Edited' }) })).status, 200);
    const p = row();
    assert.equal(p.title, 'Edited');
    assert.deepEqual([p.is_hidden, p.is_approved, p.is_funded, p.is_completed], [1, 1, 1, 1]);
  });

  it('an older version does not replace a newer one; the same event again changes nothing', async () => {
    const at = now() - 100;
    const older = projectEvent(owner, { at: at - 50, wallet: 'Lolder' });
    const newer = projectEvent(owner, { at, wallet: 'Lnewer' });
    assert.equal((await send('POST', '/projects/upsert', { event: newer })).status, 200);
    assert.equal((await send('POST', '/projects/upsert', { event: older })).status, 409);
    assert.equal(row().wallet, 'Lnewer');
    const stored = row();
    assert.equal((await send('POST', '/projects/upsert', { event: newer })).status, 200);
    assert.deepEqual(row(), stored);
  });

  it('refuses a project with no title', async () => {
    const noTitle = finalizeEvent({ kind: 31234, created_at: now(), content: '', tags: [['d', PROJECT]] }, owner.sk);
    assert.equal((await send('POST', '/projects/upsert', { event: noTitle })).status, 400);
    assert.equal(row(), undefined);
  });
});

describe('POST /donations/record', () => {
  it('refuses a request without a signed donation, and writes nothing', async () => {
    seedProject();
    const legacy = { donation: { id: 'x', projectId: PROJECT, supporterPubkey: donor.pk, amountFiat: 1000 } };
    assert.equal((await send('POST', '/donations/record', legacy)).status, 401);
    assert.equal((await send('POST', '/donations/record', {})).status, 401);
    assert.equal(donationsOf().length, 0);
    assert.equal(row().is_funded, 0);
  });

  it('refuses an event that does not verify or is another kind', async () => {
    seedProject();
    const e = donationEvent(donor);
    const altered = { ...e, tags: e.tags.map((t) => (t[0] === 'amount_fiat' ? ['amount_fiat', '1000'] : t)) };
    assert.equal((await send('POST', '/donations/record', { event: altered })).status, 401, 'amount changed after signing');
    assert.equal((await send('POST', '/donations/record', { event: tampered(e, { sig: 'a'.repeat(128) }) })).status, 401);
    assert.equal((await send('POST', '/donations/record', { event: projectEvent(owner) })).status, 401, 'kind 31234');
    assert.equal(donationsOf().length, 0);
    assert.equal(row().is_funded, 0);
  });

  it('stores the donation from the event: the donor is the signer, the id the event id', async () => {
    seedProject();
    const event = donationEvent(donor);
    const r = await send('POST', '/donations/record', { event, donation: { id: 'body', projectId: OTHER, amountFiat: 9999 } });
    assert.equal(r.status, 200);
    assert.equal(donationsOf(OTHER).length, 0);
    const [d] = donationsOf();
    assert.equal(d.id, event.id);
    assert.equal(d.supporter_pubkey, donor.pk);
    assert.equal(d.project_owner_pubkey, owner.pk);
    assert.equal(d.amount_lanoshis, 123456);
    assert.equal(d.amount_fiat, 10);
    assert.equal(d.from_wallet, 'Lfrom');
    assert.equal(d.to_wallet, WALLET);
    assert.equal(d.tx_id, 'c'.repeat(64));
    assert.equal(d.message, 'For the project');
    assert.equal(d.nostr_created_at, event.created_at);
  });

  it('accepts the tag shape LetsBalance signs, and the owner still sees it as received', async () => {
    seedProject();
    assert.equal((await send('POST', '/donations/record', { event: letsBalanceDonation(donor) })).status, 200);
    const [d] = donationsOf();
    assert.equal(d.supporter_pubkey, donor.pk);
    assert.equal(d.project_owner_pubkey, owner.pk);
    assert.equal(d.amount_lanoshis, 777);
    const received = await (await fetch(`${api}/my-donations/${owner.pk}`)).json() as any;
    assert.equal(received.donations.length, 1);
  });

  it('a supporter tag naming someone else does not make them the donor', async () => {
    seedProject();
    const event = finalizeEvent({ kind: 60200, created_at: now(), content: '', tags: [['project', PROJECT], ['p', owner.pk, 'supporter'], ['amount_fiat', '1']] }, donor.sk);
    assert.equal((await send('POST', '/donations/record', { event })).status, 200);
    assert.equal(donationsOf()[0].supporter_pubkey, donor.pk);
  });

  it('the same event twice counts once, and the funded flag follows the donations', async () => {
    seedProject();
    const full = donationEvent(donor, { fiat: '99.50' });
    assert.equal((await send('POST', '/donations/record', { event: full })).status, 200);
    assert.equal((await send('POST', '/donations/record', { event: full })).status, 200);
    assert.equal(donationsOf().length, 1);
    assert.equal(row().is_funded, 1);
  });

  it('refuses a mentor fee, a negative or endless amount, and a donation to no project', async () => {
    seedProject();
    for (const opts of [{ type: 'mentor_fee' }, { fiat: '-5' }, { fiat: 'Infinity' }, { project: '' }]) {
      assert.equal((await send('POST', '/donations/record', { event: donationEvent(donor, opts) })).status, 400, JSON.stringify(opts));
    }
    assert.equal(donationsOf().length, 0);
  });
});

describe('the relay indexer reads the same events', () => {
  it('writes the row the route wrote', async () => {
    const event = projectEvent(owner);
    assert.equal((await send('POST', '/projects/upsert', { event })).status, 200);
    const written = row();
    relayEvents.push(event);
    await indexLanacrowdFromRelays(getDb());
    assert.deepEqual({ ...row(), updated_at: 0 }, { ...written, updated_at: 0 });
  });

  it('takes the owner\'s newer version, and leaves the project with its author when another key uses the same d-tag', async () => {
    seedProject(PROJECT, { is_approved: 1, is_funded: 0, is_completed: 1 });
    relayEvents.push(projectEvent(stranger, { wallet: 'Lstranger', title: 'Another author' }));
    await indexLanacrowdFromRelays(getDb());
    let p = row();
    assert.equal(p.pubkey, owner.pk);
    assert.equal(p.owner_pubkey, owner.pk);
    assert.equal(p.wallet, WALLET);
    assert.equal(p.title, 'Seeded');

    relayEvents.push(projectEvent(owner, { title: 'Edited on a relay' }));
    await indexLanacrowdFromRelays(getDb());
    p = row();
    assert.equal(p.title, 'Edited on a relay');
    assert.equal(p.wallet, WALLET);
    assert.equal(p.pubkey, owner.pk);
    assert.deepEqual([p.is_approved, p.is_completed], [1, 1]);
  });
});
