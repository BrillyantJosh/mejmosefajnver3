/**
 * Integration tests for the HARDENED Unconditional Financing API.
 * The server must verify signed events and enforce: author identity on edits,
 * eligibility on new requests, the maturing window, no self-contribution,
 * owner-only repayments, and output-breakdown consistency.
 *
 * Run with the server on :3210 (PORT=3210 node --import tsx server/index.ts):
 *   npx tsx scripts/testUfApi.ts
 */
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import Database from 'better-sqlite3';

const BASE = 'http://localhost:3210/api/unconditional-financing';
const DB_PATH = new URL('../data/mejmosefajn.db', import.meta.url).pathname;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 200) : ''); }
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const now = Math.floor(Date.now() / 1000);
const skOwner = generateSecretKey();
const pkOwner = getPublicKey(skOwner);
const skSup = generateSecretKey();
const pkSup = getPublicKey(skSup);
const skAttacker = generateSecretKey();
const pkAttacker = getPublicKey(skAttacker);

const OPEN_ID = 'uf:test-hardened-open';
const MAT_ID = 'uf:test-hardened-maturing';

function requestEvent(sk: Uint8Array, dTag: string, opensAt: number, extra: string[][] = []) {
  return finalizeEvent({
    kind: 31240,
    created_at: now,
    tags: [
      ['d', dTag],
      ['service', 'unconditional-financing'],
      ['title', 'Hardened test request'],
      ['summary', 's'],
      ['request_type', 'personal_hardship'],
      ['fiat_goal', '1000'],
      ['currency', 'EUR'],
      ['wallet', 'LTestOwnerWallet'],
      ['published_at', String(opensAt - 8 * 86400)],
      ['funding_opens_at', String(opensAt)],
      ['status', 'active'],
      ['client', 'mejmosefajn'],
      ...extra,
    ],
    content: 'story',
  }, sk);
}

function contributionEvent(sk: Uint8Array, requestId: string, ownerPk: string, fiat: number, lanoshis: number, ts = now) {
  return finalizeEvent({
    kind: 60210,
    created_at: ts,
    tags: [
      ['service', 'unconditional-financing'],
      ['request', requestId],
      ['a', `31240:${ownerPk}:${requestId}`],
      ['p', getPublicKey(sk), '', 'financier'],
      ['p', ownerPk, '', 'requester'],
      ['amount_lanoshis', String(lanoshis)],
      ['amount_fiat', String(fiat)],
      ['currency', 'EUR'],
      ['rate', '0.128'],
      ['from_wallet', 'LSup'],
      ['repayment_wallet', 'LSupMain'],
      ['to_wallet', 'LTestOwnerWallet'],
      ['tx', 'a'.repeat(64)],
      ['timestamp_paid', String(ts)],
      ['client', 'mejmosefajn'],
    ],
    content: '',
  }, sk);
}

function repaymentEvent(sk: Uint8Array, requestId: string, ownerPk: string, totalFiat: number, totalLanoshis: number, outs: [string, string, number, number][]) {
  return finalizeEvent({
    kind: 60211,
    created_at: now,
    tags: [
      ['service', 'unconditional-financing'],
      ['request', requestId],
      ['a', `31240:${ownerPk}:${requestId}`],
      ['p', getPublicKey(sk), '', 'payer'],
      ['amount_lanoshis_total', String(totalLanoshis)],
      ['amount_fiat_total', String(totalFiat)],
      ['currency', 'EUR'],
      ['rate', '0.128'],
      ['tx', 'b'.repeat(64)],
      ...outs.map(([pk, w, lan, fiat]) => ['out', pk, w, String(lan), String(fiat)]),
      ['client', 'mejmosefajn'],
    ],
    content: '',
  }, sk);
}

async function main() {
  // Seed request rows directly (simulating already-indexed requests) so the
  // funding tests are independent of the eligibility gate.
  const db = new Database(DB_PATH);
  const seed = db.prepare(`
    INSERT OR REPLACE INTO uf_requests (
      id, event_id, pubkey, title, short_desc, content, request_type, fiat_goal,
      currency, wallet, published_at, funding_opens_at, status, is_hidden, is_repaid, nostr_created_at
    ) VALUES (?, ?, ?, 'Seeded', 's', 'c', 'personal_hardship', 1000, 'EUR', 'LTestOwnerWallet', ?, ?, 'active', 0, 0, ?)
  `);
  seed.run(OPEN_ID, 'seed_open_' + now, pkOwner, now - 10 * 86400, now - 2 * 86400, now - 10 * 86400);
  seed.run(MAT_ID, 'seed_mat_' + now, pkOwner, now, now + 8 * 86400, now);
  db.close();

  console.log('— signed-event validation —');
  {
    const evt = requestEvent(skOwner, OPEN_ID, now - 2 * 86400);
    const tampered = { ...evt, content: 'tampered' };
    let r = await call('POST', '/requests/upsert', { event: tampered });
    check('tampered signature → 400', r.status === 400, r);
    r = await call('POST', '/requests/upsert', {});
    check('missing event → 400', r.status === 400, r.status);
    const noService = finalizeEvent({ kind: 31240, created_at: now, tags: [['d', OPEN_ID], ['title', 'x']], content: '' }, skOwner);
    r = await call('POST', '/requests/upsert', { event: noService });
    check('missing service tag → 400', r.status === 400, r);
  }

  console.log('— request upsert guards —');
  {
    // NEW request by a throwaway key → eligibility 403 (no Lana8Wonder plan)
    const fresh = requestEvent(skAttacker, 'uf:test-hardened-fresh', now + 8 * 86400);
    let r = await call('POST', '/requests/upsert', { event: fresh });
    check('new request without Lana8Wonder → 403 eligibility', r.status === 403, r);

    // EDIT of the seeded row by its owner → 200; window must be PRESERVED even
    // though the edit event claims a different funding_opens_at.
    const edit = requestEvent(skOwner, OPEN_ID, now + 999999); // tries to move window
    r = await call('POST', '/requests/upsert', { event: edit });
    check('edit by owner → 200', r.status === 200 && r.data.success, r);
    const det = await call('GET', `/requests/${OPEN_ID}`);
    check('maturing window NOT moved by edit', det.data.request?.fundingOpensAt === now - 2 * 86400, det.data.request?.fundingOpensAt);

    // EDIT signed by a DIFFERENT author → 403 identity guard
    const hijack = requestEvent(skAttacker, OPEN_ID, now - 2 * 86400);
    r = await call('POST', '/requests/upsert', { event: hijack });
    check('edit by different author → 403', r.status === 403, r);
  }

  console.log('— contribution guards —');
  {
    // Maturing request → 409
    let r = await call('POST', '/contributions/record', { event: contributionEvent(skSup, MAT_ID, pkOwner, 10, 1000) });
    check('contribution while maturing → 409', r.status === 409, r);

    // Self-contribution (signed by the OWNER) → 403
    r = await call('POST', '/contributions/record', { event: contributionEvent(skOwner, OPEN_ID, pkOwner, 10, 1000) });
    check('self-contribution → 403', r.status === 403, r);

    // Valid contribution by supporter → 200; identity = SIGNER
    r = await call('POST', '/contributions/record', { event: contributionEvent(skSup, OPEN_ID, pkOwner, 400, 312500000000) });
    check('valid contribution → 200', r.status === 200 && r.data.success, r);

    // Forged p-financier tag pointing at a victim, signed by attacker →
    // recorded under the ATTACKER (signer), never the victim.
    const forged = finalizeEvent({
      kind: 60210,
      created_at: now,
      tags: [
        ['service', 'unconditional-financing'],
        ['request', OPEN_ID],
        ['a', `31240:${pkOwner}:${OPEN_ID}`],
        ['p', pkSup, '', 'financier'], // claims the victim!
        ['p', pkOwner, '', 'requester'],
        ['amount_lanoshis', '1000'],
        ['amount_fiat', '100'],
        ['currency', 'EUR'],
        ['rate', '0.128'],
        ['from_wallet', 'LAtk'],
        ['repayment_wallet', 'LAtkMain'],
        ['to_wallet', 'LTestOwnerWallet'],
        ['tx', 'c'.repeat(64)],
        ['timestamp_paid', String(now)],
      ],
      content: '',
    }, skAttacker);
    r = await call('POST', '/contributions/record', { event: forged });
    check('forged p-tag accepted but attributed to SIGNER', r.status === 200, r);
    const det = await call('GET', `/requests/${OPEN_ID}`);
    const fins = Object.fromEntries((det.data.financiers || []).map((f: any) => [f.pubkey, f]));
    check('victim NOT credited with forged amount', (fins[pkSup]?.amountFiat ?? 0) === 400, fins[pkSup]);
    check('attacker credited under own pubkey', (fins[pkAttacker]?.amountFiat ?? 0) === 100, fins[pkAttacker]);
  }

  console.log('— repayment guards —');
  {
    // Non-owner repayment → 403
    let r = await call('POST', '/repayments/record', {
      event: repaymentEvent(skAttacker, OPEN_ID, pkOwner, 500, 390625000000, [[pkSup, 'LSupMain', 390625000000, 500]]),
    });
    check('repayment by non-owner → 403', r.status === 403, r);

    // Owner but inflated total vs breakdown → 400
    r = await call('POST', '/repayments/record', {
      event: repaymentEvent(skOwner, OPEN_ID, pkOwner, 99999, 390625000000, [[pkSup, 'LSupMain', 390625000000, 500]]),
    });
    check('inflated total vs outputs → 400', r.status === 400, r);

    // Owner, lanoshi mismatch → 400
    r = await call('POST', '/repayments/record', {
      event: repaymentEvent(skOwner, OPEN_ID, pkOwner, 500, 999, [[pkSup, 'LSupMain', 390625000000, 500]]),
    });
    check('lanoshi mismatch → 400', r.status === 400, r);

    // Valid full repayment (funded=500 total: 400 sup + 100 attacker) → repaid
    r = await call('POST', '/repayments/record', {
      event: repaymentEvent(skOwner, OPEN_ID, pkOwner, 500, 390625000000, [
        [pkSup, 'LSupMain', 312500000000, 400],
        [pkAttacker, 'LAtkMain', 78125000000, 100],
      ]),
    });
    check('valid repayment → 200 + isRepaid', r.status === 200 && r.data.isRepaid === true, r);
  }

  console.log('— read models —');
  {
    const r = await call('GET', `/my-supports/${pkSup}`);
    const sup = (r.data.supports || [])[0];
    check('my-supports lists the request', sup?.request?.id === OPEN_ID, sup?.request?.id);
    check('my share 80%', Math.abs((sup?.sharePercent ?? 0) - 80) < 0.01, sup?.sharePercent);
    check('repaid to me 400', sup?.repaidToMe === 400, sup?.repaidToMe);
    const tabs = await call('GET', '/requests?tab=repaid');
    check('repaid tab contains request', (tabs.data.requests || []).some((x: any) => x.id === OPEN_ID));
  }

  // Cleanup
  const db2 = new Database(DB_PATH);
  db2.prepare("DELETE FROM uf_requests WHERE id LIKE 'uf:test-hardened-%'").run();
  db2.prepare("DELETE FROM uf_contributions WHERE request_id LIKE 'uf:test-hardened-%'").run();
  db2.prepare("DELETE FROM uf_repayments WHERE request_id LIKE 'uf:test-hardened-%'").run();
  db2.close();
  console.log('cleanup done');

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ ALL HARDENED API TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
