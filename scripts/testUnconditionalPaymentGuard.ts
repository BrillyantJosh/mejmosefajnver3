/**
 * Pure-logic tests for the shared duplicate matcher.
 *   npx tsx scripts/testUnconditionalPaymentGuard.ts
 *
 * Scenarios come from the 2026-08 double-payment incident (payer 9b1267aa…,
 * txs bbea05f8… / d3714d99…) and from the adversarial review of the guard.
 */
import {
  findDuplicateConfirmations,
  confirmationPaidAt,
  REGENERATION_MARGIN_SECONDS,
  type SelectedObligation,
  type ConfirmationEvent,
} from '../src/lib/unconditionalPaymentGuard.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail).slice(0, 220)}`);
  if (!cond) failures++;
};

const DAY = 24 * 3600;
const T0 = 1786230000; // arbitrary epoch anchor near the incident

const obligation = (over: Partial<SelectedObligation> = {}): SelectedObligation => ({
  proposalId: 'ev-new',
  proposalDTag: 'sub:lana:222:9b1267aa',
  recipientWallet: 'LaqqtQ',
  service: 'Lana Realm',
  proposalCreatedAt: T0,
  ...over,
});

const confirmation = (over: Partial<ConfirmationEvent> & { tag?: Record<string, string> } = {}): ConfirmationEvent => {
  const { tag = {}, ...rest } = over;
  const base: Record<string, string> = {
    proposal: 'sub:lana:111:9b1267aa',
    to_wallet: 'LaqqtQ',
    service: 'Lana Realm',
    tx: 'bbea05f8'.padEnd(64, '0'),
    ...tag,
  };
  return {
    id: 'conf-1',
    created_at: T0 - 9 * 3600, // incident shape: paid 9h before the re-mint
    tags: Object.entries(base).map(([k, v]) => (k === 'e' ? ['e', v, '', 'proposal'] : [k, v])),
    ...rest,
  };
};

console.log('— Rule A: exact reference —');
{
  const m = findDuplicateConfirmations([obligation({ proposalDTag: 'sub:lana:111:9b1267aa' })], [confirmation()]);
  check('same d-tag → duplicate', m.length === 1 && m[0].via === 'proposal reference', m);
}
{
  const m = findDuplicateConfirmations([obligation({ proposalId: 'ev-old' })], [confirmation({ tag: { e: 'ev-old' } })]);
  check('same proposal event id → duplicate', m.length === 1 && m[0].via === 'proposal reference', m);
}

console.log('— Rule B: the incident (regenerated set, paid 9h before the mint) —');
{
  const m = findDuplicateConfirmations([obligation()], [confirmation()]);
  check('re-minted obligation → blocked', m.length === 1 && m[0].via.includes('same service + wallet'), m);
  check('match carries the existing txid', m[0]?.txId.startsWith('bbea05f8'), m[0]?.txId);
}
{
  // >2% rate drift / custom amount: irrelevant — no amount in the rule
  const m = findDuplicateConfirmations([obligation()], [confirmation({ tag: { amount_lanoshi: '1' } })]);
  check('amount drift cannot bypass the block', m.length === 1, m);
}
{
  // payment AFTER the mint (stale-tab payment of an older set of the same cycle)
  const m = findDuplicateConfirmations([obligation()], [confirmation({ created_at: T0 + DAY })]);
  check('payment after the mint → still blocked', m.length === 1, m);
}

console.log('— Rule B must NOT block legitimate bills —');
{
  // next cycle: previous payment 10 days before this mint
  const m = findDuplicateConfirmations([obligation()], [confirmation({ created_at: T0 - 10 * DAY })]);
  check('payment 10 days before the mint → next cycle payable', m.length === 0, m);
}
{
  // review F1: same day-of-month a month later — no billing_day in the rule at all
  const m = findDuplicateConfirmations([obligation()], [confirmation({ created_at: T0 - 28 * DAY, tag: { billing_day: '1' } })]);
  check('month-old payment (same billing_day) → payable', m.length === 0, m);
}
{
  // several services share one wallet with equal amounts (seen on-chain)
  const m = findDuplicateConfirmations([obligation({ service: 'lanawatch.us' })], [confirmation()]);
  check('different service, same wallet → payable', m.length === 0, m);
}
{
  const m = findDuplicateConfirmations([obligation({ recipientWallet: 'LTpv5j' })], [confirmation()]);
  check('different wallet, same service → payable', m.length === 0, m);
}
{
  // missing identity on the selection: Rule B requires both fields
  const m = findDuplicateConfirmations([obligation({ service: '' })], [confirmation({ tag: { service: '' } })]);
  check('empty service never matches Rule B', m.length === 0, m);
}

console.log('— timestamp_paid beats a re-signed created_at —');
{
  const ev = confirmation({ created_at: T0 + 5 * DAY, tag: { timestamp_paid: String(T0 - 10 * DAY) } });
  check('confirmationPaidAt prefers timestamp_paid', confirmationPaidAt(ev) === T0 - 10 * DAY, confirmationPaidAt(ev));
  // RetryEvents re-signed an OLD payment yesterday: real pay time 10 days pre-mint → not a duplicate
  const m = findDuplicateConfirmations([obligation()], [ev]);
  check('re-signed old payment does not block the new cycle', m.length === 0, m);
}

console.log('— margin boundary —');
{
  const atEdge = confirmation({ created_at: T0 - REGENERATION_MARGIN_SECONDS });
  check('payment exactly at mint−margin → blocked', findDuplicateConfirmations([obligation()], [atEdge]).length === 1);
  const past = confirmation({ created_at: T0 - REGENERATION_MARGIN_SECONDS - 1 });
  check('payment just past the margin → payable', findDuplicateConfirmations([obligation()], [past]).length === 0);
}

console.log('— batch semantics —');
{
  const items = [obligation(), obligation({ proposalId: 'ev-other', service: 'lanawatch.us', recipientWallet: 'LTpv5j' })];
  const m = findDuplicateConfirmations(items, [confirmation()]);
  check('only the settled item matches; the rest of the batch is untouched', m.length === 1 && m[0].obligation.proposalId === 'ev-new', m);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
