import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DIRECT_FUND_PUBKEY = '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';

export interface InvestorPayment {
  id: string;
  fundRef: string;
  amount: number;
  currency: string;
  status: string;
  confirmed: boolean;
  confirmedAt: string;
  overdueDays: number;
  orderType: string;
  paymentType: string;
  destinationName: string;
  destinationType: string;
  batchRef: string;
  receiptUrl: string;
  receiptType: string;
  lanaTxHash: string;
  rpcVerified: boolean;
  createdAt: string;
  eventCreatedAt: number;
}

function getTag(tags: string[][], key: string): string {
  return tags.find(t => t[0] === key)?.[1] || '';
}

export const useNostrInvestorPayments = (hexId: string | null | undefined) => {
  const { parameters } = useSystemParameters();
  const [payments, setPayments] = useState<InvestorPayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (!hexId || relays.length === 0) {
      setPayments([]);
      return;
    }

    let cancelled = false;
    const fetchPayments = async () => {
      setIsLoading(true);
      const pool = new SimplePool();

      try {
        // Relay doesn't index custom tags — fetch all from author, filter client-side
        const allEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [30939],
            authors: [DIRECT_FUND_PUBKEY],
          }),
          new Promise<never[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
        ]);
        const events = allEvents.filter(e =>
          e.tags.some(t => t[0] === 'investor_hex' && t[1] === hexId)
        );

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

        const parsed: InvestorPayment[] = Array.from(latest.values()).map(e => ({
          id: getTag(e.tags, 'd'),
          fundRef: getTag(e.tags, 'fund_ref'),
          amount: parseFloat(getTag(e.tags, 'amount')) || 0,
          currency: getTag(e.tags, 'currency') || 'EUR',
          status: getTag(e.tags, 'status') || 'pending',
          confirmed: getTag(e.tags, 'confirmed') === '1',
          confirmedAt: getTag(e.tags, 'confirmed_at'),
          overdueDays: parseFloat(getTag(e.tags, 'overdue_days')) || 0,
          orderType: getTag(e.tags, 'order_type'),
          paymentType: getTag(e.tags, 'payment_type'),
          destinationName: getTag(e.tags, 'destination_name'),
          destinationType: getTag(e.tags, 'destination_type'),
          batchRef: getTag(e.tags, 'batch_ref'),
          receiptUrl: getTag(e.tags, 'receipt_url'),
          receiptType: getTag(e.tags, 'receipt_type') || 'receipt',
          lanaTxHash: getTag(e.tags, 'lana_tx_hash'),
          rpcVerified: getTag(e.tags, 'rpc_verified') === '1',
          createdAt: getTag(e.tags, 'created_at'),
          eventCreatedAt: e.created_at,
        }));

        setPayments(parsed.sort((a, b) => b.eventCreatedAt - a.eventCreatedAt));
      } catch (err) {
        console.error('Failed to fetch investor payments:', err);
        if (!cancelled) setPayments([]);
      } finally {
        if (!cancelled) setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchPayments();
    return () => { cancelled = true; };
  }, [hexId, relays.length]);

  const pendingPayments = payments.filter(p => !p.confirmed);
  const confirmedPayments = payments.filter(p => p.confirmed);

  return { payments, pendingPayments, confirmedPayments, isLoading };
};
