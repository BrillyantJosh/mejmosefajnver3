import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
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
      const pool = new SimplePool();

      try {
        console.log('🔍 [Revenue Shares] Searching for process IDs:', processRecordIds);
        
        // Fetch all revenue share configurations for the given process record IDs
        const revenueEvents = await pool.querySync(relays, {
          kinds: [87945],
          '#e': processRecordIds,
          limit: 500
        });

        console.log('📥 [Revenue Shares] Fetched events:', revenueEvents.length);
        console.log('📥 [Revenue Shares] Events:', revenueEvents);

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
              console.log('✅ [Revenue Shares] Added share for process:', processRecordId);
            }
          } catch (error) {
            console.error('❌ [Revenue Shares] Error parsing revenue share event:', error);
          }
        });

        console.log('🗺️ [Revenue Shares] Final sharesMap keys:', Object.keys(sharesMap));
        console.log('🗺️ [Revenue Shares] Final sharesMap:', sharesMap);
        
        setRevenueShares(sharesMap);
      } catch (error) {
        console.error('Error fetching revenue shares batch:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchRevenueShares();
  }, [JSON.stringify(processRecordIds), parameters]);

  return { revenueShares, isLoading };
};
