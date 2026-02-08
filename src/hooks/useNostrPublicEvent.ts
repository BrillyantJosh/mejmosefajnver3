import { useState, useEffect } from "react";
import { SimplePool } from "nostr-tools";
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { LanaEvent } from "./useNostrEvents";

interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

export function useNostrPublicEvent(dTag: string, systemRelays?: string[]) {
  const { parameters } = useSystemParameters();
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const relays = systemRelays && systemRelays.length > 0 ? systemRelays : (parameters?.relays || []);

  useEffect(() => {
    if (!dTag) {
      setLoading(false);
      return;
    }

    const pool = new SimplePool();
    let isMounted = true;
    const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
    const EVENT_TIMEOUT = isMobile ? 15000 : 10000;
    const PROFILE_TIMEOUT = isMobile ? 8000 : 5000;

    const parseEvent = (rawEvent: any): LanaEvent | null => {
      try {
        const tags = rawEvent.tags || [];
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
          id: rawEvent.id,
          pubkey: rawEvent.pubkey,
          created_at: rawEvent.created_at,
          title,
          content: rawEvent.content || '',
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

    const fetchEvent = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch event by d tag (KIND 36677 - Parameterized Replaceable Event)
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [36677],
            "#d": [dTag]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), EVENT_TIMEOUT)
          )
        ]);

        if (!isMounted) return;

        if (events.length === 0) {
          setError('Event not found');
          setLoading(false);
          return;
        }

        // Get the most recent event (by created_at) since it's a replaceable event
        const rawEvent = events.reduce((latest, current) => 
          current.created_at > latest.created_at ? current : latest
        );
        const parsedEvent = parseEvent(rawEvent);

        if (!parsedEvent) {
          setError('Failed to parse event');
          setLoading(false);
          return;
        }

        setEvent(parsedEvent);

        // Fetch organizer profile
        const profileEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [0],
            authors: [rawEvent.pubkey]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), PROFILE_TIMEOUT)
          )
        ]);

        if (!isMounted) return;

        if (profileEvents.length > 0) {
          try {
            const profileData = JSON.parse(profileEvents[0].content);
            setProfile(profileData);
          } catch (e) {
            console.error('Failed to parse profile:', e);
          }
        }

        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        console.error('Error fetching event:', err);
        setError('Failed to load event');
        setLoading(false);
      }
    };

    fetchEvent();

    return () => {
      isMounted = false;
      pool.close(relays);
    };
  }, [dTag, relays]);

  return { event, profile, loading, error };
}
