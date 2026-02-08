import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface AiEventSummary {
  id: string;
  dTag: string;
  title: string;
  description: string;
  isOnline: boolean;
  location?: string;
  startDate: string;
  startTime: string;
  endTime?: string;
  timezone?: string;
  eventType: string;
  coverImage?: string;
  shareLink: string;
  youtubeUrl?: string;
  fiatValue?: number;
  hasDonationWallet: boolean;
  status: 'happening-now' | 'today' | 'upcoming';
}

export interface AiEventsContext {
  onlineEvents: AiEventSummary[];
  liveEvents: AiEventSummary[];
  onlineCount: number;
  liveCount: number;
  totalCount: number;
  // Fetch status to distinguish "no data" from "fetch failed"
  fetchStatus: 'loading' | 'success' | 'error';
}

interface ParsedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  title: string;
  content: string;
  status: 'active' | 'archived' | 'canceled';
  start: Date;
  end?: Date;
  isOnline: boolean;
  location?: string;
  dTag: string;
  eventType: string;
  cover?: string;
  youtubeUrl?: string;
  fiatValue?: number;
  donationWallet?: string;
  timezone?: string;
}

function parseEvent(event: any): ParsedEvent | null {
  try {
    const tags = event.tags || [];
    const getTagValue = (name: string): string | undefined => {
      const tag = tags.find((t: string[]) => t[0] === name);
      return tag ? tag[1] : undefined;
    };

    const title = getTagValue('title');
    const status = getTagValue('status') as 'active' | 'archived' | 'canceled';
    const startStr = getTagValue('start');
    const dTag = getTagValue('d');
    const eventType = getTagValue('event_type');

    if (!title || !status || !startStr || !dTag || !eventType) {
      return null;
    }

    const start = new Date(startStr);
    if (isNaN(start.getTime())) return null;

    const endStr = getTagValue('end');
    const end = endStr ? new Date(endStr) : undefined;

    const onlineUrl = getTagValue('online');
    const isOnline = !!onlineUrl;

    const fiatValueStr = getTagValue('fiat_value');

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      title,
      content: event.content || '',
      status,
      start,
      end: end && !isNaN(end.getTime()) ? end : undefined,
      isOnline,
      location: getTagValue('location'),
      dTag,
      eventType,
      cover: getTagValue('cover'),
      youtubeUrl: getTagValue('youtube'),
      fiatValue: fiatValueStr ? parseFloat(fiatValueStr) : undefined,
      donationWallet: getTagValue('donation_wallet'),
      timezone: getTagValue('timezone'),
    };
  } catch (err) {
    console.error('Error parsing event for AI:', err);
    return null;
  }
}

function getEventStatus(event: ParsedEvent): 'happening-now' | 'today' | 'upcoming' {
  const now = new Date();
  const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
  
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  const isHappeningNow = (event.start <= now && eventEnd > now) || 
                          (event.start > now && event.start <= fifteenMinutesFromNow);
  
  if (isHappeningNow) {
    return 'happening-now';
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const isToday = event.start >= today && event.start < tomorrow;
  
  if (isToday) {
    return 'today';
  }

  return 'upcoming';
}

function formatTime(date: Date, timezone?: string): string {
  try {
    return date.toLocaleTimeString('sl-SI', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || 'Europe/Ljubljana',
    });
  } catch {
    return date.toLocaleTimeString('sl-SI', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('sl-SI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function useAiAdvisorEvents(): { eventsContext: AiEventsContext | null; isLoading: boolean; fetchStatus: 'loading' | 'success' | 'error' } {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [eventsContext, setEventsContext] = useState<AiEventsContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const fetchStartedRef = useRef(false);

  const relays = systemParameters?.relays || [];

  const fetchEvents = useCallback(async () => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const pool = new SimplePool();
      
      const rawEvents = await pool.querySync(relays, {
        kinds: [36677],
        limit: 100
      });

      const parsedEvents: ParsedEvent[] = [];
      const seenDTags = new Set<string>();

      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseEvent(rawEvent);
        if (parsed && parsed.status === 'active') {
          if (!seenDTags.has(parsed.dTag)) {
            seenDTags.add(parsed.dTag);
            parsedEvents.push(parsed);
          }
        }
      }

      const now = new Date();
      const upcomingEvents = parsedEvents.filter(event => {
        const eventEnd = event.end || new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
        return event.start > now || eventEnd > now;
      });

      upcomingEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

      const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://mejmosefajnver3.lovable.app';

      const mapToSummary = (event: ParsedEvent): AiEventSummary => ({
        id: event.id,
        dTag: event.dTag,
        title: event.title,
        description: event.content.substring(0, 200).replace(/\*\*/g, '').replace(/\n/g, ' '),
        isOnline: event.isOnline,
        location: event.location,
        startDate: formatDate(event.start),
        startTime: formatTime(event.start, event.timezone),
        endTime: event.end ? formatTime(event.end, event.timezone) : undefined,
        timezone: event.timezone || 'Europe/Ljubljana',
        eventType: event.eventType,
        coverImage: event.cover,
        shareLink: `${appOrigin}/event/${encodeURIComponent(event.dTag)}`,
        youtubeUrl: event.youtubeUrl,
        fiatValue: event.fiatValue,
        hasDonationWallet: !!event.donationWallet,
        status: getEventStatus(event),
      });

      const onlineEvents = upcomingEvents.filter(e => e.isOnline).map(mapToSummary);
      const liveEvents = upcomingEvents.filter(e => !e.isOnline).map(mapToSummary);

      setEventsContext({
        onlineEvents,
        liveEvents,
        onlineCount: onlineEvents.length,
        liveCount: liveEvents.length,
        totalCount: onlineEvents.length + liveEvents.length,
        fetchStatus: 'success',
      });
      setFetchStatus('success');

    } catch (err) {
      console.error('Error fetching events for AI:', err);
      setEventsContext({
        onlineEvents: [],
        liveEvents: [],
        onlineCount: 0,
        liveCount: 0,
        totalCount: 0,
        fetchStatus: 'error',
      });
      setFetchStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [session, relays]);

  useEffect(() => {
    if (!fetchStartedRef.current && session) {
      fetchStartedRef.current = true;
      fetchEvents();
    }
  }, [session, fetchEvents]);

  useEffect(() => {
    if (!session) {
      fetchStartedRef.current = false;
    }
  }, [session]);

  return { eventsContext, isLoading, fetchStatus };
}
