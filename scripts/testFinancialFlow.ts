/**
 * Pure-logic tests for the Financial Flow data layer.
 *   npx tsx scripts/testFinancialFlow.ts
 *
 * The unit conversions are the whole game here: lanoshi vs LANA vs fiat,
 * per-currency separation, NIP-33 dedup, and the Lana8Wonder paid-out rule.
 */
import {
  LANOSHI,
  addCurrency,
  analyzeAnnuityPlan,
  bucketWallets,
  monthKey,
  monthlySplit,
  newestPerD,
  parseLanaFundUnits,
  summarizeDiscount,
  summarizeDonationsMade,
  summarizeLanaFund,
  summarizePlan15,
  summarizeProjects,
  summarizeSpending,
  summarizeUfFinancings,
  summarizeUnconditionalPayments,
  type FlowEvent,
} from '../src/lib/financialFlowData.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail).slice(0, 220)}`);
  if (!cond) failures++;
};

const NOW = new Date('2026-08-13T12:00:00Z');
const T_THIS = Math.floor(Date.parse('2026-08-05T10:00:00Z') / 1000);
const T_LAST = Math.floor(Date.parse('2026-07-20T10:00:00Z') / 1000);
const T_OLD = Math.floor(Date.parse('2026-05-01T10:00:00Z') / 1000);

const ev = (id: string, pubkey: string, created_at: number, tags: string[][], content = ''): FlowEvent =>
  ({ id, pubkey, created_at, tags, content });

console.log('— per-currency and months —');
{
  const pc = {};
  addCurrency(pc, 'EUR', 5); addCurrency(pc, 'eur', 2.5); addCurrency(pc, 'GBP', 3);
  check('currencies stay separated, case-folded', (pc as any).EUR === 7.5 && (pc as any).GBP === 3, pc);
  check('monthKey is UTC', monthKey(T_THIS) === '2026-08' && monthKey(T_LAST) === '2026-07');
  const m = monthlySplit([
    { ts: T_THIS, currency: 'EUR', amount: 10 },
    { ts: T_LAST, currency: 'EUR', amount: 20 },
    { ts: T_OLD, currency: 'EUR', amount: 99 },
  ], NOW);
  check('this/last month buckets; older ignored', (m.thisMonth as any).EUR === 10 && (m.lastMonth as any).EUR === 20 && Object.keys(m.thisMonth).length === 1, m);

  // January: "last month" is December of the PREVIOUS year.
  const jan = monthlySplit([
    { ts: Math.floor(Date.parse('2027-01-05T00:00:00Z') / 1000), currency: 'EUR', amount: 1 },
    { ts: Math.floor(Date.parse('2026-12-28T00:00:00Z') / 1000), currency: 'EUR', amount: 2 },
  ], new Date('2027-01-15T00:00:00Z'));
  check('year boundary: December counts as last month', (jan.thisMonth as any).EUR === 1 && (jan.lastMonth as any).EUR === 2, jan);
}

console.log('— NIP-33 dedup —');
{
  const events = [
    ev('a', 'x', 100, [['d', 'k1'], ['status', 'processing']]),
    ev('b', 'x', 200, [['d', 'k1'], ['status', 'cancelled']]),
    ev('c', 'x', 150, [['d', 'k2'], ['status', 'settled']]),
  ];
  const deduped = newestPerD(events);
  check('newest per d wins', deduped.length === 2 && deduped.find((e) => e.id === 'b') !== undefined, deduped.map((e) => e.id));

  // Addressable identity is (pubkey, d) — a stranger reusing a d must not
  // shadow the real author's event out of the set.
  const withImpostor = [
    ev('real', 'author', 100, [['d', 'k1']]),
    ev('fake', 'impostor', 999, [['d', 'k1']]),
  ];
  const both = newestPerD(withImpostor);
  check('same d from different authors kept apart', both.length === 2, both.map((e) => e.id));
}

console.log('— wallet buckets —');
{
  const wallets = [
    { walletId: 'W1', walletType: 'Main Wallet' },
    { walletId: 'W2', walletType: 'Wallet' },
    { walletId: 'W3', walletType: 'Retail' },
    { walletId: 'W4', walletType: 'Lana8Wonder' },
    { walletId: 'W5', walletType: 'LanaPays.Us' },
    { walletId: 'W6', walletType: 'Knights' },
  ];
  const balances = new Map([['W1', 10], ['W2', 20], ['W3', 30], ['W4', 40], ['W5', 50], ['W6', 60]]);
  const b = bucketWallets(wallets, balances);
  check('spending bucket = Wallet+Main+Retail', b.spending.totalLana === 60, b.spending);
  check('L8W and LanaPays.Us exact-string matched', b.lana8wonder.totalLana === 40 && b.lanapays.totalLana === 50);
  check('nothing hides: Knights lands in other', b.other.totalLana === 60 && b.totalLana === 210);

  // The same address listed twice (e.g. re-typed) must count once.
  const dup = bucketWallets(
    [{ walletId: 'W1', walletType: 'Wallet' }, { walletId: 'W1', walletType: 'Retail' }],
    new Map([['W1', 10]]),
  );
  check('duplicate walletId counted once', dup.totalLana === 10 && dup.spending.wallets.length === 1, dup.spending);
}

console.log('— spending (30933) —');
{
  const SIGNER = 'f'.repeat(64);
  const USER = 'a'.repeat(64);
  const purchase = (id: string, ts: number, amount: string, type: string, extra: string[][] = []) =>
    ev(id, SIGNER, ts, [
      ['d', id], ['customer_hex', USER], ['merchant_hex', 'b'.repeat(64)], ['amount', amount],
      ['currency', 'EUR'], ['lana_amount', String(100 * LANOSHI)], ['payment_type', type],
      ['lana_discount_per', '5'], ['status', 'settled'], ...extra,
    ]);
  const events = [
    purchase('p1', T_THIS, '10.00', 'cash'),
    purchase('p2', T_LAST, '20.00', 'lana'),
    // forged event from a non-processor author must not count
    ev('p3', 'e'.repeat(64), T_THIS, [['d', 'p3'], ['customer_hex', USER], ['amount', '999'], ['currency', 'EUR'], ['status', 'settled'], ['payment_type', 'cash'], ['lana_discount_per', '5']]),
    // cancelled purchase must not count
    purchase('p4', T_THIS, '50.00', 'cash', [['status', 'cancelled']]),
  ];
  // p4 needs its own d with cancelled status — rebuild:
  events[3] = ev('p4', SIGNER, T_THIS, [['d', 'p4'], ['customer_hex', USER], ['amount', '50.00'], ['currency', 'EUR'], ['lana_amount', '0'], ['payment_type', 'cash'], ['lana_discount_per', '5'], ['status', 'cancelled']]);

  const s = summarizeSpending(events, USER, [SIGNER], NOW);
  check('only processor-signed, non-cancelled count', s.count === 2 && (s.totalFiat as any).EUR === 30, s.totalFiat);

  // The forged event reuses a REAL purchase's d with a newer created_at: it
  // must neither count nor erase the genuine purchase from the totals.
  const shadowed = summarizeSpending(
    [...events, ev('shadow', 'e'.repeat(64), T_THIS + 500, [['d', 'p1'], ['customer_hex', USER], ['amount', '9999'], ['currency', 'EUR'], ['payment_type', 'cash'], ['lana_discount_per', '5'], ['status', 'settled']])],
    USER, [SIGNER], NOW,
  );
  check('forged same-d event cannot shadow the real purchase', shadowed.count === 2 && (shadowed.totalFiat as any).EUR === 30, shadowed.totalFiat);

  // Legacy purchases carry the customer only as a plain p tag.
  const legacy = summarizeSpending(
    [ev('old', SIGNER, T_THIS, [['d', 'old'], ['p', USER], ['amount', '7.00'], ['currency', 'EUR'], ['lana_amount', '0'], ['payment_type', 'lana'], ['status', 'settled']])],
    USER, [SIGNER], NOW,
  );
  check('legacy purchase without customer_hex is attributed via p tag', legacy.count === 1 && (legacy.totalFiat as any).EUR === 7, legacy.totalFiat);
  check('lana total = lanoshi/1e8 summed', s.totalLana === 200, s.totalLana);
  check('cash vs lana split', (s.byCashFiat as any).EUR === 10 && (s.byLanaFiat as any).EUR === 20);
  check('cashback only on cash: 5% of 10', Math.abs((s.cashbackFiat as any).EUR - 0.5) < 1e-9, s.cashbackFiat);
  check('monthly: 10 this month, 20 last', (s.monthly.thisMonth as any).EUR === 10 && (s.monthly.lastMonth as any).EUR === 20);
}

console.log('— lana.discount (30936/30937) —');
{
  const USER = 'a'.repeat(64);
  const b36 = (id: string, net: string, gross: string, comm: string, lana: string, paid = '0', tx = 't' + id, status = 'completed', ts = T_LAST) =>
    ev(id, 'svc', ts, [['d', id], ['user_hex', USER], ['lana_display', lana], ['gross_fiat', gross], ['commission_fiat', comm], ['net_fiat', net], ['paid_fiat', paid], ['currency', 'EUR'], ['status', status], ['tx_hash', tx]]);
  const p37 = (id: string, amount: string, saleRef = 's1') =>
    ev(id, 'svc', T_THIS, [['d', id], ['user_hex', USER], ['tx_ref', saleRef], ['amount', amount], ['currency', 'EUR'], ['paid_to_account', 'SI56 1234 5678 9012 345']]);
  const other36 = ev('x', 'svc', T_LAST, [['d', 'x'], ['user_hex', 'b'.repeat(64)], ['lana_display', '999'], ['net_fiat', '999'], ['currency', 'EUR'], ['status', 'completed']]);

  const d = summarizeDiscount([b36('s1', '70', '100', '30', '1000', '40'), other36], [p37('pay1', '40')], USER);
  check('only own user_hex counted', d.lanaSold === 1000 && (d.netFiat as any).EUR === 70, d);
  check('gross/commission kept apart', (d.grossFiat as any).EUR === 100 && (d.commissionFiat as any).EUR === 30);
  check('paid out reconciled from paid_fiat + installments', (d.paidOutFiat as any).EUR === 40, d.paidOutFiat);
  check('remaining = net − paid out', Math.abs((d.remainingFiat as any).EUR - 30) < 1e-9, d.remainingFiat);

  // Production shape: sale marked 'paid' but the 30936 was never republished,
  // so paid_fiat is stale at 0 while the installments cover the whole net.
  const stale = summarizeDiscount(
    [b36('s1', '70', '100', '30', '1000', '0', 'tx1', 'paid')],
    [p37('pay1', '70', 's1')], USER,
  );
  check('stale paid_fiat=0 corrected by installments', (stale.paidOutFiat as any).EUR === 70 && Object.keys(stale.remainingFiat).length === 0, stale.paidOutFiat);

  // Opposite direction: installments missing (e.g. legacy without user_hex) —
  // paid_fiat must still be honoured.
  const noInstallments = summarizeDiscount([b36('s1', '70', '100', '30', '1000', '55')], [], USER);
  check('paid_fiat honoured when installments are absent', (noInstallments.paidOutFiat as any).EUR === 55 && Math.abs((noInstallments.remainingFiat as any).EUR - 15) < 1e-9, noInstallments.paidOutFiat);

  // Same on-chain sale republished under a second d must count once.
  const twice = summarizeDiscount(
    [b36('s1', '70', '100', '30', '1000', '0', 'SAMETX'), b36('s2', '70', '100', '30', '1000', '70', 'SAMETX', 'paid', T_THIS)],
    [], USER,
  );
  check('same tx_hash under two d values counted once', twice.lanaSold === 1000 && (twice.netFiat as any).EUR === 70, twice);
  check('newest version of that sale wins (paid_fiat 70)', (twice.paidOutFiat as any).EUR === 70 && Object.keys(twice.remainingFiat).length === 0, twice.remainingFiat);

  // Statuses the service does not treat as a sale must not create an obligation.
  const cancelled = summarizeDiscount([b36('c1', '70', '100', '30', '1000', '0', 'txc', 'cancelled')], [], USER);
  check('cancelled sale excluded entirely', cancelled.sales.length === 0 && Object.keys(cancelled.netFiat).length === 0, cancelled);
}

console.log('— Lana8Wonder paid-out rule —');
{
  const plan = {
    currency: 'EUR',
    accounts: [{
      account_id: 1,
      wallet: 'L8W1',
      levels: [
        { level_no: 1, trigger_price: 0.05, coins_to_give: 500, cash_out: 25, remaining_lanas: 4500 },
        { level_no: 2, trigger_price: 0.10, coins_to_give: 500, cash_out: 50, remaining_lanas: 4000 },
        { level_no: 3, trigger_price: 0.20, coins_to_give: 1000, cash_out: 200, remaining_lanas: 3000 },
      ],
    }],
  };
  // price 0.128 → levels 1+2 triggered; balance 4100 ≤ 4500*1.02 (level1 paid)
  // and > 4000*1.02 (level2 pending): withdrawn = level1's 500 only.
  const a = analyzeAnnuityPlan(plan, new Map([['L8W1', 4100]]), 0.128);
  check('level 1 counted as withdrawn', a.totalWithdrawnLana === 500 && a.totalPlannedFiatOut === 25, a);
  check('pending = balance − last triggered remaining', a.totalPendingLana === 100, a.totalPendingLana);
  check('untriggered level 3 ignored', a.accounts[0].withdrawnLana === 500);
  // fully drawn down: balance at level2 remaining → both levels paid, no pending
  const b = analyzeAnnuityPlan(plan, new Map([['L8W1', 4000]]), 0.128);
  check('at remaining → paid out, nothing pending', b.totalWithdrawnLana === 1000 && b.totalPendingLana === 0, b);

  // An unreadable balance must not read as 0 — that would mark every
  // triggered level as withdrawn and invent cash-outs that never happened.
  const unknown = analyzeAnnuityPlan(plan, new Map(), 0.128);
  check('missing balance excluded, not treated as zero',
    unknown.totalWithdrawnLana === 0 && unknown.accounts.length === 0 && unknown.unknownBalanceCount === 1, unknown);
}

console.log('— unconditional payments split —');
{
  const USER = 'a'.repeat(64);
  const rows = [
    { payerPubkey: USER, recipientPubkey: 'x', service: 's1', fiatCurrency: 'EUR', fiatAmount: '3.00', isPaid: true, createdAt: T_THIS },
    { payerPubkey: USER, recipientPubkey: 'x', service: 's2', fiatCurrency: 'EUR', fiatAmount: '2.00', isPaid: false, createdAt: T_THIS },
    { payerPubkey: 'y', recipientPubkey: USER, service: 's3', fiatCurrency: 'GBP', fiatAmount: '5.00', isPaid: true, createdAt: T_THIS },
  ];
  const u = summarizeUnconditionalPayments(rows, USER);
  check('owed = paid + open', (u.owedFiat as any).EUR === 5 && (u.paidFiat as any).EUR === 3 && (u.openFiat as any).EUR === 2);
  check('received side kept separate, own currency', (u.receivedFiat as any).GBP === 5 && u.openCount === 1 && u.paidCount === 1);
}

console.log('— PLAN15 —');
{
  const USER = 'a'.repeat(64);
  const membership = ev('m', USER, 100, [['d', USER], ['status', 'active'], ['is_staker', 'yes'], ['plan15_wallet', 'P1'], ['staker_wallet', 'S1']]);
  const offer = ev('o1', USER, 100, [['d', 'off1'], ['status', 'active'], ['amount', String(1_000_000 * LANOSHI)]]);
  const bought = ev('b1', USER, T_THIS, [['amount', String(2_000_000 * LANOSHI)], ['payment_amount', String(1000 * LANOSHI)]]);
  const sold = ev('s1', 'buyer', T_THIS, [['a', `31516:${USER}:off1`], ['p', USER], ['amount', String(500_000 * LANOSHI)], ['payment_amount', String(250 * LANOSHI)]]);
  const p = summarizePlan15(membership, [offer], [bought], [sold], new Map([['P1', 42], ['S1', 8]]), USER);
  check('member + staker + holdings from both wallets', p.isMember && p.isStaker && p.holdingsLana === 50, p);
  check('bought/paid in LANA', p.boughtUnregLana === 2_000_000 && p.paidRegLana === 1000);
  check('sold/received in LANA', p.soldUnregLana === 500_000 && p.receivedRegLana === 250);
  check('active offers total', p.activeOffersLana === 1_000_000 && p.activeOffersCount === 1);

  // Anyone can publish a 91515 naming a victim as seller — without an `a` tag
  // addressing one of the victim's OWN offers it must not inflate their sales.
  const forgedSale = ev('f1', 'attacker', T_THIS, [['a', '31516:attacker:x'], ['p', USER], ['amount', String(9_000_000 * LANOSHI)], ['payment_amount', String(9999 * LANOSHI)]]);
  const p2 = summarizePlan15(membership, [offer], [], [sold, forgedSale], new Map(), USER);
  check('sale not anchored to an own offer is ignored', p2.salesCount === 1 && p2.soldUnregLana === 500_000, p2);
}

console.log('— donations made —');
{
  const crowd = [
    ev('d1', 'me', T_THIS, [['amount_fiat', '15.00'], ['currency', 'EUR'], ['amount_lanoshis', String(100 * LANOSHI)], ['timestamp_paid', String(T_THIS)]]),
    ev('d2', 'me', T_LAST, [['amount_fiat', '5.00'], ['currency', 'EUR'], ['amount_lanoshis', String(30 * LANOSHI)], ['timestamp_paid', String(T_LAST)]]),
  ];
  const events = [ev('e1', 'me', T_THIS, [['amount_lana', '12.5']])];
  const lashSent = [
    ev('l1', 'me', T_THIS, [['d', 'lash:1'], ['amount', String(2 * LANOSHI)], ['state', 'paid']]),
    ev('l2', 'me', T_THIS, [['d', 'lash:2'], ['amount', String(7 * LANOSHI)], ['state', 'open']]), // unpaid — not money moved
  ];
  // A batch donation also emits a mentor_fee 60200 — commission, not a donation.
  crowd.push(ev('mf', 'me', T_THIS, [['type', 'mentor_fee'], ['amount_fiat', '99.00'], ['currency', 'EUR'], ['amount_lanoshis', String(900 * LANOSHI)]]));
  const d = summarizeDonationsMade(crowd, events, lashSent, [], NOW);
  check('mentor_fee excluded from donations', (d.crowdFiat as any).EUR === 20 && d.crowdCount === 2, d.crowdFiat);
  check('crowd totals fiat+lana', (d.crowdFiat as any).EUR === 20 && d.crowdLana === 130, d);
  check('monthly crowd split', (d.monthly.thisMonth as any).EUR === 15 && (d.monthly.lastMonth as any).EUR === 5);
  check('event donations in decimal LANA', d.eventsLana === 12.5);
  check('only PAID lash counts', d.lashSentLana === 2 && d.lashSentCount === 1, d.lashSentLana);
}

console.log('— LanaFund.Me —');
{
  const USER = 'a'.repeat(64);
  const unit = ev('u1', USER, 100, [['d', 'unit-1'], ['unit_type', 'lanafund.me'], ['name', 'Pomoč za dom'], ['status', 'active']]);
  const shopUnit = ev('u2', USER, 100, [['d', 'unit-2'], ['unit_type', 'shop'], ['name', 'Trgovina']]);
  const units = parseLanaFundUnits([unit, shopUnit]);
  check('only lanafund.me units', units.length === 1 && units[0].name === 'Pomoč za dom', units);

  const merchantRows = [
    { id: 'm1', ts: T_THIS, amountFiat: 25, currency: 'EUR', lana: 200, paymentType: 'lana', merchantName: '', merchantHex: USER, customerHex: 'x', unitId: 'unit-1', cashbackFiat: 0 },
    { id: 'm2', ts: T_LAST, amountFiat: 10, currency: 'EUR', lana: 80, paymentType: 'lana', merchantName: '', merchantHex: USER, customerHex: 'y', unitId: 'unit-2', cashbackFiat: 0 }, // shop, not fundraiser
  ];
  const s = summarizeLanaFund(units, merchantRows, NOW);
  check('shop income excluded from LanaFund totals', (s.totalFiat as any).EUR === 25 && s.totalCount === 1, s.totalFiat);
  check('monthly attribution', (s.monthly.thisMonth as any).EUR === 25 && Object.keys(s.monthly.lastMonth).length === 0);
}

console.log('— unconditional financing: own requests —');
{
  const rows = [
    // the real shape from /my-financings: partially funded, nothing repaid
    { request: { id: 'uf:1', title: 'LanaFund.Me (Testni Primer)', fiatGoal: 100, currency: 'EUR', phase: 'repaying' }, totalFunded: 45, totalRepaid: 0, outstanding: 45 },
    { request: { id: 'uf:2', title: 'Overfunded', fiatGoal: 50, currency: 'EUR' }, totalFunded: 60, totalRepaid: 10, outstanding: 50 },
    { request: { id: 'uf:3', title: 'Other currency', fiatGoal: 80, currency: 'GBP' }, totalFunded: 20, totalRepaid: 0, outstanding: 20 },
  ];
  const s = summarizeUfFinancings(rows);
  check('funded and goal per currency', (s.fundedFiat as any).EUR === 105 && (s.goalFiat as any).GBP === 80, s);
  check('still waiting clamps overfunded to 0', (s.stillWaitingFiat as any).EUR === 55, s.stillWaitingFiat);
  check('repaid and outstanding carried through', (s.repaidFiat as any).EUR === 10 && (s.outstandingFiat as any).EUR === 95);
  check('currencies never merged', (s.stillWaitingFiat as any).GBP === 60, s.stillWaitingFiat);
}

console.log('— projects summary —');
{
  const projects = [
    { id: 'p1', title: 'A', fiatGoal: 100, currency: 'EUR', totalRaised: 40, donationCount: 2, status: 'active' },
    { id: 'p2', title: 'B', fiatGoal: 50, currency: 'EUR', totalRaised: 60, donationCount: 3, status: 'active' }, // overfunded
  ];
  const received = [
    { amountFiat: 30, currency: 'EUR', nostrCreatedAt: T_THIS },
    { amountFiat: 70, currency: 'EUR', nostrCreatedAt: T_LAST },
  ];
  const s = summarizeProjects(projects, received, NOW);
  check('raised and goal per currency', (s.raisedFiat as any).EUR === 100 && (s.goalFiat as any).EUR === 150);
  check('remaining clamps overfunded to 0', (s.remainingFiat as any).EUR === 60, s.remainingFiat);
  check('monthly received', (s.monthly.thisMonth as any).EUR === 30 && (s.monthly.lastMonth as any).EUR === 70);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
