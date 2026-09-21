import { useState, useEffect, useMemo } from 'react';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Hook to track which posts/comments the current user has LASHed
 * Returns a Set of event IDs that have been LASHed by the user
 */
export function useNostrUserLashes() {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [lashedEventIds, setLashedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const relays = parameters?.relays || [];

  useEffect(() => {
    if (!session?.nostrHexId) return;

    let isSubscribed = true;

    const fetchUserLashes = async () => {
      setLoading(true);

      try {
        console.log('💜 Fetching user LASHes from relays...');

        // Fetch all KIND 39991 events authored by current user
        // Through this app's server: a thousand LASH events never drained
        // inside the 4.4 s nostr-tools allows itself before it invents an EOSE
        // and discards the queue. See src/lib/relayReadViaServer.ts.
        const userLashEvents = await queryEventsViaServer({
          kinds: [39991],
          authors: [session.nostrHexId],
          limit: 1000
        }, { timeout: 10000, label: 'LASHes I gave (KIND 39991)' }).catch(err => {
          console.error('❌ User LASH query failed:', err);
          return [];
        });

        console.log('💜 Found', userLashEvents.length, 'user LASH events');

        if (!isSubscribed) return;

        // Extract event IDs from ["e", "<event_id>"] tags
        const eventIds = new Set<string>();
        
        for (const lashEvent of userLashEvents) {
          const eTag = lashEvent.tags.find((tag: string[]) => tag[0] === 'e');
          if (eTag && eTag[1]) {
            eventIds.add(eTag[1]);
          }
        }

        console.log('💜 User has LASHed', eventIds.size, 'unique events');
        setLashedEventIds(eventIds);
        setLoading(false);

      } catch (error) {
        console.error('❌ Error fetching user LASHes:', error);
        setLoading(false);
      }
    };

    fetchUserLashes();

    return () => {
      isSubscribed = false;
    };
  }, [session?.nostrHexId, relays.join(',')]);

  return { lashedEventIds, loading };
}
