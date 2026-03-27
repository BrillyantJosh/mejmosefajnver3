import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DIRECT_FUND_PUBKEY = '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';

export interface InvestorBudget {
  id: string;
  walletId: string;
  investmentAmount: number;
  investmentCurrency: string;
  investedAmount: number;
  availableAmount: number;
  note: string;
  status: string;
  createdAt: number;
}

function getTag(tags: string[][], key: string): string {
  return tags.find(t => t[0] === key)?.[1] || '';
}

export const useNostrInvestorBudgets = (hexId: string | null | undefined) => {
  const { parameters } = useSystemParameters();
  const [budgets, setBudgets] = useState<InvestorBudget[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (!hexId || relays.length === 0) {
      setBudgets([]);
      return;
    }

    let cancelled = false;
    const fetchBudgets = async () => {
      setIsLoading(true);
      const pool = new SimplePool();

      try {
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [30938],
            authors: [DIRECT_FUND_PUBKEY],
            '#investor_hex': [hexId],
          }),
          new Promise<never[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
        ]);

        if (cancelled) return;

        // NIP-33: keep only latest per d-tag
        const latest = new Map<string, typeof events[0]>();
        for (const e of events) {
          const d = getTag(e.tags, 'd');
          const existing = latest.get(d);
          if (!existing || e.created_at > existing.created_at) {
            latest.set(d, e);
          }
        }

        const parsed: InvestorBudget[] = Array.from(latest.values()).map(e => ({
          id: getTag(e.tags, 'd'),
          walletId: getTag(e.tags, 'wallet_id'),
          investmentAmount: parseFloat(getTag(e.tags, 'investment_amount')) || 0,
          investmentCurrency: getTag(e.tags, 'investment_currency') || 'EUR',
          investedAmount: parseFloat(getTag(e.tags, 'invested_amount')) || 0,
          availableAmount: parseFloat(getTag(e.tags, 'available_amount')) || 0,
          note: getTag(e.tags, 'note'),
          status: getTag(e.tags, 'status') || 'active',
          createdAt: e.created_at,
        }));

        setBudgets(parsed.sort((a, b) => b.createdAt - a.createdAt));
      } catch (err) {
        console.error('Failed to fetch investor budgets:', err);
        if (!cancelled) setBudgets([]);
      } finally {
        if (!cancelled) setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchBudgets();
    return () => { cancelled = true; };
  }, [hexId, relays.length]);

  return { budgets, isLoading };
};
