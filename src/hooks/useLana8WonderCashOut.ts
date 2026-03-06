import { useState, useEffect, useRef } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface AnnuityLevel {
  row_id: string;
  level_no: number;
  trigger_price: number;
  coins_to_give: number;
  cash_out: number;
  remaining_lanas: number;
}

interface AnnuityAccount {
  account_id: number;
  wallet: string;
  levels: AnnuityLevel[];
}

interface AnnuityPlan {
  subject_hex: string;
  plan_id: string;
  coin: string;
  currency: string;
  policy: string;
  accounts: AnnuityAccount[];
}

/**
 * Lightweight hook that detects pending Lana8Wonder cash-outs.
 * Used in the header to show a warning badge.
 * Fetches KIND 88888 plan + wallet balances and checks if any account needs cash-out.
 */
export function useLana8WonderCashOut() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const checkCashOut = async () => {
      if (!session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        setPendingCount(0);
        return;
      }

      const relays = parameters.relays;
      const currentPrice = parameters.exchangeRates?.EUR || 0;
      if (currentPrice <= 0) return;

      setLoading(true);
      const pool = new SimplePool();

      try {
        // 1. Fetch KIND 88888 annuity plan
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [88888],
            '#p': [session.nostrHexId],
          }),
          new Promise<never[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]);

        if (!events || events.length === 0) {
          setPendingCount(0);
          return;
        }

        // Get the latest event
        const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
        const plan: AnnuityPlan = JSON.parse(latestEvent.content);

        if (!plan.accounts || plan.accounts.length === 0) {
          setPendingCount(0);
          return;
        }

        // 2. Fetch wallet balances
        const walletAddresses = plan.accounts.map(acc => acc.wallet);
        const balanceRes = await fetch(`${API_URL}/api/functions/get-wallet-balances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_addresses: walletAddresses,
            electrum_servers: parameters.electrumServers,
          }),
        });

        if (!balanceRes.ok) {
          setPendingCount(0);
          return;
        }

        const balanceData = await balanceRes.json();
        const balances: Record<string, number> = {};
        if (balanceData?.wallets) {
          balanceData.wallets.forEach((w: any) => {
            balances[w.wallet_id] = w.balance;
          });
        }

        // 3. Calculate pending cash-outs
        let count = 0;
        for (const account of plan.accounts) {
          const balance = balances[account.wallet];
          if (balance === undefined) continue;

          // Find last triggered level (highest level where currentPrice >= trigger_price)
          const triggeredLevels = account.levels
            .filter(l => currentPrice >= l.trigger_price)
            .sort((a, b) => b.level_no - a.level_no);

          const lastTriggeredLevel = triggeredLevels[0];
          if (!lastTriggeredLevel) continue;

          const expectedRemaining = lastTriggeredLevel.remaining_lanas || 0;

          // Same formula as Lana8Wonder.tsx line 304
          if (balance > expectedRemaining * 1.02) {
            count++;
          }
        }

        setPendingCount(count);
      } catch (error) {
        console.error('❌ useLana8WonderCashOut: Error checking cash-out status:', error);
      } finally {
        setLoading(false);
        pool.close(relays);
      }
    };

    checkCashOut();

    // Poll every 5 minutes
    intervalRef.current = setInterval(checkCashOut, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [session?.nostrHexId, parameters?.relays, parameters?.exchangeRates?.EUR, parameters?.electrumServers]);

  return { pendingCount, loading };
}
