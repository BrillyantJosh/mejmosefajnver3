import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface ScheduleEntry {
  start: Date;
  end?: Date;
}

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
  // Multi-day schedule (empty = single-session using start/end)
  schedule: ScheduleEntry[];
}

type EventFilter = 'online' | 'live';

export interface UseNostrEventsOptions {
  enabled?: boolean;
}

export function useNostrEvents(filter: EventFilter, options?: UseNostrEventsOptions) {
  const { enabled = true } = options || {};
  const { session } = useAuth();
  const [events, setEvents] = useState<LanaEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchStartedRef = useRef(false);

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

      // Parse schedule tags for multi-day events
      const scheduleTags = tags.filter((t: string[]) => t[0] === 'schedule');
      const schedule: ScheduleEntry[] = scheduleTags
        .map((t: string[]) => {
          const s = new Date(t[1]);
          if (isNaN(s.getTime())) return null;
          const e = t[2] ? new Date(t[2]) : undefined;
          return { start: s, end: e && !isNaN(e.getTime()) ? e : undefined };
        })
        .filter((entry): entry is ScheduleEntry => entry !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

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
        schedule,
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
      // Use server-side relay query (much more reliable than browser SimplePool)
      const response = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { kinds: [36677], limit: 100 },
          timeout: 15000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      const rawEvents = data.events || [];

      console.log('Fetched raw events (server-side):', rawEvents.length);

      // Parse and filter events
      const parsedEvents: LanaEvent[] = [];
      const seenDTags = new Set<string>();

      // Sort by created_at descending to get most recent first
      const sortedEvents = [...rawEvents].sort((a: any, b: any) => b.created_at - a.created_at);

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
        // For multi-day events, check if any schedule entry is still upcoming
        let isUpcoming: boolean;
        if (event.schedule.length > 0) {
          const lastEntry = event.schedule[event.schedule.length - 1];
          const lastEnd = lastEntry.end || new Date(lastEntry.start.getTime() + 2 * 60 * 60 * 1000);
          isUpcoming = lastEnd > now;
        } else {
          const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
          isUpcoming = event.start > now || eventEnd > now;
        }

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
  }, [enabled, session, filter]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      fetchStartedRef.current = false;
      return;
    }

    // Skip if no session yet
    if (!session) {
      return;
    }

    // Only fetch once per stable dependency set
    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchEvents();
    }
  }, [enabled, fetchEvents, session]);

  return { events, loading: enabled ? loading : false, error, refetch: fetchEvents };
}

/**
 * Fetches ALL events (KIND 36677) in a single request and returns both online and live events.
 * Use this on the home page instead of calling useNostrEvents('online') + useNostrEvents('live').
 */
export function useNostrEventsAll(options?: UseNostrEventsOptions) {
  const { enabled = true } = options || {};
  const { session } = useAuth();
  const [onlineEvents, setOnlineEvents] = useState<LanaEvent[]>([]);
  const [liveEvents, setLiveEvents] = useState<LanaEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchStartedRef = useRef(false);

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

      const scheduleTags = tags.filter((t: string[]) => t[0] === 'schedule');
      const schedule: ScheduleEntry[] = scheduleTags
        .map((t: string[]) => {
          const s = new Date(t[1]);
          if (isNaN(s.getTime())) return null;
          const e = t[2] ? new Date(t[2]) : undefined;
          return { start: s, end: e && !isNaN(e.getTime()) ? e : undefined };
        })
        .filter((entry): entry is ScheduleEntry => entry !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

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
        schedule,
      };
    } catch {
      return null;
    }
  };

  const fetchEvents = useCallback(async () => {
    if (!enabled || !session) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { kinds: [36677], limit: 100 },
          timeout: 15000,
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const data = await response.json();
      const rawEvents = data.events || [];

      // Parse, deduplicate by dTag (newest first), filter active
      const parsedEvents: LanaEvent[] = [];
      const seenDTags = new Set<string>();
      const sortedEvents = [...rawEvents].sort((a: any, b: any) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseEvent(rawEvent);
        if (parsed && parsed.status === 'active') {
          if (!seenDTags.has(parsed.dTag)) {
            seenDTags.add(parsed.dTag);
            parsedEvents.push(parsed);
          }
        }
      }

      // Filter upcoming
      const now = new Date();
      const isUpcoming = (event: LanaEvent) => {
        if (event.schedule.length > 0) {
          const lastEntry = event.schedule[event.schedule.length - 1];
          const lastEnd = lastEntry.end || new Date(lastEntry.start.getTime() + 2 * 60 * 60 * 1000);
          return lastEnd > now;
        }
        const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
        return event.start > now || eventEnd > now;
      };

      const upcoming = parsedEvents.filter(isUpcoming);

      // Split into online and live, sort by start
      const online = upcoming.filter(e => e.isOnline).sort((a, b) => a.start.getTime() - b.start.getTime());
      const live = upcoming.filter(e => !e.isOnline).sort((a, b) => a.start.getTime() - b.start.getTime());

      setOnlineEvents(online);
      setLiveEvents(live);
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled, session]);

  useEffect(() => {
    if (!enabled || !session) return;
    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchEvents();
    }
  }, [enabled, fetchEvents, session]);

  return { onlineEvents, liveEvents, loading: enabled ? loading : false, refetch: fetchEvents };
}

export function getEventStatus(event: LanaEvent): 'happening-now' | 'today' | 'upcoming' {
  const now = new Date();
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  // For multi-day events, check each schedule entry
  if (event.schedule.length > 0) {
    for (const entry of event.schedule) {
      const entryEnd = entry.end || new Date(entry.start.getTime() + 2 * 60 * 60 * 1000);
      const isNow = (entry.start <= now && entryEnd > now) ||
                    (entry.start > now && entry.start <= fifteenMinutesFromNow);
      if (isNow) return 'happening-now';
    }
    for (const entry of event.schedule) {
      if (entry.start >= today && entry.start < tomorrow) return 'today';
    }
    return 'upcoming';
  }

  // Single-session event (legacy)
  const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
  const isHappeningNow = (event.start <= now && eventEnd > now) ||
                          (event.start > now && event.start <= fifteenMinutesFromNow);

  if (isHappeningNow) return 'happening-now';

  const isToday = event.start >= today && event.start < tomorrow;
  if (isToday) return 'today';

  return 'upcoming';
}
