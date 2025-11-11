import { useState, useEffect, useMemo } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

/**
 * Hook to track which posts/comments the current user has LASHed
 * Returns a Set of event IDs that have been LASHed by the user
 */
export function useNostrUserLashes() {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [lashedEventIds, setLashedEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const pool = useMemo(() => new SimplePool(), []);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  useEffect(() => {
    if (!session?.nostrHexId) return;

    let isSubscribed = true;

    const fetchUserLashes = async () => {
      setLoading(true);

      try {
        console.log('💜 Fetching user LASHes from relays...');

        // Fetch all KIND 39991 events authored by current user
        const userLashEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [39991],
            authors: [session.nostrHexId],
            limit: 1000
          }),
          new Promise<any[]>((_, reject) => 
            setTimeout(() => reject(new Error('User LASH query timeout')), 5000)
          )
        ]).catch(err => {
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
  }, [session?.nostrHexId, relays.join(','), pool]);

  return { lashedEventIds, loading };
}
