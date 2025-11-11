import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface BuyOffer {
  id: string;
  sellerPubkey: string;
  wallet: string;
  amount: string; // in Lanoshis
  currency: string;
  paymentMethods: string;
  validUntil: string;
  content: string;
  createdAt: number;
}

export const useNostrBuyOffers = (userCurrency?: string) => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [offers, setOffers] = useState<BuyOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  const fetchOffers = useCallback(async () => {
    if (!session?.nostrHexId || relays.length === 0) {
      setIsLoading(false);
      return;
    }
    
    if (!userCurrency) {
      // Keep loading state true while waiting for currency
      setIsLoading(true);
      return;
    }

    const pool = new SimplePool();
    
    try {
      console.log('Fetching KIND 91991 sell offers for currency:', userCurrency);
      
      // Fetch all sell offers (91991) that match user's currency
      const sellEvents = await Promise.race([
        pool.querySync(relays, {
          kinds: [91991],
        }),
        new Promise<Event[]>((_, reject) => 
          setTimeout(() => reject(new Error('Sell offers fetch timeout')), 10000)
        )
      ]) as Event[];
      
      console.log('Found', sellEvents.length, 'total sell offers');
      
      // Filter by currency
      const currencyMatchedOffers = sellEvents.filter(event => {
        const currency = event.tags.find(t => t[0] === 'currency')?.[1] || '';
        return currency.toLowerCase() === userCurrency.toLowerCase();
      });
      
      console.log('Found', currencyMatchedOffers.length, 'offers matching currency', userCurrency);
      
      // Get all sell offer IDs to check for buy requests
      const sellOfferIds = currencyMatchedOffers.map(e => e.id);
      
      // Fetch buy requests (91992) that reference these sell offers
      let buyEvents: Event[] = [];
      
      if (sellOfferIds.length > 0) {
        buyEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [91992],
            '#e': sellOfferIds,
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Buy requests fetch timeout')), 10000)
          )
        ]) as Event[];
        
        console.log('Found', buyEvents.length, 'buy requests for these offers');
      }

      // Create set of sell offer IDs that have buy requests
      const acceptedOfferIds = new Set<string>();
      buyEvents.forEach(event => {
        const eTag = event.tags.find(t => t[0] === 'e')?.[1];
        if (eTag) acceptedOfferIds.add(eTag);
      });

      // Filter out accepted offers and expired offers
      const now = new Date();
      const availableOffers: BuyOffer[] = currencyMatchedOffers
        .filter(event => {
          // Filter out if already has buy request
          if (acceptedOfferIds.has(event.id)) {
            console.log('Filtering out accepted offer:', event.id);
            return false;
          }
          
          // Filter out if expired
          const validUntil = event.tags.find(t => t[0] === 'valid_until')?.[1];
          if (validUntil) {
            const expiryDate = new Date(validUntil);
            if (expiryDate < now) {
              console.log('Filtering out expired offer:', event.id);
              return false;
            }
          }
          
          return true;
        })
        .map(event => {
          const wallet = event.tags.find(t => t[0] === 'wallet')?.[1] || '';
          const amount = event.tags.find(t => t[0] === 'amount')?.[1] || '0';
          const currency = event.tags.find(t => t[0] === 'currency')?.[1] || '';
          const paymentMethods = event.tags.find(t => t[0] === 'payment_methods')?.[1] || '';
          const validUntil = event.tags.find(t => t[0] === 'valid_until')?.[1] || '';

          return {
            id: event.id,
            sellerPubkey: event.pubkey,
            wallet,
            amount,
            currency,
            paymentMethods,
            validUntil,
            content: event.content,
            createdAt: event.created_at
          };
        });

      // Sort by creation date, newest first
      availableOffers.sort((a, b) => b.createdAt - a.createdAt);
      
      setOffers(availableOffers);
      console.log('Loaded', availableOffers.length, 'available buy offers');
    } catch (error) {
      console.error('Error fetching buy offers:', error);
      setOffers([]);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [session?.nostrHexId, relays, userCurrency]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  return {
    offers,
    isLoading,
    refetch: fetchOffers
  };
};
