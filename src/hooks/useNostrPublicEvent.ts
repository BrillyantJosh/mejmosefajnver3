import { useState, useEffect } from "react";
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { LanaEvent, ScheduleEntry } from "./useNostrEvents";

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

export function useNostrPublicEvent(dTag: string, _systemRelays?: string[]) {
  const { parameters } = useSystemParameters();
  const [event, setEvent] = useState<LanaEvent | null>(null);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dTag) {
      setLoading(false);
      return;
    }

    // Wait until system parameters are loaded (relays needed server-side)
    if (!parameters?.relays || parameters.relays.length === 0) {
      return; // Will re-trigger when parameters load
    }

    let isMounted = true;

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
        const eventDTag = getTagValue('d');
        const language = getTagValue('language');
        const eventType = getTagValue('event_type');
        const organizerPubkey = getTagValue('p');

        if (!title || !status || !startStr || !eventDTag || !language || !eventType || !organizerPubkey) {
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
          lat: latStr ? parseFloat(latStr) : undefined,
          lon: lonStr ? parseFloat(lonStr) : undefined,
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
          dTag: eventDTag,
          timezone: getTagValue('timezone'),
          schedule,
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

        // Use server-side relay query (more reliable than browser SimplePool,
        // especially in Facebook/Instagram in-app browsers that block WebSockets)
        const response = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter: { kinds: [36677], '#d': [dTag] },
            timeout: 15000,
          }),
        });

        if (!isMounted) return;

        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const data = await response.json();
        const events = data.events || [];

        if (events.length === 0) {
          setError('Event not found');
          setLoading(false);
          return;
        }

        // Get the most recent event (by created_at) since it's a replaceable event
        const rawEvent = events.reduce((latest: any, current: any) =>
          current.created_at > latest.created_at ? current : latest
        );
        const parsedEvent = parseEvent(rawEvent);

        if (!parsedEvent) {
          setError('Failed to parse event');
          setLoading(false);
          return;
        }

        setEvent(parsedEvent);

        // Fetch organizer profile via server
        try {
          const profileRes = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filter: { kinds: [0], authors: [rawEvent.pubkey] },
              timeout: 8000,
            }),
          });

          if (!isMounted) return;

          if (profileRes.ok) {
            const profileData = await profileRes.json();
            const profileEvents = profileData.events || [];
            if (profileEvents.length > 0) {
              try {
                setProfile(JSON.parse(profileEvents[0].content));
              } catch {}
            }
          }
        } catch {}

        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        console.error('Error fetching event:', err);
        setError('Failed to load event');
        setLoading(false);
      }
    };

    fetchEvent();

    return () => { isMounted = false; };
  }, [dTag, parameters?.relays]);

  return { event, profile, loading, error };
}
