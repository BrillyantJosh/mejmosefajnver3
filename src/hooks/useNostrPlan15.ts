import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { signNostrEvent } from '@/lib/nostrSigning';
import { supabase } from '@/integrations/supabase/client';

// PLAN15 kinds (see lananostr.site spec)
export const PLAN15_MEMBERSHIP_KIND = 31515; // NIP-33 replaceable, d = member pubkey
export const PLAN15_OFFER_KIND = 31516;      // NIP-33 replaceable, d = offer uuid
export const PLAN15_ACCEPTANCE_KIND = 91515; // Regular
export const PLAN15_PAYOUT_KIND = 91516;     // Regular

export const LANOSHIS_PER_LANA = 100_000_000;

export interface Plan15Member {
  pubkey: string;
  wallet: string;        // plan15_wallet
  isStaker: boolean;
  stakerWallet: string;
  paymentWallet: string; // REGISTERED wallet (KIND 30889) that receives buyer payments
  status: string;        // active | inactive
  joinedAt: number;
  eventId: string;
  createdAt: number;
}

export interface Plan15Offer {
  id: string;            // latest event id
  d: string;             // offer uuid
  address: string;       // 31516:<seller>:<d>  (stable NIP-33 key)
  seller: string;        // author pubkey
  wallet: string;        // source address
  amount: number;        // Lanoshis offered
  currency: string;
  status: string;        // active | archived
  validUntil: string;
  createdAt: number;
}

export interface Plan15Acceptance {
  id: string;            // event id
  offerAddress: string;  // a
  offerEventId: string;  // e
  seller: string;        // p
  buyer: string;         // author pubkey
  buyerWallet: string;
  amount: number;        // Lanoshis (unregistered LANA bought)
  amountFiat: string;    // reference € value
  currency: string;
  paymentAmount: number; // registered LANA paid (Lanoshis)
  paymentFrom: string;   // buyer's registered paying wallet
  paymentTo: string;     // seller's registered payment_wallet
  paymentTxid: string;   // on-chain txid of the registered-LANA payment
  status: string;
  createdAt: number;
}

export interface Plan15Payout {
  id: string;
  offerAddress: string;
  offerEventId: string;
  acceptanceEventId: string;
  buyer: string;
  fromWallet: string;
  toWallet: string;
  amount: number;        // Lanoshis
  amountFiat: string;
  txid: string;
  status: string;        // confirmed | rejected
  confirmedAt: string;
  createdAt: number;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ]);

const tagVal = (e: Event, name: string) => e.tags.find(t => t[0] === name)?.[1] || '';

export const useNostrPlan15 = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();

  const [members, setMembers] = useState<Plan15Member[]>([]);
  const [offers, setOffers] = useState<Plan15Offer[]>([]);
  const [acceptances, setAcceptances] = useState<Plan15Acceptance[]>([]);
  const [payouts, setPayouts] = useState<Plan15Payout[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({}); // wallet -> LANA
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];
  const plan15Floor = parameters?.plan15Floor || 0;           // whole LANA
  const plan15Price = parameters?.plan15Price || {};          // { EUR, USD, GBP } fiat per 1 UNREGISTERED LANA
  const exchangeRates = parameters?.exchangeRates || {};      // { EUR, USD, GBP } fiat per 1 REGISTERED LANA (fx)
  const me = session?.nostrHexId || '';

  const fetchAll = useCallback(async () => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }
    const pool = new SimplePool();
    try {
      // 1) Members (31515) + Offers (31516) — global, keep latest per NIP-33 key
      const [memberEvents, offerEvents] = await Promise.all([
        withTimeout(pool.querySync(relays, { kinds: [PLAN15_MEMBERSHIP_KIND] }), 10000, 'members') as Promise<Event[]>,
        withTimeout(pool.querySync(relays, { kinds: [PLAN15_OFFER_KIND] }), 10000, 'offers') as Promise<Event[]>,
      ]);

      // Dedup members: latest per author
      const memberByPubkey = new Map<string, Event>();
      for (const e of memberEvents) {
        const prev = memberByPubkey.get(e.pubkey);
        if (!prev || e.created_at > prev.created_at) memberByPubkey.set(e.pubkey, e);
      }
      const parsedMembers: Plan15Member[] = Array.from(memberByPubkey.values())
        .map(e => ({
          pubkey: e.pubkey,
          wallet: tagVal(e, 'plan15_wallet'),
          isStaker: (tagVal(e, 'is_staker') || '').toLowerCase() === 'yes',
          stakerWallet: tagVal(e, 'staker_wallet'),
          paymentWallet: tagVal(e, 'payment_wallet'),
          status: tagVal(e, 'status') || 'active',
          joinedAt: parseInt(tagVal(e, 'joined_at') || '0') || 0,
          eventId: e.id,
          createdAt: e.created_at,
        }))
        .filter(m => m.status !== 'inactive');

      // Dedup offers: latest per address (31516:author:d)
      const offerByAddress = new Map<string, Event>();
      for (const e of offerEvents) {
        const d = tagVal(e, 'd');
        if (!d) continue;
        const address = `${PLAN15_OFFER_KIND}:${e.pubkey}:${d}`;
        const prev = offerByAddress.get(address);
        if (!prev || e.created_at > prev.created_at) offerByAddress.set(address, e);
      }
      const parsedOffers: Plan15Offer[] = Array.from(offerByAddress.entries()).map(([address, e]) => ({
        id: e.id,
        d: tagVal(e, 'd'),
        address,
        seller: e.pubkey,
        wallet: tagVal(e, 'wallet'),
        amount: parseInt(tagVal(e, 'amount') || '0') || 0,
        currency: tagVal(e, 'currency') || 'EUR',
        status: tagVal(e, 'status') || 'active',
        validUntil: tagVal(e, 'valid_until'),
        createdAt: e.created_at,
      }));

      // 2) Acceptances (91515) + Payouts (91516) referencing our offers, by #a
      const offerAddresses = parsedOffers.map(o => o.address);
      let acceptEvents: Event[] = [];
      let payoutEvents: Event[] = [];
      if (offerAddresses.length > 0) {
        [acceptEvents, payoutEvents] = await Promise.all([
          withTimeout(pool.querySync(relays, { kinds: [PLAN15_ACCEPTANCE_KIND], '#a': offerAddresses }), 10000, 'acceptances') as Promise<Event[]>,
          withTimeout(pool.querySync(relays, { kinds: [PLAN15_PAYOUT_KIND], '#a': offerAddresses }), 10000, 'payouts') as Promise<Event[]>,
        ]);
      }

      const parsedAcceptances: Plan15Acceptance[] = acceptEvents.map(e => ({
        id: e.id,
        offerAddress: tagVal(e, 'a'),
        offerEventId: tagVal(e, 'e'),
        seller: tagVal(e, 'p'),
        buyer: e.pubkey,
        buyerWallet: tagVal(e, 'wallet'),
        amount: parseInt(tagVal(e, 'amount') || '0') || 0,
        amountFiat: tagVal(e, 'amount_fiat'),
        currency: tagVal(e, 'currency') || 'EUR',
        paymentAmount: parseInt(tagVal(e, 'payment_amount') || '0') || 0,
        paymentFrom: tagVal(e, 'payment_from'),
        paymentTo: tagVal(e, 'payment_to'),
        paymentTxid: tagVal(e, 'payment_txid'),
        status: tagVal(e, 'status') || 'paid',
        createdAt: e.created_at,
      }));

      const parsedPayouts: Plan15Payout[] = payoutEvents.map(e => {
        const eTags = e.tags.filter(t => t[0] === 'e');
        const offerRef = eTags.find(t => t[3] === 'offer')?.[1] || eTags[0]?.[1] || '';
        const acceptRef = eTags.find(t => t[3] === 'accept')?.[1] || eTags[1]?.[1] || '';
        return {
          id: e.id,
          offerAddress: tagVal(e, 'a'),
          offerEventId: offerRef,
          acceptanceEventId: acceptRef,
          buyer: tagVal(e, 'p'),
          fromWallet: tagVal(e, 'from_wallet'),
          toWallet: tagVal(e, 'to_wallet'),
          amount: parseInt(tagVal(e, 'amount') || '0') || 0,
          amountFiat: tagVal(e, 'amount_fiat'),
          txid: tagVal(e, 'txid'),
          status: tagVal(e, 'status') || 'confirmed',
          confirmedAt: tagVal(e, 'confirmed_at'),
          createdAt: e.created_at,
        };
      });

      parsedOffers.sort((a, b) => b.createdAt - a.createdAt);
      parsedAcceptances.sort((a, b) => b.createdAt - a.createdAt);
      parsedPayouts.sort((a, b) => b.createdAt - a.createdAt);

      setMembers(parsedMembers);
      setOffers(parsedOffers);
      setAcceptances(parsedAcceptances);
      setPayouts(parsedPayouts);
    } catch (error) {
      console.error('Error fetching PLAN15 data:', error);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [relays.join(',')]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fetch on-chain balances of member wallets (LANA)
  const fetchBalances = useCallback(async (wallets: string[]) => {
    const uniq = Array.from(new Set(wallets.filter(Boolean)));
    if (uniq.length === 0 || !parameters?.electrumServers?.length) return;
    try {
      const { data, error } = await supabase.functions.invoke('get-wallet-balances', {
        body: { wallet_addresses: uniq, electrum_servers: parameters.electrumServers },
      });
      if (error) { console.error('PLAN15 balance error:', error); return; }
      const next: Record<string, number> = {};
      (data?.wallets || []).forEach((b: any) => {
        next[b.wallet_id] = b.confirmed_balance ?? b.balance ?? 0;
      });
      setBalances(prev => ({ ...prev, ...next }));
    } catch (e) {
      console.error('PLAN15 balance error:', e);
    }
  }, [parameters?.electrumServers]);

  useEffect(() => {
    if (members.length > 0) {
      // Include BOTH the PLAN15 (buyout) wallet and the staker wallet in balance lookups.
      const wallets = members.flatMap(m => [m.wallet, m.stakerWallet]).filter(Boolean);
      fetchBalances(wallets);
    }
  }, [members, fetchBalances]);

  // ---- Derived helpers ----
  // Offer remaining (Lanoshis) = amount - sum(confirmed payouts for this offer address)
  const getOfferRemaining = useCallback((offer: Plan15Offer): number => {
    const paidOut = payouts
      .filter(p => p.offerAddress === offer.address && p.status === 'confirmed')
      .reduce((sum, p) => sum + p.amount, 0);
    return Math.max(0, offer.amount - paidOut);
  }, [payouts]);

  const getPayoutForAcceptance = useCallback((acceptanceId: string): Plan15Payout | undefined => {
    return payouts.find(p => p.acceptanceEventId === acceptanceId);
  }, [payouts]);

  // Member holdings (LANA) and sellable (LANA) above the floor
  const getHoldingsLana = useCallback((wallet: string): number => balances[wallet] ?? 0, [balances]);
  const getSellableLana = useCallback((wallet: string): number =>
    Math.max(0, (balances[wallet] ?? 0) - plan15Floor), [balances, plan15Floor]);

  // Combined holdings = PLAN15 (buyout) wallet + staker wallet; the floor applies to the TOTAL.
  const getMemberHoldings = useCallback((member: Plan15Member): number => {
    const main = balances[member.wallet] ?? 0;
    const staker = member.stakerWallet ? (balances[member.stakerWallet] ?? 0) : 0;
    return main + staker;
  }, [balances]);
  const getMemberSellable = useCallback((member: Plan15Member): number =>
    Math.max(0, getMemberHoldings(member) - plan15Floor), [getMemberHoldings, plan15Floor]);

  const priceFor = useCallback((currency: string): number => plan15Price[currency] || plan15Price['EUR'] || 0, [plan15Price]);
  const fxFor = useCallback((currency: string): number => (exchangeRates as Record<string, number>)[currency] || (exchangeRates as Record<string, number>)['EUR'] || 0, [exchangeRates]);

  // Registered LANA the buyer must pay (Lanoshis) for `unregLanoshis` unregistered LANA:
  //   € value = unregLANA × plan15_price ; registered LANA = € value / fx
  const getRegisteredPayLanoshis = useCallback((unregLanoshis: number, currency: string): number => {
    const price = priceFor(currency);
    const fx = fxFor(currency);
    if (!fx || !price) return 0;
    const unregLana = unregLanoshis / LANOSHIS_PER_LANA;
    const registeredLana = (unregLana * price) / fx;
    return Math.round(registeredLana * LANOSHIS_PER_LANA);
  }, [priceFor, fxFor]);

  const myMembership = members.find(m => m.pubkey === me) || null;
  const myOffers = offers.filter(o => o.seller === me);
  const myPurchases = acceptances.filter(a => a.buyer === me);
  // Incoming acceptances on my offers that are not yet paid out
  const incomingAcceptances = acceptances.filter(a =>
    myOffers.some(o => o.address === a.offerAddress) && !getPayoutForAcceptance(a.id)
  );

  // ---- Publishing ----
  const publish = useCallback(async (kind: number, content: string, tags: string[][]) => {
    if (!session?.nostrPrivateKey) throw new Error('Not logged in');
    if (relays.length === 0) throw new Error('No relays available');
    const signed = signNostrEvent(session.nostrPrivateKey, kind, content, tags);
    const pool = new SimplePool();
    try {
      const promises = pool.publish(relays, signed as any);
      await Promise.allSettled(
        promises.map(p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('publish timeout')), 8000))]).catch(() => {}))
      );
    } finally {
      pool.close(relays);
    }
    return signed;
  }, [session?.nostrPrivateKey, relays.join(',')]);

  const publishMembership = useCallback(async (opts: {
    plan15Wallet: string; isStaker: boolean; stakerWallet?: string; paymentWallet?: string; status?: string;
  }) => {
    if (!me) throw new Error('Not logged in');
    const tags: string[][] = [
      ['d', me],
      ['p', me],
      ['status', opts.status || 'active'],
      ['plan15_wallet', opts.plan15Wallet],
      ['is_staker', opts.isStaker ? 'yes' : 'no'],
      ['joined_at', String(Math.floor(Date.now() / 1000))],
    ];
    if (opts.isStaker && opts.stakerWallet) tags.push(['staker_wallet', opts.stakerWallet]);
    if (opts.paymentWallet) tags.push(['payment_wallet', opts.paymentWallet]);
    const ev = await publish(PLAN15_MEMBERSHIP_KIND, 'Joined PLAN15.', tags);
    await fetchAll();
    return ev;
  }, [me, publish, fetchAll]);

  const publishOffer = useCallback(async (opts: {
    d?: string; wallet: string; amountLanoshis: number; currency?: string; status?: string; validUntil?: string;
  }) => {
    const d = opts.d || (globalThis.crypto?.randomUUID?.() || `${me}-${Math.floor(Date.now() / 1000)}`);
    const currency = opts.currency || 'EUR';
    const tags: string[][] = [
      ['d', d],
      ['p', me],
      ['wallet', opts.wallet],
      ['amount', String(Math.round(opts.amountLanoshis))],
      ['currency', currency],
      ['status', opts.status || 'active'],
    ];
    if (opts.validUntil) tags.push(['valid_until', opts.validUntil]);
    const price = priceFor(currency);
    if (price) tags.push(['price_ref', String(price)]);
    const ev = await publish(PLAN15_OFFER_KIND, '', tags);
    await fetchAll();
    return ev;
  }, [me, publish, fetchAll, priceFor]);

  const publishAcceptance = useCallback(async (opts: {
    offer: Plan15Offer; buyerWallet: string; amountLanoshis: number;
    paymentFrom: string; paymentTo: string; paymentAmountLanoshis: number; paymentTxid: string;
  }) => {
    const currency = opts.offer.currency || 'EUR';
    const amountLana = opts.amountLanoshis / LANOSHIS_PER_LANA;
    const amountFiat = (amountLana * priceFor(currency)).toFixed(2);
    const tags: string[][] = [
      ['a', opts.offer.address],
      ['e', opts.offer.id],
      ['p', opts.offer.seller],
      ['wallet', opts.buyerWallet],
      ['amount', String(Math.round(opts.amountLanoshis))],
      ['currency', currency],
      ['amount_fiat', amountFiat],
      ['payment_amount', String(Math.round(opts.paymentAmountLanoshis))],
      ['payment_from', opts.paymentFrom],
      ['payment_to', opts.paymentTo],
      ['payment_txid', opts.paymentTxid],
      ['status', 'paid'],
    ];
    const ev = await publish(PLAN15_ACCEPTANCE_KIND, `Buying ${amountLana} unregistered LANA; paid registered LANA on-chain.`, tags);
    await fetchAll();
    return ev;
  }, [publish, fetchAll, priceFor]);

  const publishPayout = useCallback(async (opts: {
    acceptance: Plan15Acceptance; fromWallet: string; txid: string; status?: string;
  }) => {
    const { acceptance } = opts;
    const tags: string[][] = [
      ['a', acceptance.offerAddress],
      ['e', acceptance.offerEventId, '', 'offer'],
      ['e', acceptance.id, '', 'accept'],
      ['p', acceptance.buyer],
      ['from_wallet', opts.fromWallet],
      ['to_wallet', acceptance.buyerWallet],
      ['amount', String(acceptance.amount)],
      ['amount_fiat', acceptance.amountFiat],
      ['txid', opts.txid],
      ['status', opts.status || 'confirmed'],
      ['confirmed_at', new Date().toISOString()],
    ];
    if (acceptance.paymentTxid) tags.push(['payment_txid', acceptance.paymentTxid]);
    const ev = await publish(PLAN15_PAYOUT_KIND, 'PLAN15 unregistered-LANA delivery after verifying the registered payment.', tags);
    await fetchAll();
    return ev;
  }, [publish, fetchAll]);

  return {
    // data
    members, offers, acceptances, payouts, balances,
    isLoading,
    // params
    plan15Floor, plan15Price, priceFor, fxFor, getRegisteredPayLanoshis,
    // derived
    getOfferRemaining, getPayoutForAcceptance, getHoldingsLana, getSellableLana, getMemberHoldings, getMemberSellable,
    myMembership, myOffers, myPurchases, incomingAcceptances,
    // actions
    publishMembership, publishOffer, publishAcceptance, publishPayout,
    refetch: fetchAll, refetchBalances: fetchBalances,
  };
};
