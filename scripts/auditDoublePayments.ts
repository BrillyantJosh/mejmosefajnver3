/**
 * Fleet-wide audit of unconditional payments: who was billed twice for one
 * subscription month, and who actually PAID twice (the refund list).
 *
 *   npx tsx scripts/auditDoublePayments.ts [YYYY-MM]
 *
 * With a month argument it also reports that month's duplicate billing in
 * detail. Reads everything from the relays, because a duplicate proposal is
 * precisely the case the generator failed to record in its own database — the
 * relays are the only authority for what was actually published.
 *
 * An obligation is (payer, service, wallet, subscription month). The month
 * comes from the epoch-ms or YYYY-MM inside the proposal's d-tag.
 */
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import WebSocket from 'ws';
import { readFromRelays } from '../src/lib/relayRead.js';
// Paging a whole kind needs the raw-ws reader: a pooled subscription reused
// across `until` pages under-delivers badly (1 434 of 8 157 confirmations in
// testing), while this one pages the full history reliably.
import { queryEventsWithRelayStatus } from '../server/lib/nostr.js';
import { billingMonthOf } from '../src/lib/unconditionalPaymentGuard.js';

if (typeof (globalThis as any).WebSocket === 'undefined') {
  useWebSocketImplementation(WebSocket as any);
}

const RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com',
  'wss://relay.lovelana.org',
];
const ROOT_ADMIN = '56e8670aa65491f8595dc3a71c94aa7445dcdca755ca5f77c07218498a362061';
const LANOSHI = 100_000_000;

const focusMonth = process.argv[2] || '';
const tagOf = (ev: Event, n: string) => ev.tags.find((t) => t[0] === n)?.[1] || '';
const when = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
const lana = (l: number) => (l / LANOSHI).toFixed(2);

function payerOf(ev: Event): string {
  const p = ev.tags.filter((t) => t[0] === 'p');
  const marked = p.find((t) => t[2] === 'payer');
  if (marked) return marked[1] || '';
  const unmarked = p.filter((t) => !t[2] || (t[2] !== 'payer' && t[2] !== 'recipient'));
  return unmarked[0]?.[1] || '';
}

/** Relays cap each response, so page backwards with `until` until dry. */
async function fetchAll(kind: number) {
  const byId = new Map<string, Event>();
  const answered = new Set<string>();
  let until: number | undefined;
  for (let page = 0; page < 60; page++) {
    const filter: any = { kinds: [kind], limit: 500 };
    if (until) filter.until = until;
    const r = await queryEventsWithRelayStatus(RELAYS, filter, 25000);
    r.answered.forEach((u) => answered.add(u));
    let added = 0;
    let oldest = Infinity;
    for (const e of r.events as Event[]) {
      if (!byId.has(e.id)) { byId.set(e.id, e); added++; }
      if (e.created_at < oldest) oldest = e.created_at;
    }
    process.stdout.write(`  kind ${kind}: page ${page + 1} → ${byId.size} events\r`);
    if (added === 0 || !Number.isFinite(oldest)) break;
    until = oldest - 1;
  }
  console.log(`  kind ${kind}: ${byId.size} events                       `);
  return { events: [...byId.values()], answered: [...answered] };
}

async function main() {
  const props = await fetchAll(90900);
  const confs = await fetchAll(90901);
  try { pool.close(RELAYS); } catch { /* already closed */ }

  console.log(`relays answered: 90900 ${props.answered.length}/${RELAYS.length}, 90901 ${confs.answered.length}/${RELAYS.length}`);
  if (props.answered.length === 0 || confs.answered.length === 0) {
    console.error('⚠ UNVERIFIED READ — nothing below can be trusted.');
    process.exit(2);
  }
  console.log(`read ${props.events.length} proposals, ${confs.events.length} confirmations\n`);

  // ── index proposals by obligation ──
  interface Obligation { payer: string; service: string; wallet: string; month: string; proposals: Event[] }
  const obligations = new Map<string, Obligation>();
  const obligationOfDTag = new Map<string, string>();
  const obligationOfEventId = new Map<string, string>();

  for (const ev of props.events) {
    const payer = payerOf(ev);
    if (!payer) continue;
    const month = billingMonthOf(ev.created_at);
    const key = `${payer}|${tagOf(ev, 'service')}|${tagOf(ev, 'wallet')}|${month}`;
    if (!obligations.has(key)) {
      obligations.set(key, { payer, service: tagOf(ev, 'service'), wallet: tagOf(ev, 'wallet'), month, proposals: [] });
    }
    obligations.get(key)!.proposals.push(ev);
    const d = tagOf(ev, 'd');
    if (d) obligationOfDTag.set(d, key);
    obligationOfEventId.set(ev.id, key);
  }

  // ── A) duplicate billing: one obligation, more than one proposal ──
  const duplicateBilling = [...obligations.values()].filter((o) => {
    const ids = new Set(o.proposals.map((p) => tagOf(p, 'd') || p.id));
    return ids.size > 1;
  });

  const byMonth = new Map<string, Obligation[]>();
  for (const o of duplicateBilling) {
    if (!byMonth.has(o.month)) byMonth.set(o.month, []);
    byMonth.get(o.month)!.push(o);
  }

  console.log('══ A) DUPLICATE BILLING (one obligation, two or more proposals) ══');
  console.log(`   ${duplicateBilling.length} obligations, ${new Set(duplicateBilling.map((o) => o.payer)).size} subscribers affected\n`);
  for (const month of [...byMonth.keys()].sort().reverse()) {
    const list = byMonth.get(month)!;
    console.log(`   ${month}: ${list.length} obligations, ${new Set(list.map((o) => o.payer)).size} subscribers`);
  }

  if (focusMonth) {
    const list = byMonth.get(focusMonth) || [];
    console.log(`\n   — ${focusMonth} in detail —`);
    const monthObligations = [...obligations.values()].filter((o) => o.month === focusMonth);
    console.log(`   billed that month: ${monthObligations.length} obligations, ${new Set(monthObligations.map((o) => o.payer)).size} subscribers`);
    if (list.length === 0) {
      console.log('   ✓ no subscriber was billed twice for any service that month');
    } else {
      for (const o of list) {
        console.log(`   ⚑ ${o.payer.slice(0, 16)}… "${o.service}"`);
        for (const p of o.proposals) console.log(`       ${when(p.created_at)}  d=${tagOf(p, 'd')}`);
      }
    }
  }

  // ── B) double payment: one obligation settled by more than one transaction ──
  interface Settlement { tx: string; at: number; lanoshi: number; dTag: string; confId: string }
  const settlements = new Map<string, Settlement[]>();
  for (const c of confs.events) {
    const dRef = tagOf(c, 'proposal');
    const eRef = c.tags.find((t) => t[0] === 'e' && t[3] === 'proposal')?.[1] || '';
    const key = (dRef && obligationOfDTag.get(dRef)) || (eRef && obligationOfEventId.get(eRef));
    if (!key) continue;
    const tx = tagOf(c, 'tx');
    if (!tx) continue;
    const stamped = Number.parseInt(tagOf(c, 'timestamp_paid'), 10);
    const list = settlements.get(key) || [];
    // one confirmation per (obligation, tx) — a republished receipt is not a second payment
    if (list.some((s) => s.tx === tx)) continue;
    list.push({
      tx,
      at: Number.isFinite(stamped) && stamped > 0 ? stamped : c.created_at,
      lanoshi: Number.parseInt(tagOf(c, 'amount_lanoshi'), 10) || 0,
      dTag: dRef || eRef,
      confId: c.id,
    });
    settlements.set(key, list);
  }

  const doublePaid = [...settlements.entries()]
    .filter(([, s]) => s.length > 1)
    .map(([key, s]) => ({ obligation: obligations.get(key)!, payments: [...s].sort((a, b) => a.at - b.at) }));

  // Per payer: everything after the first payment of an obligation is overpaid.
  interface Overpay { service: string; month: string; wallet: string; paidFirst: Settlement; extra: Settlement[] }
  const byPayer = new Map<string, Overpay[]>();
  for (const d of doublePaid) {
    const list = byPayer.get(d.obligation.payer) || [];
    list.push({
      service: d.obligation.service,
      month: d.obligation.month,
      wallet: d.obligation.wallet,
      paidFirst: d.payments[0],
      extra: d.payments.slice(1),
    });
    byPayer.set(d.obligation.payer, list);
  }

  // names from KIND 0
  const names = new Map<string, string>();
  if (byPayer.size > 0) {
    const pool2 = new SimplePool();
    const meta = await readFromRelays(pool2, RELAYS, { kinds: [0], authors: [...byPayer.keys()] }, { budgetMs: 15000 });
    try { pool2.close(RELAYS); } catch { /* already closed */ }
    for (const ev of meta.events) {
      try {
        const p = JSON.parse(ev.content);
        names.set(ev.pubkey, p.display_name || p.name || '');
      } catch { /* unparseable profile */ }
    }
  }

  // A repeat that charges the SAME amount is an accidental duplicate. One that
  // charges a materially different amount is something else — typically a
  // token first payment topped up later — and must be judged by a human, not
  // refunded on the strength of this script.
  const sameAmount = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.01;
  const classify = (o: Overpay) =>
    o.extra.every((e) => sameAmount(e.lanoshi, o.paidFirst.lanoshi)) ? 'CONFIRMED' : 'REVIEW';

  console.log('\n══ B) DOUBLE PAYMENTS (one obligation settled by more than one transaction) ══');
  console.log(`   ${doublePaid.length} obligations, ${byPayer.size} payers\n`);

  const render = (title: string, note: string, want: 'CONFIRMED' | 'REVIEW', includeRoot: boolean) => {
    const rows = [...byPayer.entries()]
      .filter(([payer]) => (payer === ROOT_ADMIN) === includeRoot)
      .map(([payer, items]) => [payer, items.filter((o) => classify(o) === want)] as const)
      .filter(([, items]) => items.length > 0);
    const total = rows.reduce((t, [, items]) =>
      t + items.reduce((x, o) => x + o.extra.reduce((y, e) => y + e.lanoshi, 0), 0), 0);

    console.log(`── ${title} ──`);
    console.log(`   ${note}`);
    if (rows.length === 0) { console.log('   (none)\n'); return 0; }
    for (const [payer, items] of rows.sort((a, b) => {
      const s = (l: Overpay[]) => l.reduce((t, o) => t + o.extra.reduce((x, e) => x + e.lanoshi, 0), 0);
      return s(b[1]) - s(a[1]);
    })) {
      const sum = items.reduce((t, o) => t + o.extra.reduce((x, e) => x + e.lanoshi, 0), 0);
      console.log(`\n   ${names.get(payer) || '(no profile name)'} — ${payer}`);
      console.log(`   overpaid ${lana(sum)} LANA across ${items.length} obligation(s)`);
      for (const o of items) {
        console.log(`   • ${o.month}  "${o.service}" → ${o.wallet}`);
        console.log(`       kept:   ${when(o.paidFirst.at)}  ${lana(o.paidFirst.lanoshi).padStart(9)} LANA  tx ${o.paidFirst.tx}`);
        for (const e of o.extra) {
          console.log(`       EXTRA:  ${when(e.at)}  ${lana(e.lanoshi).padStart(9)} LANA  tx ${e.tx}`);
        }
      }
    }
    console.log(`\n   subtotal: ${lana(total)} LANA\n`);
    return total;
  };

  const confirmed = render(
    'REFUND — accidental duplicates',
    'Repeat charges the same amount for the same obligation. Unambiguous.',
    'CONFIRMED', false);

  const review = render(
    'REVIEW — repeat payment, different amount',
    'A token first payment topped up later looks like this. Judge before refunding.',
    'REVIEW', false);

  const rootConfirmed = render('ROOT ADMIN — same amount', 'Own account; verify it was not testing.', 'CONFIRMED', true);
  const rootReview = render('ROOT ADMIN — different amounts', 'Own account; amounts differ, almost certainly testing.', 'REVIEW', true);

  console.log('═'.repeat(70));
  console.log(`REFUND NOW (subscribers, unambiguous):        ${lana(confirmed).padStart(10)} LANA`);
  console.log(`NEEDS A HUMAN DECISION (subscribers):         ${lana(review).padStart(10)} LANA`);
  console.log(`ROOT ADMIN, own account:                     ${lana(rootConfirmed + rootReview).padStart(10)} LANA`);
  console.log('\nAmounts are the net figures on the KIND 90901 receipts. The payer also spent');
  console.log('a 10% service fee on top of each, so the actual outlay was about 11% higher.');
  process.exit(0);
}

main().catch((err) => {
  console.error('audit crashed:', err);
  process.exit(2);
});
