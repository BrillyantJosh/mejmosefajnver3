import { useState, useEffect, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface EventRegistration {
  id: string;
  pubkey: string;
  created_at: number;
  eventSlug: string;
  status: 'going' | 'interested';
  seats?: number;
  note?: string;
  source?: string;
  attachments: string[];
  guests: string[];
  content: string;
}

export function useNostrEventRegistrations(eventSlug: string | undefined) {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRegistration, setUserRegistration] = useState<EventRegistration | null>(null);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  const parseRegistration = (event: any): EventRegistration | null => {
    try {
      const tags = event.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] => {
        return tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);
      };

      const eventTag = getTagValue('event');
      const status = getTagValue('status') as 'going' | 'interested';

      if (!eventTag || !status) return null;

      const seatsStr = getTagValue('seats');

      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        eventSlug: eventTag,
        status,
        seats: seatsStr ? parseInt(seatsStr, 10) : undefined,
        note: getTagValue('note'),
        source: getTagValue('source'),
        attachments: getAllTagValues('attachment'),
        guests: getAllTagValues('guest'),
        content: event.content || ''
      };
    } catch (err) {
      console.error('Error parsing registration:', err);
      return null;
    }
  };

  const fetchRegistrations = useCallback(async () => {
    if (!eventSlug) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const pool = new SimplePool();
      
      console.log('Fetching registrations for event slug:', eventSlug);
      
      // Fetch all KIND 53333 and filter client-side
      const rawEvents = await pool.querySync(relays, {
        kinds: [53333],
        limit: 500
      });

      console.log('Fetched all KIND 53333 events:', rawEvents.length);

      const parsedRegistrations: EventRegistration[] = [];
      const seenPubkeys = new Set<string>();

      // Sort by created_at descending to get most recent first
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseRegistration(rawEvent);
        if (parsed && parsed.eventSlug === eventSlug) {
          // Keep only the most recent registration per user
          if (!seenPubkeys.has(parsed.pubkey)) {
            seenPubkeys.add(parsed.pubkey);
            parsedRegistrations.push(parsed);
          }
        }
      }

      console.log('Filtered registrations for this event:', parsedRegistrations.length);
      setRegistrations(parsedRegistrations);

      // Find current user's registration
      if (session?.nostrHexId) {
        const myReg = parsedRegistrations.find(r => r.pubkey === session.nostrHexId);
        setUserRegistration(myReg || null);
      }

    } catch (err) {
      console.error('Error fetching registrations:', err);
    } finally {
      setLoading(false);
    }
  }, [eventSlug, session?.nostrHexId, relays]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  return { registrations, loading, userRegistration, refetch: fetchRegistrations };
}

// Hook to fetch registrations for multiple events at once
export function useNostrEventRegistrationsBatch(eventSlugs: string[]) {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const [registrationsByEvent, setRegistrationsByEvent] = useState<Record<string, EventRegistration[]>>({});
  const [loading, setLoading] = useState(true);

  const relays = systemParameters?.relays && systemParameters.relays.length > 0 
    ? systemParameters.relays 
    : DEFAULT_RELAYS;

  const fetchAllRegistrations = useCallback(async () => {
    if (eventSlugs.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const pool = new SimplePool();
      
      // Fetch all KIND 53333 registrations
      const rawEvents = await pool.querySync(relays, {
        kinds: [53333],
        limit: 1000
      });

      console.log('Fetched all registrations:', rawEvents.length);

      const byEvent: Record<string, EventRegistration[]> = {};
      eventSlugs.forEach(slug => {
        byEvent[slug] = [];
      });

      // Sort by created_at descending
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);
      const seenByEvent: Record<string, Set<string>> = {};

      for (const rawEvent of sortedEvents) {
        const tags = rawEvent.tags || [];
        const eventTag = tags.find((t: string[]) => t[0] === 'event');
        const statusTag = tags.find((t: string[]) => t[0] === 'status');
        
        if (!eventTag || !statusTag) continue;
        
        const eventSlug = eventTag[1];
        const status = statusTag[1] as 'going' | 'interested';

        if (!eventSlugs.includes(eventSlug)) continue;

        if (!seenByEvent[eventSlug]) {
          seenByEvent[eventSlug] = new Set();
        }

        // Keep only most recent per user per event
        if (!seenByEvent[eventSlug].has(rawEvent.pubkey)) {
          seenByEvent[eventSlug].add(rawEvent.pubkey);

          const seatsTag = tags.find((t: string[]) => t[0] === 'seats');
          const noteTag = tags.find((t: string[]) => t[0] === 'note');

          byEvent[eventSlug].push({
            id: rawEvent.id,
            pubkey: rawEvent.pubkey,
            created_at: rawEvent.created_at,
            eventSlug,
            status,
            seats: seatsTag ? parseInt(seatsTag[1], 10) : undefined,
            note: noteTag ? noteTag[1] : undefined,
            source: undefined,
            attachments: [],
            guests: [],
            content: rawEvent.content || ''
          });
        }
      }

      setRegistrationsByEvent(byEvent);

    } catch (err) {
      console.error('Error fetching registrations:', err);
    } finally {
      setLoading(false);
    }
  }, [eventSlugs.join(','), relays]);

  useEffect(() => {
    fetchAllRegistrations();
  }, [fetchAllRegistrations]);

  return { registrationsByEvent, loading, refetch: fetchAllRegistrations };
}
