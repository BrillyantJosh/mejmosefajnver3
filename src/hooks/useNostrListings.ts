import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface EcoListing {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  listingId: string;       // d-tag
  unitRef: string;         // a-tag → "30901:<pubkey>:<unitId>"
  title: string;
  type: string;            // product | subscription | service | experience
  price: string;
  priceCurrency: string;
  unit: string;            // kg | piece | L | ...
  status: string;          // active | sold_out | seasonal | archived
  stock: string;
  minOrder: string;
  maxOrder: string;
  preOrder: string;
  harvestDate: string;
  harvestSeason: string;
  availableFrom: string;
  availableUntil: string;
  eco: string[];
  cert: string[];
  certUrl: string[];
  tags: string[];          // t-tags
  delivery: string[];
  deliveryRadiusKm: string;
  marketDays: string[];
  subscriptionInterval: string;
  subscriptionContent: string;
  capacity: string;
  durationMin: string;
  bookingRequired: string;
  images: string[];
  thumbs: string[];
  payment: string[];
  lud16: string;
  geoLat: string;
  geoLon: string;
  geoLabel: string;
  sprayLog: string;
  soilTestYear: string;
  video: string;
}

const parseListing = (event: any): EcoListing | null => {
  try {
    const tags = event.tags;
    const getTag = (tagName: string) => tags.find((t: string[]) => t[0] === tagName)?.[1] || '';
    const getAllTags = (tagName: string) => tags.filter((t: string[]) => t[0] === tagName).map((t: string[]) => t[1]);
    const priceTag = tags.find((t: string[]) => t[0] === 'price');
    const geoTag = tags.find((t: string[]) => t[0] === 'geo');

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content: event.content || '',
      listingId: getTag('d'),
      unitRef: getTag('a'),
      title: getTag('title'),
      type: getTag('type'),
      price: priceTag?.[1] || '',
      priceCurrency: priceTag?.[2] || 'EUR',
      unit: getTag('unit'),
      status: getTag('status') || 'active',
      stock: getTag('stock'),
      minOrder: getTag('min_order'),
      maxOrder: getTag('max_order'),
      preOrder: getTag('pre_order'),
      harvestDate: getTag('harvest_date'),
      harvestSeason: getTag('harvest_season'),
      availableFrom: getTag('available_from'),
      availableUntil: getTag('available_until'),
      eco: getAllTags('eco'),
      cert: getAllTags('cert'),
      certUrl: getAllTags('cert_url'),
      tags: getAllTags('t'),
      delivery: getAllTags('delivery'),
      deliveryRadiusKm: getTag('delivery_radius_km'),
      marketDays: getAllTags('market_day'),
      subscriptionInterval: getTag('subscription_interval'),
      subscriptionContent: getTag('subscription_content'),
      capacity: getTag('capacity'),
      durationMin: getTag('duration_min'),
      bookingRequired: getTag('booking_required'),
      images: getAllTags('image'),
      thumbs: getAllTags('thumb'),
      payment: getAllTags('payment'),
      lud16: getTag('lud16'),
      geoLat: geoTag?.[1] || '',
      geoLon: geoTag?.[2] || '',
      geoLabel: geoTag?.[3] || '',
      sprayLog: getTag('spray_log'),
      soilTestYear: getTag('soil_test_year'),
      video: getTag('video'),
    };
  } catch (error) {
    console.error('Error parsing listing:', error);
    return null;
  }
};

export const useNostrListings = () => {
  const { parameters } = useSystemParameters();
  const [listings, setListings] = useState<EcoListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchListings = async () => {
      const pool = new SimplePool();

      try {
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [36500],
            limit: 2000,
          }),
          new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Listings fetch timeout')), 15000)
          ),
        ]);

        console.log('📦 Fetched listings:', events.length);

        // Deduplicate by pubkey:d-tag (NIP-33)
        const byKey = new Map<string, any>();
        events.forEach((event: any) => {
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          if (!dTag) return;
          const key = `${event.pubkey}:${dTag}`;
          const existing = byKey.get(key);
          if (!existing || event.created_at > existing.created_at) {
            byKey.set(key, event);
          }
        });

        const parsed: EcoListing[] = [];
        byKey.forEach((event) => {
          const listing = parseListing(event);
          if (listing && listing.status === 'active') {
            parsed.push(listing);
          }
        });

        console.log('✅ Parsed active listings:', parsed.length);
        setListings(parsed);
      } catch (error) {
        console.error('Error fetching listings:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchListings();
  }, [relays.join(',')]);

  return { listings, isLoading };
};
