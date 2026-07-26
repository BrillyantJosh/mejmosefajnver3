/**
 * Integration tests for the admin-configurable Unconditional Financing rules:
 * the maturing length and the per-group amount caps.
 *
 * Verifies that what the admin saves is what the SERVER enforces — the cap is
 * applied to new requests AND to edits, the maturing window is derived from the
 * configured length, and a window that already exists is never moved by a later
 * settings change.
 *
 * Run with the server on :3210 (PORT=3210 node --import tsx server/index.ts):
 *   npx tsx scripts/testUfSettings.ts
 */
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import Database from 'better-sqlite3';

const BASE = 'http://localhost:3210/api/unconditional-financing';
const FN = 'http://localhost:3210/api/functions/update-app-settings';
const DB_PATH = new URL('../data/mejmosefajn.db', import.meta.url).pathname;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 200) : ''); }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function setSettings(days: unknown, maxAmounts: unknown) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      settings: [
        { key: 'unconditional_financing_maturing_days', value: days },
        { key: 'unconditional_financing_max_amounts', value: maxAmounts },
      ],
    }),
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

const now = Math.floor(Date.now() / 1000);
const skOwner = generateSecretKey();
const pkOwner = getPublicKey(skOwner);
const SEED_ID = 'uf:test-settings-seeded';

function requestEvent(sk: Uint8Array, dTag: string, type: string, goal: number) {
  return finalizeEvent({
    kind: 31240,
    created_at: now,
    tags: [
      ['d', dTag],
      ['service', 'unconditional-financing'],
      ['title', 'Settings test'],
      ['summary', 's'],
      ['request_type', type],
      ['fiat_goal', String(goal)],
      ['currency', 'EUR'],
      ['wallet', 'LTestWallet'],
      ['published_at', String(now)],
      ['funding_opens_at', String(now + 99 * 86400)], // client lie — must be ignored
      ['status', 'active'],
    ],
    content: 'story',
  }, sk);
}

async function main() {
  // Remember the operator's real values so the test never leaves them changed.
  const db0 = new Database(DB_PATH, { readonly: true });
  const readKey = (k: string) => (db0.prepare('SELECT value FROM app_settings WHERE key = ?').get(k) as any)?.value;
  const originalDays = readKey('unconditional_financing_maturing_days');
  const originalMax = readKey('unconditional_financing_max_amounts');
  db0.close();

  const SEED_WINDOW = now - 2 * 86400; // seeded row is already open for funding
  const seedDb = new Database(DB_PATH);
  seedDb.prepare(`
    INSERT OR REPLACE INTO uf_requests (
      id, event_id, pubkey, title, short_desc, content, request_type, fiat_goal,
      currency, wallet, published_at, funding_opens_at, status, is_hidden, is_repaid, nostr_created_at
    ) VALUES (?, ?, ?, 'Seeded', 's', 'c', 'personal_hardship', 100, 'EUR', 'LTestWallet', ?, ?, 'active', 0, 0, ?)
  `).run(SEED_ID, 'seed_settings_' + now, pkOwner, now - 10 * 86400, SEED_WINDOW, now - 10 * 86400);
  seedDb.close();

  try {
    console.log('— settings endpoint reflects what is saved —');
    await setSettings(3, { personal_hardship: 500, lifestyle_transition: 0, wellbeing_project: 1200 });
    let r = await call('GET', '/settings');
    check('maturingDays = 3', r.data.maturingDays === 3, r.data);
    check('cap personal_hardship = 500', r.data.maxAmounts?.personal_hardship === 500, r.data.maxAmounts);
    check('cap lifestyle_transition = 0 (uncapped)', r.data.maxAmounts?.lifestyle_transition === 0, r.data.maxAmounts);
    check('cap wellbeing_project = 1200', r.data.maxAmounts?.wellbeing_project === 1200, r.data.maxAmounts);

    console.log('— malformed values fall back safely —');
    await setSettings('not-a-number', { personal_hardship: -5, lifestyle_transition: 'abc', wellbeing_project: 1200 });
    r = await call('GET', '/settings');
    check('garbage days → default 8', r.data.maturingDays === 8, r.data.maturingDays);
    check('negative cap → 0 (uncapped)', r.data.maxAmounts?.personal_hardship === 0, r.data.maxAmounts);
    check('non-numeric cap → 0 (uncapped)', r.data.maxAmounts?.lifestyle_transition === 0, r.data.maxAmounts);

    await setSettings(500, { personal_hardship: 0, lifestyle_transition: 0, wellbeing_project: 0 });
    r = await call('GET', '/settings');
    check('days above 365 clamped to 365', r.data.maturingDays === 365, r.data.maturingDays);

    console.log('— cap is enforced on NEW requests —');
    await setSettings(3, { personal_hardship: 500, lifestyle_transition: 0, wellbeing_project: 1200 });
    // The cap is checked before eligibility, so a throwaway key still proves it.
    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, 'uf:test-settings-overcap', 'personal_hardship', 501),
    });
    check('over cap → 400', r.status === 400, r);
    check('400 names the limit', r.data.maxAmount === 500, r.data);

    // Under the cap the request gets past the cap gate and is stopped by the
    // eligibility gate instead — proving the cap did not fire spuriously.
    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, 'uf:test-settings-undercap', 'personal_hardship', 499),
    });
    check('under cap → passes cap gate (403 eligibility, not 400)', r.status === 403, r);

    // An uncapped group accepts any amount at the cap gate.
    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, 'uf:test-settings-uncapped', 'lifestyle_transition', 999999),
    });
    check('uncapped group → no 400 on amount', r.status !== 400, r);

    console.log('— cap is enforced on EDITS too —');
    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, SEED_ID, 'personal_hardship', 5000),
    });
    check('editing an existing request above the cap → 400', r.status === 400, r);

    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, SEED_ID, 'personal_hardship', 300),
    });
    check('editing within the cap → 200', r.status === 200 && r.data.success, r);

    console.log('— a changed setting never moves an existing window —');
    await setSettings(30, { personal_hardship: 500, lifestyle_transition: 0, wellbeing_project: 1200 });
    r = await call('POST', '/requests/upsert', {
      event: requestEvent(skOwner, SEED_ID, 'personal_hardship', 300),
    });
    check('edit after settings change → 200', r.status === 200, r);
    const det = await call('GET', `/requests/${SEED_ID}`);
    check(
      'window still the original one (not re-derived from the new setting)',
      det.data.request?.fundingOpensAt === SEED_WINDOW,
      { got: det.data.request?.fundingOpensAt, want: SEED_WINDOW }
    );
    check('request is open for funding, not pushed back into maturing', det.data.request?.phase !== 'maturing', det.data.request?.phase);
  } finally {
    // Restore the operator's values and remove test rows.
    const restore = new Database(DB_PATH);
    const upsert = restore.prepare(`
      INSERT INTO app_settings (id, key, value, updated_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    const del = restore.prepare('DELETE FROM app_settings WHERE key = ?');
    if (originalDays === undefined) del.run('unconditional_financing_maturing_days');
    else upsert.run('unconditional_financing_maturing_days', originalDays);
    if (originalMax === undefined) del.run('unconditional_financing_max_amounts');
    else upsert.run('unconditional_financing_max_amounts', originalMax);
    restore.prepare("DELETE FROM uf_requests WHERE id LIKE 'uf:test-settings-%'").run();
    restore.close();
    console.log('cleanup done (original settings restored)');
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ ALL SETTINGS TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
