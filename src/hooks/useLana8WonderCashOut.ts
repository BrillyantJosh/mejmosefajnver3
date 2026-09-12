import { useState, useEffect, useRef } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { evaluateCashOut, type InFlightCashOut } from '@/lib/cashOutDue';

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
        const unconfirmed: Record<string, number> = {};
        if (balanceData?.wallets) {
          balanceData.wallets.forEach((w: any) => {
            balances[w.wallet_id] = w.balance;
            unconfirmed[w.wallet_id] = Number(w.unconfirmed_balance) || 0;
          });
        }

        // What has already been sent from these wallets. The badge counted
        // people who had cashed out minutes earlier, which is half of why they
        // pressed again. A failed read leaves this empty — the chain figures
        // above still stand on their own.
        const sent: Record<string, InFlightCashOut> = {};
        try {
          const sendsRes = await fetch(
            `${API_URL}/api/cashouts/recent?wallets=${encodeURIComponent(walletAddresses.join(','))}`
          );
          if (sendsRes.ok) {
            const sendsData = await sendsRes.json();
            for (const [walletId, row] of Object.entries<any>(sendsData?.sends || {})) {
              sent[walletId] = {
                walletId,
                amount: Number(row?.amountLana) || 0,
                txid: String(row?.txid || ''),
                sentAt: Number(row?.createdAt) || 0,
              };
            }
          }
        } catch (err) {
          console.warn('Could not read recent sends for the cash-out badge:', err);
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

          // The same rule the page uses, from the same file: what is already
          // on its way is subtracted before anything is counted as owed.
          const verdict = evaluateCashOut({
            balance,
            unconfirmedBalance: unconfirmed[account.wallet],
            expectedRemaining,
            inFlight: sent[account.wallet] || null,
            now: Date.now(),
          });
          if (verdict.state === 'due') {
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
