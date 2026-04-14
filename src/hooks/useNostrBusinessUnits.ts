import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const SHOP_BASE_URL = 'https://shop.lanapays.us';
const PROCESSOR_PUBKEY = '79730aba75d71584e8a4f9d0cc1173085e75590ce489760078d2bf6f5210d692';
const DEFAULT_CASHBACK = 5;

/** Prepend shop base URL if image is a relative upload path */
function fixImageUrl(url: string): string {
  return url.startsWith('/api/uploads/') ? `${SHOP_BASE_URL}${url}` : url;
}

export interface OpeningHours {
  version: string;
  timezone: string;
  week: {
    mon?: { open: string; close: string }[];
    tue?: { open: string; close: string }[];
    wed?: { open: string; close: string }[];
    thu?: { open: string; close: string }[];
    fri?: { open: string; close: string }[];
    sat?: { open: string; close: string }[];
    sun?: { open: string; close: string }[];
  };
  exceptions?: { date: string; closed: boolean; note?: string }[];
  always_open?: boolean;
  notes?: string;
}

export interface BusinessUnit {
  id: string;
  unit_id: string;
  name: string;
  owner: string;
  receiver_name: string;
  receiver_address: string;
  receiver_zip: string;
  receiver_city: string;
  receiver_country: string;
  bank_name: string;
  bank_address: string;
  bank_country: string;
  bank_swift: string;
  bank_account: string;
  longitude: number;
  latitude: number;
  country: string;
  currency: string;
  category: string;
  category_detail: string;
  images: string[];
  status: string;
  opening_hours?: OpeningHours;
  video?: string;
  url?: string;
  logo?: string;
  note?: string;
  content: string;
  created_at: number;
  cashbackPercent: number;
}

const parseBusinessUnit = (event: any): Omit<BusinessUnit, 'cashbackPercent'> | null => {
  try {
    const tags = event.tags;
    const getTag = (tagName: string) => tags.find((t: string[]) => t[0] === tagName)?.[1];
    const getAllTags = (tagName: string) => tags.filter((t: string[]) => t[0] === tagName).map((t: string[]) => t[1]);

    const longitude = parseFloat(getTag('longitude') || '0');
    const latitude = parseFloat(getTag('latitude') || '0');

    if (isNaN(longitude) || isNaN(latitude)) {
      console.warn('Invalid coordinates for business unit:', event.id);
      return null;
    }

    let opening_hours: OpeningHours | undefined;
    const openingHoursJson = getTag('opening_hours_json');
    if (openingHoursJson) {
      try {
        opening_hours = JSON.parse(openingHoursJson);
      } catch (e) {
        console.warn('Failed to parse opening_hours_json:', e);
      }
    }

    const logoRaw = getTag('logo');

    return {
      id: event.id,
      unit_id: getTag('unit_id') || getTag('d') || '',
      name: getTag('name') || 'Unknown Business',
      owner: getTag('owner') || event.pubkey,
      receiver_name: getTag('receiver_name') || '',
      receiver_address: getTag('receiver_address') || '',
      receiver_zip: getTag('receiver_zip') || '',
      receiver_city: getTag('receiver_city') || '',
      receiver_country: getTag('receiver_country') || '',
      bank_name: getTag('bank_name') || '',
      bank_address: getTag('bank_address') || '',
      bank_country: getTag('bank_country') || '',
      bank_swift: getTag('bank_swift') || '',
      bank_account: getTag('bank_account') || '',
      longitude,
      latitude,
      country: getTag('country') || '',
      currency: getTag('currency') || '',
      category: getTag('category') || '',
      category_detail: getTag('category_detail') || '',
      images: getAllTags('image').map(fixImageUrl),
      status: getTag('status') || 'active',
      opening_hours,
      video: getTag('video'),
      url: getTag('url'),
      logo: logoRaw ? fixImageUrl(logoRaw) : undefined,
      note: getTag('note'),
      content: event.content || '',
      created_at: event.created_at,
    };
  } catch (error) {
    console.error('Error parsing business unit:', error);
    return null;
  }
};

/** Build cashback map from KIND 30902 fee policy events */
function buildCashbackMap(events: any[]): Map<string, number> {
  const map = new Map<string, number>();
  // Deduplicate by d-tag, keep newest
  const byDTag = new Map<string, any>();
  for (const event of events) {
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
    const existing = byDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(dTag, event);
    }
  }
  for (const event of byDTag.values()) {
    const getTag = (name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1] || '';
    const unitId = getTag('unit_id');
    const status = getTag('status');
    if (!unitId || status !== 'active') continue;
    const lanaDiscount = parseFloat(getTag('lana_discount_per') || '0');
    if (lanaDiscount > 0 && lanaDiscount <= 20) {
      map.set(unitId, lanaDiscount);
    }
  }
  return map;
}

/** Build suspended unit IDs set from KIND 30903 events */
function buildSuspendedIds(events: any[]): Set<string> {
  const byDTag = new Map<string, any>();
  for (const event of events) {
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
    const existing = byDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(dTag, event);
    }
  }
  const suspended = new Set<string>();
  for (const [unitId, event] of byDTag) {
    const status = event.tags.find((t: string[]) => t[0] === 'status')?.[1] || '';
    const activeUntil = event.tags.find((t: string[]) => t[0] === 'active_until')?.[1] || '';
    if (status === 'suspended') {
      if (activeUntil && parseInt(activeUntil) <= Math.floor(Date.now() / 1000)) {
        continue; // expired
      }
      suspended.add(unitId);
    }
  }
  return suspended;
}

export const useNostrBusinessUnits = () => {
  const { parameters } = useSystemParameters();
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [cashbackMap, setCashbackMap] = useState<Map<string, number>>(new Map());
  const [suspendedIds, setSuspendedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchAll = async () => {
      const pool = new SimplePool();

      try {
        const timeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

        // Fetch all 3 KINDs in parallel
        const [unitEvents, feeEvents, suspensionEvents] = await Promise.all([
          timeout(pool.querySync(relays, { kinds: [30901], limit: 500 }), 15000),
          timeout(pool.querySync(relays, { kinds: [30902], authors: [PROCESSOR_PUBKEY] }), 12000).catch(() => [] as any[]),
          timeout(pool.querySync(relays, { kinds: [30903] }), 12000).catch(() => [] as any[]),
        ]);

        console.log('📦 Fetched: units=%d, fees=%d, suspensions=%d', unitEvents.length, feeEvents.length, suspensionEvents.length);

        // Build cashback map and suspended set
        const cbMap = buildCashbackMap(feeEvents);
        const susIds = buildSuspendedIds(suspensionEvents);
        setCashbackMap(cbMap);
        setSuspendedIds(susIds);

        // Deduplicate units by d-tag (NIP-33)
        const unitMap = new Map<string, any>();
        unitEvents.forEach((event: any) => {
          const unitId = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          if (!unitId) return;
          const existing = unitMap.get(unitId);
          if (!existing || event.created_at > existing.created_at) {
            unitMap.set(unitId, event);
          }
        });

        // Parse, filter suspended, attach cashback
        const units: BusinessUnit[] = [];
        unitMap.forEach((event) => {
          const parsed = parseBusinessUnit(event);
          if (parsed && parsed.status === 'active' && parsed.name && !susIds.has(parsed.unit_id)) {
            units.push({
              ...parsed,
              cashbackPercent: cbMap.get(parsed.unit_id) || DEFAULT_CASHBACK,
            });
          }
        });

        // Sort by name
        units.sort((a, b) => a.name.localeCompare(b.name));

        console.log('✅ Active business units: %d (cashback entries: %d, suspended: %d)', units.length, cbMap.size, susIds.size);
        setBusinessUnits(units);
      } catch (error) {
        console.error('Error fetching business units:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchAll();
  }, [relays.join(',')]);

  return { businessUnits, cashbackMap, suspendedIds, isLoading };
};
