import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface MarketOffer {
  id: string;
  pubkey: string;
  createdAt: number;
  dTag: string; // NIP-33 parameter key
  title: string;
  description: string;
  content: string;
  currency: string;
  amount: string;
  walletId: string;
  status: 'active' | 'archived';
  maxSales: number;
  mode?: 'product' | 'onsite_service' | 'online_service';
  latitude?: number;
  longitude?: number;
  location?: string;
  category?: string;
  condition?: 'new' | 'used' | 'refurbished';
  shipping?: 'pickup_only' | 'shipping_available';
  image?: string;
  images?: string[];
  video?: string;
  expiration?: number;
  url?: string;
}

interface UseNostrMarketOffersOptions {
  authorFilter?: string; // Filter by specific author pubkey
  status?: 'active' | 'archived' | 'all';
}

export const useNostrMarketOffers = (options: UseNostrMarketOffersOptions = {}) => {
  const { parameters } = useSystemParameters();
  const [offers, setOffers] = useState<MarketOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchOffers = async () => {
      const pool = new SimplePool();
      
      try {
        const filter: any = {
          kinds: [31950], // Market Offer kind
          '#t': ['offer'],
        };

        // Add author filter if specified
        if (options.authorFilter) {
          filter.authors = [options.authorFilter];
        }

        // Note: We don't filter by #status in the query because we want to get all offers
        // and filter expired ones locally

        console.log('[Marketplace] Fetching offers with filter:', filter);
        
        const events = await Promise.race([
          pool.querySync(relays, filter),
          new Promise<NostrEvent[]>((_, reject) => 
            setTimeout(() => reject(new Error('Offer fetch timeout')), 15000)
          )
        ]);

        console.log('[Marketplace] Received events:', events.length);

        const parsedOffers: MarketOffer[] = events.map(event => {
          const getTag = (tagName: string): string | undefined => {
            const tag = event.tags.find(t => t[0] === tagName);
            return tag ? tag[1] : undefined;
          };

          const getAllTagValues = (tagName: string): string[] => {
            const tag = event.tags.find(t => t[0] === tagName);
            return tag ? tag.slice(1) : [];
          };

          const geoTag = event.tags.find(t => t[0] === 'geo');
          
          return {
            id: event.id,
            pubkey: event.pubkey,
            createdAt: event.created_at,
            dTag: getTag('d') || event.id,
            title: getTag('ttl') || 'Untitled',
            description: getTag('desc') || '',
            content: event.content,
            currency: getTag('cur') || 'EUR',
            amount: getTag('amt') || '0',
            walletId: getTag('walletid_pay') || '',
            status: (getTag('status') as 'active' | 'archived') || 'active',
            maxSales: parseInt(getTag('max_sales') || '1'),
            mode: getTag('mode') as 'product' | 'onsite_service' | 'online_service' | undefined,
            latitude: geoTag && geoTag[1] ? parseFloat(geoTag[1]) : undefined,
            longitude: geoTag && geoTag[2] ? parseFloat(geoTag[2]) : undefined,
            location: getTag('loc') || (geoTag && geoTag[3]) || undefined,
            category: getTag('cat'),
            condition: getTag('cond') as 'new' | 'used' | 'refurbished' | undefined,
            shipping: getTag('ship') as 'pickup_only' | 'shipping_available' | undefined,
            image: getTag('img'),
            images: getAllTagValues('imgs'),
            video: getTag('vid'),
            expiration: getTag('expiration') ? parseInt(getTag('expiration')) : undefined,
            url: getTag('u'),
          };
        });

        // Filter based on status and expiration
        const now = Math.floor(Date.now() / 1000);
        let filteredOffers = parsedOffers.filter(offer => 
          !offer.expiration || offer.expiration > now
        );

        // Apply status filter if specified
        if (options.status && options.status !== 'all') {
          filteredOffers = filteredOffers.filter(offer => offer.status === options.status);
        }

        // Sort by creation date (newest first)
        filteredOffers.sort((a, b) => b.createdAt - a.createdAt);

        console.log('[Marketplace] Final filtered offers:', filteredOffers.length);
        setOffers(filteredOffers);
      } catch (error) {
        console.error('Error fetching market offers:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchOffers();
  }, [relays, options.authorFilter, options.status]);

  return { offers, isLoading };
};
