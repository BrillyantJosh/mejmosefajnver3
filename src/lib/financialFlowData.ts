/**
 * Pure data layer for the Transparency → Financial Flow analyzer.
 *
 * Everything here takes raw Nostr events / API rows and returns section
 * summaries — no fetching, no React — so the unit conversions (lanoshi vs
 * LANA vs fiat) and the per-currency arithmetic are testable in isolation
 * (scripts/testFinancialFlow.ts).
 *
 * Fleet-wide rules honored throughout:
 *  - amounts in different currencies are NEVER summed together (KIND 38888
 *    publishes the same number for EUR and GBP — there is no real FX);
 *  - NIP-33 kinds are deduped newest-per-d before any counting;
 *  - `timestamp_paid` beats `created_at` where present (relay-retry re-signs
 *    events with a fresh created_at).
 */

export const LANOSHI = 100_000_000;

export interface FlowEvent {
  id: string;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

export const tagOf = (ev: FlowEvent, name: string): string =>
  ev.tags.find((t) => t[0] === name)?.[1] || '';

export const firstPTag = (ev: FlowEvent): string =>
  ev.tags.find((t) => t[0] === 'p')?.[1] || '';

/**
 * Newest event per NIP-33 identity. The identity is (pubkey, d) — NEVER the
 * d-tag alone: relays store same-d events from different authors side by
 * side, and an author-blind dedup would let anyone shadow a genuine record
 * out of the totals by republishing its d with a newer created_at.
 */
export function newestPerD(events: FlowEvent[]): FlowEvent[] {
  const byIdentity = new Map<string, FlowEvent>();
  for (const ev of events) {
    const key = `${ev.pubkey}:${tagOf(ev, 'd') || ev.id}`;
    const kept = byIdentity.get(key);
    if (!kept || ev.created_at > kept.created_at) byIdentity.set(key, ev);
  }
  return [...byIdentity.values()];
}

/** The moment money moved: timestamp_paid tag when sane, else created_at. */
export function paidAtOf(ev: FlowEvent): number {
  const stamped = Number.parseInt(tagOf(ev, 'timestamp_paid'), 10);
  return Number.isFinite(stamped) && stamped > 0 ? stamped : ev.created_at;
}

// ── per-currency arithmetic ─────────────────────────────────────────────

export type PerCurrency = Record<string, number>;

export function addCurrency(acc: PerCurrency, currency: string, amount: number): PerCurrency {
  const c = (currency || 'EUR').toUpperCase();
  if (Number.isFinite(amount) && amount !== 0) acc[c] = (acc[c] || 0) + amount;
  return acc;
}

export function perCurrencyEntries(pc: PerCurrency): Array<[string, number]> {
  return Object.entries(pc).sort(([a], [b]) => a.localeCompare(b));
}

// ── monthly buckets ─────────────────────────────────────────────────────

/** UTC "YYYY-MM" of an epoch-seconds timestamp. */
export function monthKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 7);
}

export interface MonthlyAmounts {
  thisMonth: PerCurrency;
  lastMonth: PerCurrency;
}

/** Split dated amounts into this-month / last-month buckets (UTC months). */
export function monthlySplit(
  items: Array<{ ts: number; currency: string; amount: number }>,
  now: Date,
): MonthlyAmounts {
  const thisKey = now.toISOString().slice(0, 7);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastKey = last.toISOString().slice(0, 7);
  const out: MonthlyAmounts = { thisMonth: {}, lastMonth: {} };
  for (const item of items) {
    const key = monthKey(item.ts);
    if (key === thisKey) addCurrency(out.thisMonth, item.currency, item.amount);
    else if (key === lastKey) addCurrency(out.lastMonth, item.currency, item.amount);
  }
  return out;
}

// ── balances: KIND 30889 wallet buckets ─────────────────────────────────

export interface WalletRow {
  walletId: string;
  walletType: string;
  note?: string;
  freezeStatus?: string;
}

export interface WalletBucket {
  label: string;
  wallets: Array<WalletRow & { balance: number }>;
  totalLana: number;
}

/** The page's three requested groups, plus everything else so no money hides. */
export function bucketWallets(
  wallets: WalletRow[],
  balances: Map<string, number>,
): { lana8wonder: WalletBucket; spending: WalletBucket; lanapays: WalletBucket; other: WalletBucket; totalLana: number } {
  const mk = (label: string): WalletBucket => ({ label, wallets: [], totalLana: 0 });
  const lana8wonder = mk('Lana8Wonder');
  const spending = mk('Wallet + Main Wallet + Retail');
  const lanapays = mk('LanaPays.Us');
  const other = mk('Other registered wallets');

  // A walletId listed twice (e.g. under two types after a re-type) must count
  // its balance once — first occurrence wins.
  const seen = new Set<string>();
  const uniqueWallets = wallets.filter((w) => {
    if (seen.has(w.walletId)) return false;
    seen.add(w.walletId);
    return true;
  });

  const SPENDING_TYPES = new Set(['Wallet', 'Main Wallet', 'Retail']);
  for (const w of uniqueWallets) {
    const balance = balances.get(w.walletId) ?? 0;
    const bucket =
      w.walletType === 'Lana8Wonder' ? lana8wonder
      : SPENDING_TYPES.has(w.walletType) ? spending
      : w.walletType === 'LanaPays.Us' ? lanapays
      : other;
    bucket.wallets.push({ ...w, balance });
    bucket.totalLana += balance;
  }
  const totalLana = lana8wonder.totalLana + spending.totalLana + lanapays.totalLana + other.totalLana;
  return { lana8wonder, spending, lanapays, other, totalLana };
}

// ── KIND 30933 purchases: spending + merchant income ────────────────────

export interface PurchaseRecord {
  id: string;
  ts: number;
  amountFiat: number;
  currency: string;
  lana: number;
  paymentType: string; // 'cash' | 'lana'
  merchantName: string;
  merchantHex: string;
  customerHex: string;
  unitId: string;
  cashbackFiat: number;
}

export interface SpendingSummary {
  purchases: PurchaseRecord[]; // customer side, newest first
  totalFiat: PerCurrency;
  totalLana: number;
  count: number;
  byCashFiat: PerCurrency;
  byLanaFiat: PerCurrency;
  cashbackFiat: PerCurrency;
  monthly: MonthlyAmounts;
  merchantRows: PurchaseRecord[]; // where the analyzed user is the merchant
}

export function parse30933(ev: FlowEvent): PurchaseRecord {
  const amountFiat = Number.parseFloat(tagOf(ev, 'amount')) || 0;
  const discountPer = Number.parseFloat(tagOf(ev, 'lana_discount_per')) || 0;
  const paymentType = tagOf(ev, 'payment_type') || 'lana';
  return {
    id: tagOf(ev, 'd') || ev.id,
    ts: paidAtOf(ev),
    amountFiat,
    currency: tagOf(ev, 'currency') || 'EUR',
    lana: (Number.parseInt(tagOf(ev, 'lana_amount'), 10) || 0) / LANOSHI,
    paymentType,
    merchantName: tagOf(ev, 'merchant_name') || '',
    merchantHex: (tagOf(ev, 'merchant_hex') || '').toLowerCase(),
    // The only p tag on a 30933 is the customer — legacy events carry it
    // without a customer_hex tag.
    customerHex: (tagOf(ev, 'customer_hex') || firstPTag(ev)).toLowerCase(),
    unitId: tagOf(ev, 'unit_id') || '',
    cashbackFiat: paymentType === 'cash' ? (amountFiat * discountPer) / 100 : 0,
  };
}

/**
 * Purchases for one user out of a merged 30933 event set.
 * `processorSigners` non-empty → only events signed by a processor count
 * (forged purchase events must not enter anyone's spending record). The
 * signer filter runs BEFORE the dedup, so a forged same-d event can neither
 * count nor shadow the genuine one.
 */
export function summarizeSpending(
  events: FlowEvent[],
  pubkey: string,
  processorSigners: string[],
  now: Date,
): SpendingSummary {
  const hex = pubkey.toLowerCase();
  const signers = new Set(processorSigners.map((s) => s.toLowerCase()));
  const signed = signers.size > 0
    ? events.filter((ev) => signers.has(ev.pubkey.toLowerCase()))
    : events;
  const valid = newestPerD(signed).filter((ev) => {
    const status = tagOf(ev, 'status');
    return status !== 'cancelled' && status !== 'failed';
  });

  const records = valid.map(parse30933);
  const purchases = records
    .filter((r) => r.customerHex === hex)
    .sort((a, b) => b.ts - a.ts);
  const merchantRows = records
    .filter((r) => r.merchantHex === hex)
    .sort((a, b) => b.ts - a.ts);

  const totalFiat: PerCurrency = {};
  const byCashFiat: PerCurrency = {};
  const byLanaFiat: PerCurrency = {};
  const cashbackFiat: PerCurrency = {};
  let totalLana = 0;
  for (const p of purchases) {
    addCurrency(totalFiat, p.currency, p.amountFiat);
    addCurrency(p.paymentType === 'cash' ? byCashFiat : byLanaFiat, p.currency, p.amountFiat);
    addCurrency(cashbackFiat, p.currency, p.cashbackFiat);
    totalLana += p.lana;
  }

  return {
    purchases,
    totalFiat,
    totalLana,
    count: purchases.length,
    byCashFiat,
    byLanaFiat,
    cashbackFiat,
    monthly: monthlySplit(purchases.map((p) => ({ ts: p.ts, currency: p.currency, amount: p.amountFiat })), now),
    merchantRows,
  };
}

// ── lana.discount: KIND 30936 buybacks + 30937 fiat payouts ─────────────

export interface DiscountSummary {
  sales: Array<{ id: string; ts: number; lana: number; grossFiat: number; commissionFiat: number; netFiat: number; paidFiat: number; currency: string; status: string; txHash: string }>;
  payouts: Array<{ id: string; ts: number; amount: number; currency: string; paidToAccount: string; reference: string; saleRef: string }>;
  lanaSold: number;
  grossFiat: PerCurrency;
  commissionFiat: PerCurrency;
  netFiat: PerCurrency;
  paidOutFiat: PerCurrency;
  remainingFiat: PerCurrency;
}

/** Statuses lana.discount itself counts as a real sale (its /sales endpoint). */
const DISCOUNT_SALE_STATUSES = new Set(['broadcast', 'pending_verification', 'completed', 'paid']);

export function summarizeDiscount(
  buybacks: FlowEvent[],
  payouts: FlowEvent[],
  pubkey: string,
): DiscountSummary {
  const hex = pubkey.toLowerCase();
  const mine36 = newestPerD(buybacks).filter((ev) => (tagOf(ev, 'user_hex') || '').toLowerCase() === hex);
  const mine37 = newestPerD(payouts).filter((ev) => (tagOf(ev, 'user_hex') || '').toLowerCase() === hex);

  // One on-chain sale can be republished under DIFFERENT d values — dedupe by
  // tx_hash too (newest wins), or lanaSold and "still to be paid" double-count.
  const byTxHash = new Map<string, FlowEvent>();
  for (const ev of mine36) {
    const key = tagOf(ev, 'tx_hash') || `${ev.pubkey}:${tagOf(ev, 'd') || ev.id}`;
    const kept = byTxHash.get(key);
    if (!kept || ev.created_at > kept.created_at) byTxHash.set(key, ev);
  }

  const saleEvents = [...byTxHash.values()].filter((ev) =>
    DISCOUNT_SALE_STATUSES.has(tagOf(ev, 'status')));

  const sales = saleEvents
    .map((ev) => ({
      id: tagOf(ev, 'd') || ev.id,
      ts: ev.created_at,
      lana: Number.parseFloat(tagOf(ev, 'lana_display')) || 0,
      grossFiat: Number.parseFloat(tagOf(ev, 'gross_fiat')) || 0,
      commissionFiat: Number.parseFloat(tagOf(ev, 'commission_fiat')) || 0,
      netFiat: Number.parseFloat(tagOf(ev, 'net_fiat')) || 0,
      // paid_fiat on the 30936 is the service's running paid total for THIS
      // sale — authoritative, unlike summing 30937s (legacy ones lack user_hex).
      paidFiat: Number.parseFloat(tagOf(ev, 'paid_fiat')) || 0,
      currency: tagOf(ev, 'currency') || 'EUR',
      status: tagOf(ev, 'status') || '',
      txHash: tagOf(ev, 'tx_hash') || '',
    }))
    .sort((a, b) => b.ts - a.ts);

  const payoutRows = mine37
    .map((ev) => ({
      id: tagOf(ev, 'd') || ev.id,
      ts: ev.created_at,
      amount: Number.parseFloat(tagOf(ev, 'amount')) || 0,
      currency: tagOf(ev, 'currency') || 'EUR',
      paidToAccount: tagOf(ev, 'paid_to_account') || '',
      reference: tagOf(ev, 'reference') || '',
      // which sale (30936 d-tag) this installment settles
      saleRef: tagOf(ev, 'tx_ref') || '',
    }))
    .sort((a, b) => b.ts - a.ts);

  // Neither source alone is trustworthy, so reconcile per sale and take the
  // larger. Observed on production: three sales carry status='paid' with
  // paid_fiat still 0 because the 30936 was never republished after the final
  // installment — trusting paid_fiat there would claim ~1266 EUR is still owed
  // when it was paid. Conversely a legacy 30937 missing user_hex drops out of
  // this set, and paid_fiat covers that direction. Taking the max is the only
  // choice that cannot overstate what someone is still owed.
  const payoutsBySale = new Map<string, number>();
  for (const p of payoutRows) {
    if (!p.saleRef) continue;
    payoutsBySale.set(p.saleRef, (payoutsBySale.get(p.saleRef) || 0) + p.amount);
  }

  const grossFiat: PerCurrency = {};
  const commissionFiat: PerCurrency = {};
  const netFiat: PerCurrency = {};
  const paidOutFiat: PerCurrency = {};
  let lanaSold = 0;
  const countedSaleIds = new Set(sales.map((s) => s.id));
  for (const s of sales) {
    lanaSold += s.lana;
    addCurrency(grossFiat, s.currency, s.grossFiat);
    addCurrency(commissionFiat, s.currency, s.commissionFiat);
    addCurrency(netFiat, s.currency, s.netFiat);
    addCurrency(paidOutFiat, s.currency, Math.max(s.paidFiat, payoutsBySale.get(s.id) || 0));
  }
  // An installment that references no counted sale is still money that left —
  // count it rather than let it vanish from "paid out".
  for (const p of payoutRows) {
    if (!p.saleRef || !countedSaleIds.has(p.saleRef)) addCurrency(paidOutFiat, p.currency, p.amount);
  }

  const remainingFiat: PerCurrency = {};
  for (const [cur, net] of Object.entries(netFiat)) {
    const remaining = net - (paidOutFiat[cur] || 0);
    if (remaining > 0.005) remainingFiat[cur] = remaining;
  }

  return { sales, payouts: payoutRows, lanaSold, grossFiat, commissionFiat, netFiat, paidOutFiat, remainingFiat };
}

// ── Lana8Wonder: KIND 88888 annuity plan analysis ───────────────────────

export interface AnnuityLevel {
  level_no: number;
  trigger_price: number;
  coins_to_give: number;
  cash_out: number;
  remaining_lanas: number;
}
export interface AnnuityAccount { account_id: number; wallet: string; levels: AnnuityLevel[] }
export interface AnnuityPlan { subject_hex?: string; currency?: string; accounts?: AnnuityAccount[] }

/** Same 2% tolerance every existing Lana8Wonder surface applies. */
export const L8W_BALANCE_TOLERANCE = 1.02;

export interface L8WAccountAnalysis {
  accountId: number;
  wallet: string;
  balance: number;
  withdrawnLana: number;     // coins_to_give over levels classified paid-out
  plannedFiatOut: number;    // cash_out over those levels (plan currency)
  pendingLana: number;       // balance − lastTriggered.remaining, when above tolerance
  pendingFiat: number;
}

export interface L8WSummary {
  currency: string;
  accounts: L8WAccountAnalysis[];
  totalWithdrawnLana: number;
  totalPlannedFiatOut: number;
  totalPendingLana: number;
  totalPendingFiat: number;
  totalBalance: number;
  /** Accounts whose balance could not be read — excluded from every total. */
  unknownBalanceCount: number;
}

/**
 * "Koliko si je izplačal": the app's own paid-out rule — a level counts as
 * cashed out when its trigger price is reached AND the wallet no longer holds
 * more than remaining_lanas (×1.02). cash_out is the PLANNED fiat for the
 * level; the actual sale price is not recorded anywhere.
 */
export function analyzeAnnuityPlan(
  plan: AnnuityPlan,
  balances: Map<string, number>,
  currentPrice: number,
): L8WSummary {
  const accounts: L8WAccountAnalysis[] = [];
  let unknownBalanceCount = 0;
  for (const acc of plan.accounts || []) {
    const balance = balances.get(acc.wallet);
    // A missing balance must NOT default to 0: zero satisfies
    // "balance <= remaining" for every level, which would report the whole
    // plan as cashed out on nothing more than a failed Electrum call.
    if (balance === undefined) {
      unknownBalanceCount += 1;
      continue;
    }
    const levels = [...(acc.levels || [])].sort((a, b) => a.level_no - b.level_no);
    const triggered = levels.filter((l) => currentPrice >= l.trigger_price);

    let withdrawnLana = 0;
    let plannedFiatOut = 0;
    for (const l of triggered) {
      if (balance <= l.remaining_lanas * L8W_BALANCE_TOLERANCE) {
        withdrawnLana += l.coins_to_give || 0;
        plannedFiatOut += l.cash_out || 0;
      }
    }

    const lastTriggered = triggered.length > 0 ? triggered[triggered.length - 1] : null;
    let pendingLana = 0;
    if (lastTriggered && balance > lastTriggered.remaining_lanas * L8W_BALANCE_TOLERANCE) {
      pendingLana = balance - lastTriggered.remaining_lanas;
    }

    accounts.push({
      accountId: acc.account_id,
      wallet: acc.wallet,
      balance,
      withdrawnLana,
      plannedFiatOut,
      pendingLana,
      pendingFiat: pendingLana * currentPrice,
    });
  }

  return {
    currency: plan.currency || 'EUR',
    accounts,
    totalWithdrawnLana: accounts.reduce((s, a) => s + a.withdrawnLana, 0),
    totalPlannedFiatOut: accounts.reduce((s, a) => s + a.plannedFiatOut, 0),
    totalPendingLana: accounts.reduce((s, a) => s + a.pendingLana, 0),
    totalPendingFiat: accounts.reduce((s, a) => s + a.pendingFiat, 0),
    totalBalance: accounts.reduce((s, a) => s + a.balance, 0),
    unknownBalanceCount,
  };
}

// ── unconditional payments: proposals already matched server-side ───────

export interface UpProposalRow {
  payerPubkey: string;
  recipientPubkey: string;
  service: string;
  fiatCurrency: string;
  fiatAmount: string;
  isPaid?: boolean;
  createdAt: number;
}

export interface UpSummary {
  owedFiat: PerCurrency;    // everything proposed to the user as payer
  paidFiat: PerCurrency;    // the settled part
  openFiat: PerCurrency;    // owed − paid, by proposal
  openCount: number;
  paidCount: number;
  receivedFiat: PerCurrency; // proposals where the user is the recipient and paid
}

export function summarizeUnconditionalPayments(proposals: UpProposalRow[], pubkey: string): UpSummary {
  const out: UpSummary = { owedFiat: {}, paidFiat: {}, openFiat: {}, openCount: 0, paidCount: 0, receivedFiat: {} };
  for (const p of proposals) {
    const amount = Number.parseFloat(p.fiatAmount) || 0;
    if (p.payerPubkey === pubkey) {
      addCurrency(out.owedFiat, p.fiatCurrency, amount);
      if (p.isPaid) {
        addCurrency(out.paidFiat, p.fiatCurrency, amount);
        out.paidCount += 1;
      } else {
        addCurrency(out.openFiat, p.fiatCurrency, amount);
        out.openCount += 1;
      }
    } else if (p.recipientPubkey === pubkey && p.isPaid) {
      addCurrency(out.receivedFiat, p.fiatCurrency, amount);
    }
  }
  return out;
}

// ── PLAN15: membership + trades ─────────────────────────────────────────

export interface Plan15Summary {
  isMember: boolean;
  status: string;
  plan15Wallet: string;
  stakerWallet: string;
  isStaker: boolean;
  holdingsLana: number; // balances of plan15 + staker wallets
  boughtUnregLana: number;   // 91515 authored: amount
  paidRegLana: number;       // 91515 authored: payment_amount
  purchasesCount: number;
  soldUnregLana: number;     // 91515 #p (user is seller): amount
  receivedRegLana: number;   // 91515 #p: payment_amount
  salesCount: number;
  activeOffersLana: number;  // 31516 authored, status active
  activeOffersCount: number;
}

export function summarizePlan15(
  membership: FlowEvent | null,
  offersAuthored: FlowEvent[],
  acceptancesAuthored: FlowEvent[],
  acceptancesAsSeller: FlowEvent[],
  balances: Map<string, number>,
  pubkey: string,
): Plan15Summary {
  const plan15Wallet = membership ? tagOf(membership, 'plan15_wallet') : '';
  const stakerWallet = membership ? tagOf(membership, 'staker_wallet') : '';
  const holdingsLana = (plan15Wallet ? balances.get(plan15Wallet) ?? 0 : 0)
    + (stakerWallet && stakerWallet !== plan15Wallet ? balances.get(stakerWallet) ?? 0 : 0);

  const sumTag = (events: FlowEvent[], name: string) =>
    events.reduce((s, ev) => s + (Number.parseInt(tagOf(ev, name), 10) || 0), 0) / LANOSHI;

  const ownOffers = newestPerD(offersAuthored.filter((ev) => ev.pubkey === pubkey));
  const activeOffers = ownOffers.filter((ev) => tagOf(ev, 'status') === 'active');

  // A 91515 merely p-tagging the user proves nothing — anyone can publish one.
  // A sale counts only when its `a` tag addresses one of the user's OWN offers.
  const ownOfferAddresses = new Set(ownOffers.map((ev) => `31516:${pubkey}:${tagOf(ev, 'd')}`));
  const verifiedSales = acceptancesAsSeller.filter((ev) => ownOfferAddresses.has(tagOf(ev, 'a')));

  return {
    isMember: !!membership && tagOf(membership, 'status') === 'active',
    status: membership ? tagOf(membership, 'status') : '',
    plan15Wallet,
    stakerWallet,
    isStaker: membership ? tagOf(membership, 'is_staker') === 'yes' : false,
    holdingsLana,
    boughtUnregLana: sumTag(acceptancesAuthored, 'amount'),
    paidRegLana: sumTag(acceptancesAuthored, 'payment_amount'),
    purchasesCount: acceptancesAuthored.length,
    soldUnregLana: sumTag(verifiedSales, 'amount'),
    receivedRegLana: sumTag(verifiedSales, 'payment_amount'),
    salesCount: verifiedSales.length,
    activeOffersLana: sumTag(activeOffers, 'amount'),
    activeOffersCount: activeOffers.length,
  };
}

// ── donations made: crowd-funding 60200 + events 53334 + LASH 39991 ─────

export interface DonationsSummary {
  crowdFiat: PerCurrency;
  crowdLana: number;
  crowdCount: number;
  monthly: MonthlyAmounts;
  eventsLana: number;
  eventsCount: number;
  lashSentLana: number;
  lashSentCount: number;
  lashReceivedLana: number;
  lashReceivedCount: number;
}

export function summarizeDonationsMade(
  crowd60200: FlowEvent[],
  events53334: FlowEvent[],
  lashSent39991: FlowEvent[],
  lashReceived39991: FlowEvent[],
  now: Date,
): DonationsSummary {
  const crowdFiat: PerCurrency = {};
  let crowdLana = 0;
  const dated: Array<{ ts: number; currency: string; amount: number }> = [];
  // A batch donation also publishes a type='mentor_fee' 60200 — that is
  // commission to the mentor, not a donation. The fleet indexer skips it too.
  const donations = crowd60200.filter((ev) => tagOf(ev, 'type') !== 'mentor_fee');
  for (const ev of donations) {
    const fiat = Number.parseFloat(tagOf(ev, 'amount_fiat')) || 0;
    const currency = tagOf(ev, 'currency') || 'EUR';
    addCurrency(crowdFiat, currency, fiat);
    crowdLana += (Number.parseInt(tagOf(ev, 'amount_lanoshis'), 10) || 0) / LANOSHI;
    dated.push({ ts: paidAtOf(ev), currency, amount: fiat });
  }
  const crowdCount = donations.length;

  let eventsLana = 0;
  for (const ev of events53334) eventsLana += Number.parseFloat(tagOf(ev, 'amount_lana')) || 0;

  // LASH: only records that actually settled carry a txid.
  const lashPaid = (events: FlowEvent[]) => newestPerD(events).filter((ev) => tagOf(ev, 'state') === 'paid');
  const lashSum = (events: FlowEvent[]) =>
    events.reduce((s, ev) => s + (Number.parseInt(tagOf(ev, 'amount'), 10) || 0), 0) / LANOSHI;
  const sentPaid = lashPaid(lashSent39991);
  const receivedPaid = lashPaid(lashReceived39991);

  return {
    crowdFiat,
    crowdLana,
    crowdCount,
    monthly: monthlySplit(dated, now),
    eventsLana,
    eventsCount: events53334.length,
    lashSentLana: lashSum(sentPaid),
    lashSentCount: sentPaid.length,
    lashReceivedLana: lashSum(receivedPaid),
    lashReceivedCount: receivedPaid.length,
  };
}

// ── LanaFund.Me: fundraiser units + received purchases ──────────────────

export interface LanaFundUnit { unitId: string; name: string; status: string }

export function parseLanaFundUnits(units30901: FlowEvent[]): LanaFundUnit[] {
  return newestPerD(units30901)
    .filter((ev) => tagOf(ev, 'unit_type') === 'lanafund.me')
    .map((ev) => ({
      unitId: tagOf(ev, 'd'),
      name: tagOf(ev, 'name') || tagOf(ev, 'd'),
      status: tagOf(ev, 'status') || '',
    }));
}

export interface LanaFundSummary {
  units: Array<LanaFundUnit & { receivedFiat: PerCurrency; receivedLana: number; donationCount: number }>;
  totalFiat: PerCurrency;
  totalLana: number;
  totalCount: number;
  monthly: MonthlyAmounts;
}

/** Donations received on the user's LanaFund.Me fundraisers, out of the merchant-side 30933 rows. */
export function summarizeLanaFund(
  units: LanaFundUnit[],
  merchantRows: PurchaseRecord[],
  now: Date,
): LanaFundSummary {
  const byUnit = new Map(units.map((u) => [u.unitId, { ...u, receivedFiat: {} as PerCurrency, receivedLana: 0, donationCount: 0 }]));
  const totalFiat: PerCurrency = {};
  let totalLana = 0;
  let totalCount = 0;
  const dated: Array<{ ts: number; currency: string; amount: number }> = [];

  for (const row of merchantRows) {
    const unit = byUnit.get(row.unitId);
    if (!unit) continue; // merchant income on a non-LanaFund unit (ordinary shop)
    addCurrency(unit.receivedFiat, row.currency, row.amountFiat);
    unit.receivedLana += row.lana;
    unit.donationCount += 1;
    addCurrency(totalFiat, row.currency, row.amountFiat);
    totalLana += row.lana;
    totalCount += 1;
    dated.push({ ts: row.ts, currency: row.currency, amount: row.amountFiat });
  }

  return { units: [...byUnit.values()], totalFiat, totalLana, totalCount, monthly: monthlySplit(dated, now) };
}

// ── Unconditional Financing: requests the user raised themselves ────────

export interface UfFinancingRow {
  request: {
    id: string;
    title: string;
    coverImage?: string | null;
    fiatGoal: number;
    currency: string;
    phase?: string;
    contributionCount?: number;
    financierCount?: number;
  };
  totalFunded: number;
  totalRepaid: number;
  outstanding: number;
}

export interface UfFinancingsSummary {
  financings: UfFinancingRow[];
  goalFiat: PerCurrency;
  fundedFiat: PerCurrency;
  /** goal − funded, per request, never negative — "koliko se še čaka". */
  stillWaitingFiat: PerCurrency;
  repaidFiat: PerCurrency;
  outstandingFiat: PerCurrency;
}

export function summarizeUfFinancings(rows: UfFinancingRow[]): UfFinancingsSummary {
  const goalFiat: PerCurrency = {};
  const fundedFiat: PerCurrency = {};
  const stillWaitingFiat: PerCurrency = {};
  const repaidFiat: PerCurrency = {};
  const outstandingFiat: PerCurrency = {};
  for (const row of rows) {
    const currency = row.request?.currency || 'EUR';
    const goal = row.request?.fiatGoal || 0;
    addCurrency(goalFiat, currency, goal);
    addCurrency(fundedFiat, currency, row.totalFunded || 0);
    addCurrency(stillWaitingFiat, currency, Math.max(goal - (row.totalFunded || 0), 0));
    addCurrency(repaidFiat, currency, row.totalRepaid || 0);
    addCurrency(outstandingFiat, currency, row.outstanding || 0);
  }
  return { financings: rows, goalFiat, fundedFiat, stillWaitingFiat, repaidFiat, outstandingFiat };
}

// ── 100 Million Ideas projects (lanacrowd REST rows) ────────────────────

export interface LanacrowdProjectRow {
  id: string;
  title: string;
  coverImage?: string | null;
  fiatGoal: number;
  currency: string;
  totalRaised: number;
  donationCount: number;
  status: string;
  isFunded?: number | boolean;
  isCompleted?: number | boolean;
  isHidden?: number | boolean;
}

export interface ProjectsSummary {
  projects: LanacrowdProjectRow[];
  goalFiat: PerCurrency;
  raisedFiat: PerCurrency;
  remainingFiat: PerCurrency; // "koliko se čaka" — max(goal − raised, 0) per project
  monthly: MonthlyAmounts;    // received donations by month
}

export function summarizeProjects(
  projects: LanacrowdProjectRow[],
  receivedDonations: Array<{ amountFiat: number; currency: string; nostrCreatedAt: number }>,
  now: Date,
): ProjectsSummary {
  const goalFiat: PerCurrency = {};
  const raisedFiat: PerCurrency = {};
  const remainingFiat: PerCurrency = {};
  for (const p of projects) {
    addCurrency(goalFiat, p.currency, p.fiatGoal);
    addCurrency(raisedFiat, p.currency, p.totalRaised);
    addCurrency(remainingFiat, p.currency, Math.max((p.fiatGoal || 0) - (p.totalRaised || 0), 0));
  }
  return {
    projects,
    goalFiat,
    raisedFiat,
    remainingFiat,
    monthly: monthlySplit(
      receivedDonations.map((d) => ({ ts: d.nostrCreatedAt, currency: d.currency, amount: d.amountFiat })),
      now,
    ),
  };
}
