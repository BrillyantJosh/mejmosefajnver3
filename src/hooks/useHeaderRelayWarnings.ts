import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface HeaderWarnings {
  ownActive: boolean;
  sellCount: number;
  cashOutCount: number;
}

/**
 * Single hook that checks ALL relay-based header warnings.
 * ALL relay queries run server-side via /check-header-warnings — NO SimplePool in browser.
 * This eliminates WebSocket connection issues that caused badges to fail.
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
      try {
        // Single server call — ALL relay queries happen server-side
        const res = await fetch(`${API_URL}/api/functions/check-header-warnings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userPubkey: pubkey }),
        });
        const data = await res.json();

        if (cancelled || !data?.success) return;

        const ownActive = data.ownActive || false;
        const sellCount = data.sellCount || 0;

        // --- Lana8Wonder cash-out: process server-fetched events client-side ---
        // (needs exchange rates + wallet balances which are available here)
        let cashOutCount = 0;
        try {
          const currentPrice = parameters.exchangeRates?.EUR || 0;
          const lana8Events = data.lana8WonderEvents || [];

          if (currentPrice > 0 && lana8Events.length > 0) {
            // Get latest event
            const latestEvent = lana8Events.sort(
              (a: any, b: any) => b.created_at - a.created_at
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
          }
        } catch (err) {
          console.error('[HeaderWarnings] Cash-out processing error:', err);
        }

        if (!cancelled) {
          console.log('[HeaderWarnings] Results:', { ownActive, sellCount, cashOutCount });
          setWarnings({ ownActive, sellCount, cashOutCount });
          setLoading(false);
        }
      } catch (err) {
        console.error('[HeaderWarnings] Server check error:', err);
        if (!cancelled) setLoading(false);
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
