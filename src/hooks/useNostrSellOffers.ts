import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface SellOffer {
  id: string;
  wallet: string;
  amount: string; // in Lanoshis
  currency: string;
  paymentMethods: string;
  validUntil: string;
  content: string;
  createdAt: number;
  status: 'active' | 'pending';
}

export const useNostrSellOffers = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [offers, setOffers] = useState<SellOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  const fetchOffers = useCallback(async () => {
    if (!session?.nostrHexId || relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    
    try {
      console.log('Fetching KIND 91991 sell offers for:', session.nostrHexId);
      
      // First, fetch sell offers (91991) from current user
      const sellEvents = await Promise.race([
        pool.querySync(relays, {
          kinds: [91991],
          authors: [session.nostrHexId],
        }),
        new Promise<Event[]>((_, reject) => 
          setTimeout(() => reject(new Error('Sell offers fetch timeout')), 10000)
        )
      ]) as Event[];
      
      // Get all sell offer IDs to fetch related events
      const sellOfferIds = sellEvents.map(e => e.id);
      console.log('Found', sellEvents.length, 'sell offers with IDs:', sellOfferIds);
      
      // Fetch buy requests (91992) and confirmations (91993) that reference our sell offers
      let buyEvents: Event[] = [];
      let confirmEvents: Event[] = [];
      
      if (sellOfferIds.length > 0) {
        [buyEvents, confirmEvents] = await Promise.all([
          Promise.race([
            pool.querySync(relays, {
              kinds: [91992],
              '#e': sellOfferIds,
            }),
            new Promise<Event[]>((_, reject) => 
              setTimeout(() => reject(new Error('Buy requests fetch timeout')), 10000)
            )
          ]),
          Promise.race([
            pool.querySync(relays, {
              kinds: [91993],
              '#e': sellOfferIds,
            }),
            new Promise<Event[]>((_, reject) => 
              setTimeout(() => reject(new Error('Confirmations fetch timeout')), 10000)
            )
          ])
        ]);
        
        console.log('Found', buyEvents.length, 'buy requests (KIND 91992)');
        console.log('Found', confirmEvents.length, 'confirmation events (KIND 91993)');
      }

      // Extract confirmed sell offer IDs from KIND 91993 events
      const confirmedSellIds = new Set<string>();
      if (confirmEvents && confirmEvents.length > 0) {
        confirmEvents.forEach(event => {
          console.log('Processing KIND 91993 event:', {
            id: event.id,
            tags: event.tags
          });
          
          // Check ["sell", "<id>"] tags
          const sellTag = event.tags.find(t => t[0] === 'sell')?.[1];
          if (sellTag) {
            console.log('Found sell tag:', sellTag);
            confirmedSellIds.add(sellTag);
          }
          
          // Also check ["e", "<id>", "", "sell"] tags
          event.tags.forEach(tag => {
            if (tag[0] === 'e' && tag[3] === 'sell') {
              console.log('Found e tag with sell marker:', tag[1]);
              confirmedSellIds.add(tag[1]);
            }
          });
        });
        console.log('Confirmed sell offer IDs to filter out:', Array.from(confirmedSellIds));
      }
      
      // Create map of sell offer IDs that have buy requests (pending)
      const pendingSellIds = new Set<string>();
      if (buyEvents && buyEvents.length > 0) {
        buyEvents.forEach(event => {
          const eTag = event.tags.find(t => t[0] === 'e')?.[1];
          if (eTag) pendingSellIds.add(eTag);
        });
        console.log('Found', pendingSellIds.size, 'sell offers with buy requests (pending)');
      }

      if (sellEvents && sellEvents.length > 0) {
        const parsedOffers: SellOffer[] = sellEvents
          .filter(event => !confirmedSellIds.has(event.id)) // Filter out confirmed offers
          .map(event => {
            const wallet = event.tags.find(t => t[0] === 'wallet')?.[1] || '';
            const amount = event.tags.find(t => t[0] === 'amount')?.[1] || '0';
            const currency = event.tags.find(t => t[0] === 'currency')?.[1] || '';
            const paymentMethods = event.tags.find(t => t[0] === 'payment_methods')?.[1] || '';
            const validUntil = event.tags.find(t => t[0] === 'valid_until')?.[1] || '';

            return {
              id: event.id,
              wallet,
              amount,
              currency,
              paymentMethods,
              validUntil,
              content: event.content,
              createdAt: event.created_at,
              status: pendingSellIds.has(event.id) ? 'pending' : 'active'
            };
          });

        // Sort by creation date, newest first
        parsedOffers.sort((a, b) => b.createdAt - a.createdAt);
        
        setOffers(parsedOffers);
        console.log('Loaded', parsedOffers.length, 'active sell offers (filtered out', confirmedSellIds.size, 'confirmed)');
      } else {
        setOffers([]);
      }
    } catch (error) {
      console.error('Error fetching sell offers:', error);
      setOffers([]);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [session?.nostrHexId, relays]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  return {
    offers,
    isLoading,
    refetch: fetchOffers
  };
};
