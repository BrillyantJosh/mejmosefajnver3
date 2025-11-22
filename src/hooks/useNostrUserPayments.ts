import { useEffect, useState } from 'react';
import { SimplePool, Filter, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

interface UseNostrUserPaymentsResult {
  paidProcessIds: Set<string>;
  isLoading: boolean;
}

export const useNostrUserPayments = (): UseNostrUserPaymentsResult => {
  const [paidProcessIds, setPaidProcessIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchPayments = async () => {
      if (!session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        console.log('💳 Skipping payment check: missing user or relays');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        const filter: Filter = {
          kinds: [90900],
          '#p': [session.nostrHexId],
          limit: 1000,
        };

        console.log('💳 Fetching KIND 90900 payment proposals for user:', {
          user: session.nostrHexId,
          relays,
          filter,
        });

        const events = await pool.querySync(relays, filter);
        console.log(`💳 Found ${events.length} KIND 90900 events for user as #p`);

        const ids = new Set<string>();

        (events as NostrEvent[]).forEach((event) => {
          // 1) User must be explicitly marked as "payer"
          const payerTag = event.tags.find(
            (tag) =>
              tag[0] === 'p' &&
              tag[1] === session.nostrHexId &&
              tag[2] === 'payer'
          );
          if (!payerTag) return;

          // 2) Find e-tag with marker '87044' (3- or 4-element format)
          const processTag = event.tags.find((tag) => {
            if (tag[0] !== 'e') return false;
            // Support both ["e", id, "87044"] and ["e", id, "", "87044"]
            const marker = tag[3] ?? tag[2];
            return marker === '87044';
          });

          if (processTag && processTag[1]) {
            console.log('💳 Matched payment proposal for process:', {
              eventId: event.id,
              processId: processTag[1],
              payerPubkey: session.nostrHexId,
            });
            ids.add(processTag[1]);
          }
        });

        console.log('✅ Final paid process IDs:', Array.from(ids));
        setPaidProcessIds(ids);
      } catch (error) {
        console.error('❌ Error fetching user payments (KIND 90900):', error);
        setPaidProcessIds(new Set());
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchPayments();
  }, [session?.nostrHexId, parameters?.relays]);

  return { paidProcessIds, isLoading };
};
