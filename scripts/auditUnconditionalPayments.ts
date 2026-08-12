/**
 * Audit a payer's unconditional-payment history straight off the relays.
 *
 * Prints, for the given pubkey:
 *   1. which relays actually answered (via readFromRelays — a failed read is
 *      NOT an empty one),
 *   2. every KIND 90900 proposal naming the pubkey as payer,
 *   3. every KIND 90901 confirmation authored by the pubkey, grouped by tx,
 *   4. duplicate-obligation flags — proposals sharing (to_wallet,
 *      amount_lanoshi, billing_day), and proposal groups sharing the
 *      server's obligation key (payer|service|wallet) under different d-tags.
 *
 * Usage:
 *   npx tsx scripts/auditUnconditionalPayments.ts <pubkey-hex> [wss://relay1,wss://relay2]
 *
 * Exit codes: 0 clean · 1 duplicate obligations flagged · 2 read unverified.
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import WebSocket from 'ws';
import { readFromRelays } from '../src/lib/relayRead.js';

if (typeof (globalThis as any).WebSocket === 'undefined') {
  useWebSocketImplementation(WebSocket as any);
}

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com',
];

const pubkey = (process.argv[2] || '').trim().toLowerCase();
if (!/^[0-9a-f]{64}$/.test(pubkey)) {
  console.error('Usage: npx tsx scripts/auditUnconditionalPayments.ts <pubkey-hex> [wss://relay1,wss://relay2]');
  process.exit(2);
}
const relays = process.argv[3] ? process.argv[3].split(',').map((r) => r.trim()).filter(Boolean) : DEFAULT_RELAYS;

const tagOf = (ev: Event, name: string) => ev.tags.find((t) => t[0] === name)?.[1] || '';

// Same payer extraction as /fetch-donation-proposals: marked p-tag first,
// first unmarked p-tag as fallback.
function payerOf(ev: Event): string {
  const pTags = ev.tags.filter((t) => t[0] === 'p');
  const marked = pTags.find((t) => t[2] === 'payer');
  if (marked) return marked[1] || '';
  const unmarked = pTags.filter((t) => !t[2] || (t[2] !== 'payer' && t[2] !== 'recipient'));
  return unmarked[0]?.[1] || '';
}

const short = (s: string, n = 20) => (s.length > n ? `${s.slice(0, n)}…` : s);
const when = (ts: number) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);

async function main() {
  const pool = new SimplePool();

  console.log(`Auditing payer ${pubkey}`);
  console.log(`Relays: ${relays.join(', ')}\n`);

  const [proposalRead, confirmRead] = await Promise.all([
    readFromRelays(pool, relays, { kinds: [90900], '#p': [pubkey], limit: 1000 }, { budgetMs: 12000 }),
    readFromRelays(pool, relays, { kinds: [90901], authors: [pubkey], limit: 500 }, { budgetMs: 12000 }),
  ]);
  try { pool.close(relays); } catch { /* already closed */ }

  console.log('— relay status —');
  for (const url of proposalRead.answered) console.log(`  ✓ answered (90900): ${url}`);
  for (const f of proposalRead.failed) console.log(`  ✗ failed   (90900): ${f.url} — ${f.reason}`);
  for (const url of confirmRead.answered) console.log(`  ✓ answered (90901): ${url}`);
  for (const f of confirmRead.failed) console.log(`  ✗ failed   (90901): ${f.url} — ${f.reason}`);

  if (proposalRead.answered.length === 0 || confirmRead.answered.length === 0) {
    console.error('\n⚠ UNVERIFIED READ — no relay answered at least one query. Nothing below can be trusted.');
    process.exit(2);
  }

  // — confirmations grouped by tx —
  const confirmations = [...confirmRead.events].sort((a, b) => b.created_at - a.created_at);
  const byTx = new Map<string, Event[]>();
  for (const ev of confirmations) {
    const tx = tagOf(ev, 'tx') || '(no tx tag)';
    if (!byTx.has(tx)) byTx.set(tx, []);
    byTx.get(tx)!.push(ev);
  }
  console.log(`\n— ${confirmations.length} KIND 90901 confirmations in ${byTx.size} transactions —`);
  for (const [tx, evs] of byTx) {
    console.log(`  tx ${tx} (${evs.length} confirmations, ${when(evs[0].created_at)})`);
    for (const ev of evs) {
      const bd = tagOf(ev, 'billing_day');
      console.log(`    → ${tagOf(ev, 'to_wallet')}  ${tagOf(ev, 'amount_lanoshi')} lanoshi  d=${short(tagOf(ev, 'proposal'), 34)}${bd ? `  billing_day=${bd}` : ''}`);
    }
  }

  // — proposals where this pubkey is the payer —
  const paidDTags = new Set(confirmations.map((ev) => tagOf(ev, 'proposal')).filter(Boolean));
  const paidEventIds = new Set(
    confirmations.map((ev) => ev.tags.find((t) => t[0] === 'e' && t[3] === 'proposal')?.[1] || '').filter(Boolean),
  );
  const proposals = proposalRead.events
    .filter((ev) => payerOf(ev) === pubkey)
    .sort((a, b) => b.created_at - a.created_at);
  console.log(`\n— ${proposals.length} KIND 90900 proposals naming this pubkey as payer —`);
  for (const ev of proposals) {
    const d = tagOf(ev, 'd');
    const paid = paidDTags.has(d) || paidEventIds.has(ev.id);
    const fiat = ev.tags.find((t) => t[0] === 'fiat');
    console.log(
      `  ${paid ? 'PAID  ' : 'UNPAID'}  ${when(ev.created_at)}  d=${short(d, 34)}  service=${short(tagOf(ev, 'service'), 24)}  wallet=${tagOf(ev, 'wallet')}  lanoshi=${tagOf(ev, 'lanoshi') || '?'}  fiat=${fiat ? `${fiat[2]} ${fiat[1]}` : '?'}  billing_day=${tagOf(ev, 'billing_day') || '—'}`,
    );
  }

  // — duplicate-obligation flags —
  let flagged = 0;
  const groupAndFlag = (label: string, keyOf: (ev: Event) => string | null) => {
    const groups = new Map<string, Event[]>();
    for (const ev of proposals) {
      const key = keyOf(ev);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    }
    for (const [key, evs] of groups) {
      // A d-less proposal has no identity of its own — count each such event
      // separately, else a group of d-less duplicates reads as one proposal.
      // (Same-d events still collapse: the fleet dedups 90900 by d at the app
      // layer, since kind 90900 is outside the NIP-33 replaceable range.)
      const dTags = new Set(evs.map((ev) => tagOf(ev, 'd') || ev.id));
      if (dTags.size < 2) continue;
      flagged++;
      console.log(`  ⚑ ${label}: ${key} — ${dTags.size} distinct proposal sets`);
      for (const ev of evs) {
        const d = tagOf(ev, 'd');
        const paid = paidDTags.has(d) || paidEventIds.has(ev.id);
        console.log(`      ${paid ? 'PAID  ' : 'UNPAID'}  ${when(ev.created_at)}  d=${d}`);
      }
    }
  };

  console.log('\n— duplicate obligations —');
  groupAndFlag('same (to_wallet, amount_lanoshi, billing_day)', (ev) => {
    const wallet = tagOf(ev, 'wallet');
    const lanoshi = tagOf(ev, 'lanoshi');
    const billing = tagOf(ev, 'billing_day');
    return wallet && lanoshi ? `${wallet}|${lanoshi}|${billing || '(none)'}` : null;
  });
  groupAndFlag('same obligation key (service, wallet)', (ev) => {
    const wallet = tagOf(ev, 'wallet');
    const service = tagOf(ev, 'service');
    return wallet && service ? `${service}|${wallet}` : null;
  });
  if (flagged === 0) console.log('  (none)');

  process.exit(flagged > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('audit crashed:', err);
  process.exit(2);
});
