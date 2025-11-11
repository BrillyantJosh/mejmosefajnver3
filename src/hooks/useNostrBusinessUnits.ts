import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

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
}

const parseBusinessUnit = (event: any): BusinessUnit | null => {
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
      images: getAllTags('image'),
      status: getTag('status') || 'active',
      opening_hours,
      video: getTag('video'),
      url: getTag('url'),
      logo: getTag('logo'),
      note: getTag('note'),
      content: event.content || '',
      created_at: event.created_at,
    };
  } catch (error) {
    console.error('Error parsing business unit:', error);
    return null;
  }
};

export const useNostrBusinessUnits = () => {
  const { parameters } = useSystemParameters();
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchBusinessUnits = async () => {
      const pool = new SimplePool();
      
      try {
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [30901],
            limit: 500,
          }),
          new Promise<any[]>((_, reject) => 
            setTimeout(() => reject(new Error('Business units fetch timeout')), 15000)
          )
        ]);

        console.log('📦 Fetched business units:', events.length);

        const units: BusinessUnit[] = [];
        const unitMap = new Map<string, any>();

        // Keep only the latest event for each unit_id (NIP-33 replace-by-d)
        events.forEach(event => {
          const unitId = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          if (!unitId) return;

          const existing = unitMap.get(unitId);
          if (!existing || event.created_at > existing.created_at) {
            unitMap.set(unitId, event);
          }
        });

        // Parse all unique units
        unitMap.forEach(event => {
          const unit = parseBusinessUnit(event);
          if (unit && unit.status === 'active') {
            units.push(unit);
          }
        });

        console.log('✅ Parsed active business units:', units.length);
        setBusinessUnits(units);
      } catch (error) {
        console.error('Error fetching business units:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchBusinessUnits();
  }, [relays.join(',')]);

  return { businessUnits, isLoading };
};
