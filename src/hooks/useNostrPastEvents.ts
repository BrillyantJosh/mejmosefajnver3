import { useState, useEffect, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface PastEvent {
  id: string;
  pubkey: string;
  created_at: number;
  title: string;
  content: string;
  start: Date;
  end?: Date;
  isOnline: boolean;
  cover?: string;
  youtubeRecordingUrl: string;
  dTag: string;
  language: string;
}

export function useNostrPastEvents() {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [events, setEvents] = useState<PastEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  const parseEvent = (event: any): PastEvent | null => {
    try {
      const tags = event.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };

      const title = getTagValue('title');
      const startStr = getTagValue('start');
      const dTag = getTagValue('d');
      const youtubeRecordingUrl = getTagValue('youtube_recording');
      const language = getTagValue('language') || 'unknown';

      // Only include events with youtube_recording
      if (!title || !startStr || !dTag || !youtubeRecordingUrl) {
        return null;
      }

      const start = new Date(startStr);
      if (isNaN(start.getTime())) return null;

      const endStr = getTagValue('end');
      const end = endStr ? new Date(endStr) : undefined;

      const onlineUrl = getTagValue('online');
      const isOnline = !!onlineUrl;

      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        title,
        content: event.content || '',
        start,
        end: end && !isNaN(end.getTime()) ? end : undefined,
        isOnline,
        cover: getTagValue('cover'),
        youtubeRecordingUrl,
        dTag,
        language,
      };
    } catch (err) {
      console.error('Error parsing event:', err);
      return null;
    }
  };

  const fetchEvents = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const pool = new SimplePool();
      
      const rawEvents = await pool.querySync(relays, {
        kinds: [36677],
        limit: 200
      });

      console.log('Fetched raw events for past:', rawEvents.length);

      // Parse and filter events
      const parsedEvents: PastEvent[] = [];
      const seenDTags = new Set<string>();

      // Sort by created_at descending to get most recent first
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseEvent(rawEvent);
        if (parsed) {
          // Only keep most recent version of each d tag
          if (!seenDTags.has(parsed.dTag)) {
            seenDTags.add(parsed.dTag);
            parsedEvents.push(parsed);
          }
        }
      }

      // Sort by start date descending (most recent first)
      parsedEvents.sort((a, b) => b.start.getTime() - a.start.getTime());

      setEvents(parsedEvents);
      console.log('Past events with recordings:', parsedEvents.length);

    } catch (err) {
      console.error('Error fetching past events:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [session, relays]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
