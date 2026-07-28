/**
 * The freeze guard must work from the sender ADDRESS alone — no caller should be
 * able to skip it by omitting userPubkey, which is how a frozen wallet could
 * still sell on Lana.discount.
 *
 *   npx tsx scripts/testWalletFreeze.ts
 *
 * Reads live wallet lists (KIND 30889) from the configured relays.
 */
import { getWalletFreezeStatus } from '../server/lib/walletFreeze.js';
import { queryEventsFromRelays } from '../server/lib/nostr.js';
import Database from 'better-sqlite3';

const DB_PATH = new URL('../data/mejmosefajn.db', import.meta.url).pathname;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 200) : ''); }
}

function relays(): string[] {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  db.close();
  return row?.relays ? JSON.parse(row.relays) : [];
}

/** Find a genuinely frozen wallet and a genuinely active one on the network. */
async function findSamples() {
  const events = await queryEventsFromRelays(relays(), { kinds: [30889], limit: 400 } as any);
  let frozen: string | null = null;
  let active: string | null = null;

  for (const e of events) {
    const accountFrozen = e.tags.find((t: string[]) => t[0] === 'status')?.[1] === 'frozen';
    for (const t of e.tags.filter((t: string[]) => t[0] === 'w')) {
      if (t.length < 6 || !t[1]) continue;
      const perWallet = t.length >= 7 ? t[6] || '' : '';
      if (!frozen && (accountFrozen || perWallet)) frozen = t[1];
      if (!active && !accountFrozen && !perWallet) active = t[1];
    }
    if (frozen && active) break;
  }
  return { frozen, active };
}

async function main() {
  console.log('— locating real wallets on the network —');
  const { frozen, active } = await findSamples();
  console.log(`  frozen sample: ${frozen ?? '(none found)'}`);
  console.log(`  active sample: ${active ?? '(none found)'}`);

  console.log('\n— the guard resolves status from the address alone —');
  if (frozen) {
    const v = await getWalletFreezeStatus(frozen);
    check('a frozen wallet is reported frozen', v.frozen === true && v.known === true, v);
  } else {
    console.log('  … no frozen wallet on the network right now — skipping that case');
  }

  if (active) {
    const v = await getWalletFreezeStatus(active);
    check('an active wallet is NOT reported frozen', v.frozen === false, v);
    check('and its status is known (not a guess)', v.known === true, v);
  }

  console.log('\n— unknown input never blocks a payment —');
  const bogus = await getWalletFreezeStatus('LThisAddressDoesNotExistAnywhere123');
  check('unregistered address → not frozen, not known', bogus.frozen === false && bogus.known === false, bogus);
  const empty = await getWalletFreezeStatus('');
  check('empty address → not frozen', empty.frozen === false, empty);

  if (failures > 0) {
    console.error(`\n❌ ${failures} FAILED`);
    process.exit(1);
  }
  console.log('\n✅ FREEZE GUARD TESTS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
