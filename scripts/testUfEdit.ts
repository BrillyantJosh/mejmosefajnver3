/**
 * Integration tests for refining a request while it matures.
 *
 * Rule under test: an edit published DURING maturing restarts the review period
 * (a new opening date is saved), but the date may only ever move LATER — an edit
 * can never make funding open sooner than already announced, and once funding is
 * open an edit must not drag the request back into maturing.
 *
 * Run with the server on :3210 (PORT=3210 node --import tsx server/index.ts):
 *   npx tsx scripts/testUfEdit.ts
 */
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import Database from 'better-sqlite3';

const BASE = 'http://localhost:3210/api/unconditional-financing';
const DB_PATH = new URL('../data/mejmosefajn.db', import.meta.url).pathname;
const DAY = 86400;

let failures = 0;
/** Time-derived expectations: the server stamps its own clock a moment later. */
function near(got: unknown, want: number, tolerance = 10) {
  return typeof got === 'number' && Math.abs(got - want) <= tolerance;
}

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 220) : ''); }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const now = Math.floor(Date.now() / 1000);
const sk = generateSecretKey();
const pk = getPublicKey(sk);
const skOther = generateSecretKey();

const MATURING_ID = 'uf:test-edit-maturing';   // 6 days left
const ALMOST_ID = 'uf:test-edit-almost';       // 1 hour left
const OPEN_ID = 'uf:test-edit-open';           // funding already open

function editEvent(secret: Uint8Array, dTag: string, title: string, publishedAt: number, claimedOpens: number) {
  return finalizeEvent({
    kind: 31240,
    created_at: now,
    tags: [
      ['d', dTag],
      ['service', 'unconditional-financing'],
      ['title', title],
      ['summary', 'refined'],
      ['request_type', 'personal_hardship'],
      ['fiat_goal', '1000'],
      ['currency', 'EUR'],
      ['wallet', 'LTestWallet'],
      ['published_at', String(publishedAt)],
      ['funding_opens_at', String(claimedOpens)], // client claim — must be ignored
      ['status', 'active'],
    ],
    content: 'refined story',
  }, secret);
}

async function main() {
  const db = new Database(DB_PATH);
  const seed = db.prepare(`
    INSERT OR REPLACE INTO uf_requests (
      id, event_id, pubkey, title, short_desc, content, request_type, fiat_goal,
      currency, wallet, published_at, funding_opens_at, status, is_hidden, is_repaid, nostr_created_at
    ) VALUES (?, ?, ?, 'Seeded', 's', 'c', 'personal_hardship', 1000, 'EUR', 'LTestWallet', ?, ?, 'active', 0, 0, ?)
  `);
  const MATURING_PUB = now - 2 * DAY, MATURING_OPENS = now + 6 * DAY;
  const ALMOST_PUB = now - 8 * DAY, ALMOST_OPENS = now + 3600;
  const OPEN_PUB = now - 20 * DAY, OPEN_OPENS = now - 12 * DAY;
  seed.run(MATURING_ID, 'seed_m_' + now, pk, MATURING_PUB, MATURING_OPENS, MATURING_PUB);
  seed.run(ALMOST_ID, 'seed_a_' + now, pk, ALMOST_PUB, ALMOST_OPENS, ALMOST_PUB);
  seed.run(OPEN_ID, 'seed_o_' + now, pk, OPEN_PUB, OPEN_OPENS, OPEN_PUB);
  db.close();

  const settings = (await call('GET', '/settings')).data;
  const maturingSecs = settings.maturingDays * DAY;
  console.log(`(maturing length in force: ${settings.maturingDays} days)\n`);

  try {
    console.log('— refining while maturing restarts the period —');
    let r = await call('POST', '/requests/upsert', {
      event: editEvent(sk, MATURING_ID, 'Refined title', MATURING_PUB, now + 99 * DAY),
    });
    check('edit accepted → 200', r.status === 200 && r.data.success, r);
    const expected = Math.max(MATURING_OPENS, now + maturingSecs);
    check('a NEW opening date is saved', near(r.data.fundingOpensAt, expected), { got: r.data.fundingOpensAt, want: expected });
    check('the new date is LATER than before', r.data.fundingOpensAt > MATURING_OPENS, { before: MATURING_OPENS, after: r.data.fundingOpensAt });
    check('the client-claimed date was ignored', r.data.fundingOpensAt !== now + 99 * DAY, r.data.fundingOpensAt);

    let det = await call('GET', `/requests/${MATURING_ID}`);
    check('detail shows the new date', near(det.data.request?.fundingOpensAt, expected), { got: det.data.request?.fundingOpensAt, want: expected });
    check('content was actually updated', det.data.request?.title === 'Refined title', det.data.request?.title);
    check('original publication date kept', det.data.request?.publishedAt === MATURING_PUB, det.data.request?.publishedAt);
    check('still in maturing', det.data.request?.phase === 'maturing', det.data.request?.phase);

    console.log('— an edit in the last hour still grants a full review period —');
    r = await call('POST', '/requests/upsert', {
      event: editEvent(sk, ALMOST_ID, 'Late refinement', ALMOST_PUB, now),
    });
    const expectedLate = Math.max(ALMOST_OPENS, now + maturingSecs);
    check('opening date pushed out to a full window', near(r.data.fundingOpensAt, expectedLate), { got: r.data.fundingOpensAt, want: expectedLate });
    check('community is not left with 1 hour to review', r.data.fundingOpensAt > now + maturingSecs - 60, r.data.fundingOpensAt);

    console.log('— an edit can never open funding EARLIER —');
    // Force a very short maturing length, then edit a request whose window is
    // far out: the announced date must survive.
    const far = new Database(DB_PATH);
    far.prepare(`
      INSERT INTO app_settings (id, key, value, updated_at)
      VALUES (lower(hex(randomblob(16))), 'unconditional_financing_maturing_days', '1', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run();
    far.close();
    const before = (await call('GET', `/requests/${MATURING_ID}`)).data.request?.fundingOpensAt;
    r = await call('POST', '/requests/upsert', {
      event: editEvent(sk, MATURING_ID, 'Refined again', MATURING_PUB, now),
    });
    check('shorter setting does not pull the date closer', r.data.fundingOpensAt === before, { got: r.data.fundingOpensAt, want: before });

    console.log('— once funding is open, editing does not reopen maturing —');
    r = await call('POST', '/requests/upsert', {
      event: editEvent(sk, OPEN_ID, 'Edited after opening', OPEN_PUB, now + 30 * DAY),
    });
    check('edit accepted → 200', r.status === 200, r);
    check('opening date unchanged', r.data.fundingOpensAt === OPEN_OPENS, { got: r.data.fundingOpensAt, want: OPEN_OPENS });
    det = await call('GET', `/requests/${OPEN_ID}`);
    check('request stays open for funding', det.data.request?.phase !== 'maturing', det.data.request?.phase);

    console.log('— only the author may refine —');
    r = await call('POST', '/requests/upsert', {
      event: editEvent(skOther, MATURING_ID, 'Hijack', MATURING_PUB, now),
    });
    check('a different signer → 403', r.status === 403, r);
  } finally {
    const clean = new Database(DB_PATH);
    clean.prepare("DELETE FROM uf_requests WHERE id LIKE 'uf:test-edit-%'").run();
    clean.prepare("DELETE FROM app_settings WHERE key = 'unconditional_financing_maturing_days'").run();
    clean.close();
    console.log('cleanup done');
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ ALL EDIT/RESTART TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
