import { useState, useEffect } from 'react';
import { Event as NostrEvent } from 'nostr-tools';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { RevenueShareEvent, RevenueShareData } from './useNostrRevenueShare';

export const useNostrRevenueSharesBatch = (processRecordIds: string[]) => {
  const [revenueShares, setRevenueShares] = useState<Record<string, RevenueShareEvent>>({});
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchRevenueShares = async () => {
      if (processRecordIds.length === 0 || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;

      try {
        // Fetch all revenue share configurations for the given process record IDs
        // Through this app's server — see src/lib/relayReadViaServer.ts.
        const revenueEvents = await queryEventsViaServer<NostrEvent>({
          kinds: [87945],
          '#e': processRecordIds,
          limit: 500
        }, { label: 'revenue shares in bulk (KIND 87945)' });

        const sharesMap: Record<string, RevenueShareEvent> = {};

        revenueEvents.forEach((event: NostrEvent) => {
          try {
            const processTag = event.tags.find((tag) => tag[0] === 'e' && tag[2] === 'process');
            if (!processTag || !processTag[1]) return;

            const processRecordId = processTag[1];
            const transcriptTag = event.tags.find((tag) => tag[0] === 'e' && tag[2] === 'transcript');
            const currencyTag = event.tags.find((tag) => tag[0] === 'currency');
            const amountTag = event.tags.find((tag) => tag[0] === 'amount');
            const visibilityTag = event.tags.find((tag) => tag[0] === 'visibility');

            const data: RevenueShareData = JSON.parse(event.content);

            const share: RevenueShareEvent = {
              id: event.id,
              processRecordId,
              transcriptEventId: transcriptTag?.[1],
              currency: currencyTag?.[1] || data.currency || 'EUR',
              amount: amountTag?.[1] || data.donation_amount.toString(),
              visibility: visibilityTag?.[1] || 'public',
              data,
              createdAt: event.created_at,
            };

            // Keep only the most recent revenue share for each process
            if (!sharesMap[processRecordId] || sharesMap[processRecordId].createdAt < share.createdAt) {
              sharesMap[processRecordId] = share;
            }
          } catch (error) {
            console.error('Error parsing revenue share event:', error);
          }
        });
        
        setRevenueShares(sharesMap);
      } catch (error) {
        console.error('Error fetching revenue shares batch:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRevenueShares();
  }, [JSON.stringify(processRecordIds), parameters]);

  return { revenueShares, isLoading };
};
