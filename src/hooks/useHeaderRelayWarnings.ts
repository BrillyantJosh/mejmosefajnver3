import { useState, useEffect, useRef } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface HeaderWarnings {
  ownActive: boolean;
  sellCount: number;
  cashOutCount: number;
}

const timeout = <T>(ms: number): Promise<T[]> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('Relay timeout')), ms));

/**
 * Single hook that checks ALL relay-based header warnings.
 * OWN uses a server endpoint (reliable), SELL + Lana8Wonder use a single SimplePool.
 */
export function useHeaderRelayWarnings() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [warnings, setWarnings] = useState<HeaderWarnings>({
    ownActive: false,
    sellCount: 0,
    cashOutCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const pubkey = session?.nostrHexId;
    const relays = parameters?.relays;

    if (!pubkey || !relays || relays.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const checkAll = async () => {
      // --- 1. OWN: use server endpoint (reliable, no browser WebSocket issues) ---
      const ownPromise = fetch(`${API_URL}/api/functions/check-own-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPubkey: pubkey }),
      })
        .then(r => r.json())
        .then(data => data?.hasActive === true)
        .catch(err => {
          console.error('[HeaderWarnings] OWN check error:', err);
          return false;
        });

      // --- 2+3. SELL: use SimplePool for KIND 91991 + 91993 ---
      const sellPromise = (async () => {
        const pool = new SimplePool();
        try {
          const [sellEvents, confirmEvents] = await Promise.all([
            Promise.race([
              pool.querySync(relays, { kinds: [91991], authors: [pubkey] }),
              timeout<Event>(12000),
            ]),
            Promise.race([
              pool.querySync(relays, { kinds: [91993], authors: [pubkey] }),
              timeout<Event>(12000),
            ]),
          ]);

          const confirmedSellIds = new Set<string>();
          confirmEvents.forEach((event: Event) => {
            const sellTag = event.tags.find(t => t[0] === 'sell')?.[1];
            if (sellTag) confirmedSellIds.add(sellTag);
            event.tags.forEach(tag => {
              if (tag[0] === 'e' && tag[3] === 'sell') confirmedSellIds.add(tag[1]);
            });
          });

          return sellEvents.filter((e: Event) => !confirmedSellIds.has(e.id)).length;
        } catch (err) {
          console.error('[HeaderWarnings] SELL check error:', err);
          return 0;
        } finally {
          pool.close(relays);
        }
      })();

      // --- 4. Lana8Wonder: use server endpoint for relay query too ---
      const cashOutPromise = (async () => {
        try {
          const currentPrice = parameters.exchangeRates?.EUR || 0;
          if (currentPrice <= 0) return 0;

          // Query KIND 88888 via server relay query
          const pool = new SimplePool();
          let cashOutEvents: Event[] = [];
          try {
            cashOutEvents = await Promise.race([
              pool.querySync(relays, { kinds: [88888], limit: 50 }),
              timeout<Event>(12000),
            ]);
          } finally {
            pool.close(relays);
          }

          const userEvents = cashOutEvents.filter((event: Event) =>
            event.tags.some(t => t[0] === 'p' && t[1] === pubkey)
          );

          if (userEvents.length === 0) return 0;

          const latestEvent = userEvents.sort(
            (a: Event, b: Event) => b.created_at - a.created_at
          )[0];
          const plan = JSON.parse(latestEvent.content);

          if (!plan.accounts || plan.accounts.length === 0) return 0;

          const walletAddresses = plan.accounts.map((acc: any) => acc.wallet);
          const balanceRes = await fetch(
            `${API_URL}/api/functions/get-wallet-balances`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                wallet_addresses: walletAddresses,
                electrum_servers: parameters.electrumServers,
              }),
            }
          );

          if (!balanceRes.ok) return 0;

          const balanceData = await balanceRes.json();
          const balances: Record<string, number> = {};
          if (balanceData?.wallets) {
            balanceData.wallets.forEach((w: any) => {
              balances[w.wallet_id] = w.balance;
            });
          }

          let count = 0;
          for (const account of plan.accounts) {
            const balance = balances[account.wallet];
            if (balance === undefined) continue;
            const triggeredLevels = account.levels
              .filter((l: any) => currentPrice >= l.trigger_price)
              .sort((a: any, b: any) => b.level_no - a.level_no);
            const lastTriggered = triggeredLevels[0];
            if (!lastTriggered) continue;
            if (balance > (lastTriggered.remaining_lanas || 0) * 1.02) {
              count++;
            }
          }
          return count;
        } catch (err) {
          console.error('[HeaderWarnings] Cash-out check error:', err);
          return 0;
        }
      })();

      // Run all checks in parallel
      const [ownActive, sellCount, cashOutCount] = await Promise.all([
        ownPromise,
        sellPromise,
        cashOutPromise,
      ]);

      if (!cancelled) {
        console.log('[HeaderWarnings] Results:', { ownActive, sellCount, cashOutCount });
        setWarnings({ ownActive, sellCount, cashOutCount });
        setLoading(false);
      }
    };

    checkAll();

    // Poll every 5 minutes
    intervalRef.current = setInterval(checkAll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session?.nostrHexId, parameters?.relays, parameters?.exchangeRates?.EUR, parameters?.electrumServers]);

  return { warnings, loading };
}
