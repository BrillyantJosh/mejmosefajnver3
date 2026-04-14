import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrBusinessUnits } from './useNostrBusinessUnits';

const SHOP_BASE_URL = 'https://shop.lanapays.us';
const DEFAULT_CASHBACK = 5;

/** Prepend shop base URL if image is a relative upload path */
function fixImageUrl(url: string): string {
  return url.startsWith('/api/uploads/') ? `${SHOP_BASE_URL}${url}` : url;
}

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
  cashbackPercent: number;
}

const parseListing = (
  event: any,
  cashbackMap: Map<string, number>,
  suspendedIds: Set<string>,
): EcoListing | null => {
  try {
    const tags = event.tags;
    const getTag = (tagName: string) => tags.find((t: string[]) => t[0] === tagName)?.[1] || '';
    const getAllTags = (tagName: string) => tags.filter((t: string[]) => t[0] === tagName).map((t: string[]) => t[1]);
    const priceTag = tags.find((t: string[]) => t[0] === 'price');
    const geoTag = tags.find((t: string[]) => t[0] === 'geo');

    const unitRef = getTag('a');
    const title = getTag('title');
    const status = getTag('status') || 'active';

    // Skip if no title or not active
    if (!title || status !== 'active') return null;

    // Skip if unit is suspended
    const unitId = unitRef.split(':')[2] || '';
    if (unitId && suspendedIds.has(unitId)) return null;

    // Get cashback from map
    const cashbackPercent = unitId ? (cashbackMap.get(unitId) || DEFAULT_CASHBACK) : DEFAULT_CASHBACK;

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content: event.content || '',
      listingId: getTag('d'),
      unitRef,
      title,
      type: getTag('type'),
      price: priceTag?.[1] || '',
      priceCurrency: priceTag?.[2] || 'EUR',
      unit: getTag('unit'),
      status,
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
      images: getAllTags('image').map(fixImageUrl),
      thumbs: getAllTags('thumb').map(fixImageUrl),
      payment: getAllTags('payment'),
      lud16: getTag('lud16'),
      geoLat: geoTag?.[1] || '',
      geoLon: geoTag?.[2] || '',
      geoLabel: geoTag?.[3] || '',
      sprayLog: getTag('spray_log'),
      soilTestYear: getTag('soil_test_year'),
      video: getTag('video'),
      cashbackPercent,
    };
  } catch (error) {
    console.error('Error parsing listing:', error);
    return null;
  }
};

export const useNostrListings = () => {
  const { parameters } = useSystemParameters();
  const { cashbackMap, suspendedIds } = useNostrBusinessUnits();
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
            kinds: [36502],
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
          const listing = parseListing(event, cashbackMap, suspendedIds);
          if (listing) {
            parsed.push(listing);
          }
        });

        // Sort: cashback DESC, then date DESC (best deals first)
        parsed.sort((a, b) => {
          if (b.cashbackPercent !== a.cashbackPercent) return b.cashbackPercent - a.cashbackPercent;
          return b.created_at - a.created_at;
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
  }, [relays.join(','), cashbackMap, suspendedIds]);

  return { listings, isLoading };
};
