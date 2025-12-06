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
      
      const rawEvents = await pool.querySync(relays, {
        kinds: [53333],
        '#event': [eventSlug]
      });

      console.log('Fetched registrations:', rawEvents.length);

      const parsedRegistrations: EventRegistration[] = [];
      const seenPubkeys = new Set<string>();

      // Sort by created_at descending to get most recent first
      const sortedEvents = [...rawEvents].sort((a, b) => b.created_at - a.created_at);

      for (const rawEvent of sortedEvents) {
        const parsed = parseRegistration(rawEvent);
        if (parsed) {
          // Keep only the most recent registration per user
          if (!seenPubkeys.has(parsed.pubkey)) {
            seenPubkeys.add(parsed.pubkey);
            parsedRegistrations.push(parsed);
          }
        }
      }

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
