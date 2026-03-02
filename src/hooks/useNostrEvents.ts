import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface LanaEvent {
  id: string;
  pubkey: string;
  created_at: number;
  title: string;
  content: string;
  status: 'active' | 'archived' | 'canceled';
  start: Date;
  end?: Date;
  language: string;
  eventType: string;
  organizerPubkey: string;
  // Online event fields
  isOnline: boolean;
  onlineUrl?: string;
  youtubeUrl?: string;
  youtubeRecordingUrl?: string;
  // Physical event fields
  location?: string;
  lat?: number;
  lon?: number;
  capacity?: number;
  // Optional fields
  cover?: string;
  donationWallet?: string;
  donationWalletUnreg?: string;
  donationWalletType?: 'registered' | 'unregistered';
  fiatValue?: number;
  guests: string[];
  attachments: string[];
  category?: string;
  recording?: string;
  maxGuests?: number;
  // d tag for event identification
  dTag: string;
  // Timezone (IANA format)
  timezone?: string;
}

type EventFilter = 'online' | 'live';

export interface UseNostrEventsOptions {
  enabled?: boolean;
}

export function useNostrEvents(filter: EventFilter, options?: UseNostrEventsOptions) {
  const { enabled = true } = options || {};
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [events, setEvents] = useState<LanaEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchStartedRef = useRef(false);

  const relays = systemParameters?.relays || [];

  const parseEvent = (event: any): LanaEvent | null => {
    try {
      const tags = event.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] => {
        return tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);
      };

      const title = getTagValue('title');
      const status = getTagValue('status') as 'active' | 'archived' | 'canceled';
      const startStr = getTagValue('start');
      const dTag = getTagValue('d');
      const language = getTagValue('language');
      const eventType = getTagValue('event_type');
      const organizerPubkey = getTagValue('p');

      if (!title || !status || !startStr || !dTag || !language || !eventType || !organizerPubkey) {
        return null;
      }

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue('end');
      const end = endStr ? new Date(endStr) : undefined;

      const onlineUrl = getTagValue('online');
      const isOnline = !!onlineUrl;

      const latStr = getTagValue('lat');
      const lonStr = getTagValue('lon');
      const lat = latStr ? parseFloat(latStr) : undefined;
      const lon = lonStr ? parseFloat(lonStr) : undefined;

      const capacityStr = getTagValue('capacity');
      const fiatValueStr = getTagValue('fiat_value');
      const maxGuestsStr = getTagValue('max_guests');

      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        title,
        content: event.content || '',
        status,
        start,
        end: end && !isNaN(end.getTime()) ? end : undefined,
        language,
        eventType,
        organizerPubkey,
        isOnline,
        onlineUrl,
        youtubeUrl: getTagValue('youtube'),
        youtubeRecordingUrl: getTagValue('youtube_recording'),
        location: getTagValue('location'),
        lat,
        lon,
        capacity: capacityStr ? parseInt(capacityStr, 10) : undefined,
        cover: getTagValue('cover'),
        donationWallet: getTagValue('donation_wallet'),
        donationWalletUnreg: getTagValue('donation_wallet_unreg'),
        donationWalletType: (getTagValue('donation_wallet_type') as 'registered' | 'unregistered') || undefined,
        fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
        guests: getAllTagValues('guest'),
        attachments: getAllTagValues('attachment'),
        category: getTagValue('category'),
        recording: getTagValue('recording'),
        maxGuests: maxGuestsStr ? parseInt(maxGuestsStr, 10) : undefined,
        dTag,
        timezone: getTagValue('timezone'),
      };
    } catch (err) {
      console.error('Error parsing event:', err);
      return null;
    }
  };

  const fetchEvents = useCallback(async () => {
    if (!enabled || !session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const pool = new SimplePool();
      
      const rawEvents = await pool.querySync(relays, {
        kinds: [36677],
        limit: 100
      });

      console.log('Fetched raw events:', rawEvents.length);

      // Parse and filter events
      const parsedEvents: LanaEvent[] = [];
      const seenDTags = new Set<string>();

      // Sort by created_at descending to get most recent first
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseEvent(rawEvent);
        if (parsed && parsed.status === 'active') {
          // Only keep most recent version of each d tag
          if (!seenDTags.has(parsed.dTag)) {
            seenDTags.add(parsed.dTag);
            parsedEvents.push(parsed);
          }
        }
      }

      // Filter by type (online vs physical)
      const now = new Date();
      const filteredEvents = parsedEvents.filter(event => {
        // Only show upcoming events (start time is in the future OR currently happening)
        const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000); // Default 2 hour duration
        const isUpcoming = event.start > now || eventEnd > now;
        
        if (!isUpcoming) return false;

        if (filter === 'online') {
          return event.isOnline;
        } else {
          return !event.isOnline;
        }
      });

      // Sort by start date ascending
      filteredEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

      setEvents(filteredEvents);
      console.log(`Filtered ${filter} events:`, filteredEvents.length);

    } catch (err) {
      console.error('Error fetching events:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [enabled, session, relays, filter]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      fetchStartedRef.current = false;
      return;
    }

    // Skip if no session or relays yet
    if (!session || relays.length === 0) {
      return;
    }

    // Only fetch once per stable dependency set
    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchEvents();
    }
  }, [enabled, fetchEvents, session, relays]);

  return { events, loading: enabled ? loading : false, error, refetch: fetchEvents };
}

export function getEventStatus(event: LanaEvent): 'happening-now' | 'today' | 'upcoming' {
  const now = new Date();
  const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
  
  // Check if happening now (started and not ended, OR starts in less than 15 minutes)
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  const isHappeningNow = (event.start <= now && eventEnd > now) || 
                          (event.start > now && event.start <= fifteenMinutesFromNow);
  
  if (isHappeningNow) {
    return 'happening-now';
  }

  // Check if today
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const isToday = event.start >= today && event.start < tomorrow;
  
  if (isToday) {
    return 'today';
  }

  return 'upcoming';
}
