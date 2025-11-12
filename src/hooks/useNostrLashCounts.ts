import { useState, useEffect, useMemo } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { isLashExpired } from '@/lib/lashExpiration';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

/**
 * Hook to fetch and count LASH events (KIND 39991) for posts
 * Returns a Map of postId -> lashCount
 * 
 * Note: LASH counts represent all LASHes on the relay for each post.
 * If counts are 0, it means either:
 * 1. The posts haven't been LASHed yet, or
 * 2. LASH events reference different post IDs not currently in the feed
 */
export function useNostrLashCounts(postIds: string[]) {
  const { parameters } = useSystemParameters();
  const [lashCounts, setLashCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const pool = useMemo(() => new SimplePool(), []);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  useEffect(() => {
    if (postIds.length === 0) {
      return;
    }

    let isSubscribed = true;

    const fetchLashCounts = async () => {
      setLoading(true);

      try {
        // Fetch ALL recent KIND 39991 LASH events and filter client-side
        // (relay tag filtering may not work correctly on all relays)
        const allRecentLashEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [39991],
            limit: 1000
          }),
          new Promise<any[]>((_, reject) => 
            setTimeout(() => reject(new Error('LASH query timeout')), 5000)
          )
        ]).catch(err => {
          console.error('❌ LASH query failed:', err);
          return [];
        });
        
        // Filter to only events that reference our post IDs
        const postIdSet = new Set(postIds);
        const lashEvents = allRecentLashEvents.filter(event => {
          const eTag = event.tags.find((tag: string[]) => tag[0] === 'e');
          return eTag && eTag[1] && postIdSet.has(eTag[1]);
        });

        if (!isSubscribed) return;

        // Count UNIQUE LASH IDs per post (filter out expired ones)
        const counts = new Map<string, number>();
        const postLashIds = new Map<string, Set<string>>(); // postId -> Set of unique lash IDs
        
        for (const event of lashEvents) {
          // Skip expired LASHes
          if (isLashExpired(event)) continue;

          // Find the ["e", "<post_id>"] tag
          const eTag = event.tags.find((tag: string[]) => tag[0] === 'e');
          // Find the ["d", "lash:<uuid>"] tag
          const dTag = event.tags.find((tag: string[]) => tag[0] === 'd');
          
          if (eTag && eTag[1] && dTag && dTag[1]) {
            const postId = eTag[1];
            const lashId = dTag[1];
            
            // Initialize set if not exists
            if (!postLashIds.has(postId)) {
              postLashIds.set(postId, new Set());
            }
            
            // Add lash ID to the set (automatically handles duplicates)
            postLashIds.get(postId)!.add(lashId);
          }
        }

        // Convert sets to counts
        for (const [postId, lashIdSet] of postLashIds.entries()) {
          counts.set(postId, lashIdSet.size);
        }

        setLashCounts(counts);
        setLoading(false);

      } catch (error) {
        console.error('❌ Error fetching LASH counts:', error);
        setLoading(false);
      }
    };

    fetchLashCounts();

    return () => {
      isSubscribed = false;
    };
  }, [postIds.join(','), relays.join(','), pool]);

  return { lashCounts, loading };
}
