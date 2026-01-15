import { useState, useEffect, useRef } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { arraysEqual } from '@/lib/arrayComparison';

export interface DonationPayment {
  id: string;
  proposalDTag: string;
  recipientPubkey: string;
  fromWallet: string;
  toWallet: string;
  amountLana: string;
  amountLanoshi: string;
  fiatCurrency: string;
  fiatAmount: string;
  txId: string;
  service: string;
  timestampPaid: number;
  proposalEventId: string;
  type: string;
  content: string;
  createdAt: number;
}

export interface UseNostrDonationPaymentsOptions {
  poll?: boolean;
  pollIntervalMs?: number;
}

export const useNostrDonationPayments = (
  options: UseNostrDonationPaymentsOptions = {}
) => {
  const { poll = true, pollIntervalMs = 5000 } = options;
  const { parameters } = useSystemParameters();
  const [payments, setPayments] = useState<DonationPayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const relays = parameters?.relays || [];

  useEffect(() => {
    const fetchPayments = async () => {
      if (relays.length === 0) {
        // Only clear if we haven't loaded yet
        if (!hasLoadedOnceRef.current) {
          setPayments([]);
          setIsLoading(false);
        }
        return;
      }

      // Loading indicator only for initial load
      if (!hasLoadedOnceRef.current) {
        setIsLoading(true);
      }
      const pool = new SimplePool();

      try {
        console.log('📥 Fetching KIND 90901 donation payments...');

        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [90901],
            limit: 100
          }),
          new Promise<Event[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]) as Event[];

        if (events && events.length > 0) {
          console.log(`✅ Found ${events.length} donation payments`);

          const parsedPayments: DonationPayment[] = events.map(event => {
            const proposalTag = event.tags.find(t => t[0] === 'proposal')?.[1] || '';
            const pTag = event.tags.find(t => t[0] === 'p')?.[1] || '';
            const fromWalletTag = event.tags.find(t => t[0] === 'from_wallet')?.[1] || '';
            const toWalletTag = event.tags.find(t => t[0] === 'to_wallet')?.[1] || '';
            const amountLanaTag = event.tags.find(t => t[0] === 'amount_lana')?.[1] || '';
            const amountLanoshiTag = event.tags.find(t => t[0] === 'amount_lanoshi')?.[1] || '';
            const fiatTag = event.tags.find(t => t[0] === 'fiat');
            const txTag = event.tags.find(t => t[0] === 'tx')?.[1] || '';
            const serviceTag = event.tags.find(t => t[0] === 'service')?.[1] || '';
            const timestampPaidTag = event.tags.find(t => t[0] === 'timestamp_paid')?.[1];
            const eTag = event.tags.find(t => t[0] === 'e' && t[3] === 'proposal')?.[1] || '';
            const typeTag = event.tags.find(t => t[0] === 'type')?.[1] || '';

            return {
              id: event.id,
              proposalDTag: proposalTag,
              recipientPubkey: pTag,
              fromWallet: fromWalletTag,
              toWallet: toWalletTag,
              amountLana: amountLanaTag,
              amountLanoshi: amountLanoshiTag,
              fiatCurrency: fiatTag?.[1] || '',
              fiatAmount: fiatTag?.[2] || '',
              txId: txTag,
              service: serviceTag,
              timestampPaid: timestampPaidTag ? parseInt(timestampPaidTag) : event.created_at,
              proposalEventId: eTag,
              type: typeTag,
              content: event.content,
              createdAt: event.created_at
            };
          });

          // Only update state if data actually changed (use functional setter to avoid stale closure)
          setPayments(prev => arraysEqual(parsedPayments, prev) ? prev : parsedPayments);
        } else {
          // Only clear if this is the initial load
          if (!hasLoadedOnceRef.current) {
            setPayments([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching donation payments:', error);
        // DO NOT clear payments after first successful load - keep last known good state
        if (!hasLoadedOnceRef.current) {
          setPayments([]);
        }
      } finally {
        if (!hasLoadedOnceRef.current) {
          setIsLoading(false);
          hasLoadedOnceRef.current = true;
        }
        pool.close(relays);
      }
    };

    fetchPayments();

    // Only set up polling if poll option is true
    if (poll) {
      const interval = setInterval(fetchPayments, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [relays.join(','), poll, pollIntervalMs]);

  return {
    payments,
    isLoading
  };
};
