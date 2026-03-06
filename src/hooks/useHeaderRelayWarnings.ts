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
 * Single hook that batches ALL relay-based header warning checks
 * into ONE SimplePool connection, avoiding multiple simultaneous
 * WebSocket connections that fail silently.
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
      const pool = new SimplePool();

      try {
        console.log('[HeaderWarnings] Checking all relay warnings with single pool...');

        // --- Run ALL relay queries through the SAME pool in parallel ---
        // NOTE: #p filter does NOT work on some relays for parametrized
        // replaceable events (KIND 30000-39999). KIND 37044 falls in this
        // range so we must fetch ALL events and filter client-side.
        const results = await Promise.allSettled([
          // 1. OWN: KIND 37044 — fetch ALL, filter client-side (relays don't support #p for this kind)
          Promise.race([
            pool.querySync(relays, { kinds: [37044], limit: 100 }),
            timeout<Event>(12000),
          ]),
          // 2. SELL: KIND 91991 authored by user
          Promise.race([
            pool.querySync(relays, { kinds: [91991], authors: [pubkey] }),
            timeout<Event>(12000),
          ]),
          // 3. SELL confirmations: KIND 91993 (to filter out completed)
          Promise.race([
            pool.querySync(relays, { kinds: [91993], authors: [pubkey] }),
            timeout<Event>(12000),
          ]),
          // 4. Lana8Wonder: KIND 88888 — fetch ALL, filter client-side
          Promise.race([
            pool.querySync(relays, { kinds: [88888], limit: 50 }),
            timeout<Event>(12000),
          ]),
        ]);

        if (cancelled) return;

        const ownEvents = results[0].status === 'fulfilled' ? results[0].value : [];
        const sellEvents = results[1].status === 'fulfilled' ? results[1].value : [];
        const confirmEvents = results[2].status === 'fulfilled' ? results[2].value : [];
        const cashOutEvents = results[3].status === 'fulfilled' ? results[3].value : [];

        // Log results
        console.log('[HeaderWarnings] Results:', {
          own: ownEvents.length,
          sell: sellEvents.length,
          confirms: confirmEvents.length,
          cashOut: cashOutEvents.length,
          pubkey: pubkey.slice(0, 16) + '...',
        });

        // --- Process OWN: check for open processes where user has a role ---
        // Filter client-side since relays don't support #p for KIND 37044
        const ownActive = ownEvents.some((event: Event) => {
          const status = event.tags.find(t => t[0] === 'status')?.[1];
          if (status !== 'open') return false;
          // Check if user is in any p-tag with a role
          const hasRole = event.tags.some(
            t =>
              t[0] === 'p' &&
              t[1] === pubkey &&
              (t[2] === 'initiator' || t[3] === 'initiator' ||
               t[2] === 'facilitator' || t[3] === 'facilitator' ||
               t[2] === 'participant' || t[3] === 'participant' ||
               t[2] === 'guest' || t[3] === 'guest')
          );
          if (hasRole) {
            console.log('[HeaderWarnings] OWN match found:', {
              eventId: event.id.slice(0, 16),
              status,
              title: event.tags.find(t => t[0] === 'title')?.[1],
            });
          }
          return hasRole;
        });

        // --- Process SELL: active offers minus confirmed ---
        const confirmedSellIds = new Set<string>();
        confirmEvents.forEach((event: Event) => {
          const sellTag = event.tags.find(t => t[0] === 'sell')?.[1];
          if (sellTag) confirmedSellIds.add(sellTag);
          event.tags.forEach(tag => {
            if (tag[0] === 'e' && tag[3] === 'sell') confirmedSellIds.add(tag[1]);
          });
        });
        const sellCount = sellEvents.filter(
          (e: Event) => !confirmedSellIds.has(e.id)
        ).length;

        // --- Process Lana8Wonder cash-out ---
        // Filter client-side for events tagged with our pubkey
        let cashOutCount = 0;
        const userCashOutEvents = cashOutEvents.filter((event: Event) =>
          event.tags.some(t => t[0] === 'p' && t[1] === pubkey)
        );
        if (userCashOutEvents.length > 0) {
          const currentPrice = parameters.exchangeRates?.EUR || 0;
          if (currentPrice > 0) {
            try {
              const latestEvent = userCashOutEvents.sort(
                (a: Event, b: Event) => b.created_at - a.created_at
              )[0];
              const plan = JSON.parse(latestEvent.content);

              if (plan.accounts && plan.accounts.length > 0) {
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

                if (balanceRes.ok) {
                  const balanceData = await balanceRes.json();
                  const balances: Record<string, number> = {};
                  if (balanceData?.wallets) {
                    balanceData.wallets.forEach((w: any) => {
                      balances[w.wallet_id] = w.balance;
                    });
                  }

                  for (const account of plan.accounts) {
                    const balance = balances[account.wallet];
                    if (balance === undefined) continue;
                    const triggeredLevels = account.levels
                      .filter((l: any) => currentPrice >= l.trigger_price)
                      .sort((a: any, b: any) => b.level_no - a.level_no);
                    const lastTriggered = triggeredLevels[0];
                    if (!lastTriggered) continue;
                    if (balance > (lastTriggered.remaining_lanas || 0) * 1.02) {
                      cashOutCount++;
                    }
                  }
                }
              }
            } catch (err) {
              console.error('[HeaderWarnings] Cash-out parse error:', err);
            }
          }
        }

        if (!cancelled) {
          console.log('[HeaderWarnings] Setting warnings:', { ownActive, sellCount, cashOutCount });
          setWarnings({ ownActive, sellCount, cashOutCount });
        }
      } catch (error) {
        console.error('[HeaderWarnings] Error:', error);
      } finally {
        if (!cancelled) setLoading(false);
        pool.close(relays);
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
