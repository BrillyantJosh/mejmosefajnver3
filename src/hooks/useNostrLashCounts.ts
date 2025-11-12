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
    console.log('🔍 useNostrLashCounts: Hook triggered');
    console.log('🔍 useNostrLashCounts: postIds.length =', postIds.length);
    console.log('🔍 useNostrLashCounts: postIds =', postIds);
    
    if (postIds.length === 0) {
      console.log('⚠️ useNostrLashCounts: No postIds provided, skipping LASH count fetch');
      return;
    }

    let isSubscribed = true;

    const fetchLashCounts = async () => {
      setLoading(true);

      try {
        console.log('💜 Fetching LASH counts for', postIds.length, 'posts');
        console.log('💜 Post IDs:', postIds);
        console.log('💜 Querying relays:', relays);

        // First, check if there are ANY KIND 39991 events at all
        console.log('💜 Step 1: Checking for ANY KIND 39991 events on relay...');
        const allLashEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [39991],
            limit: 100  // Get first 100 to see if any exist
          }),
          new Promise<any[]>((_, reject) => 
            setTimeout(() => reject(new Error('Check query timeout')), 5000)
          )
        ]).catch(err => {
          console.error('❌ Check query failed:', err);
          return [];
        });
        
        console.log('💜 Total KIND 39991 events found on relay:', allLashEvents.length);
        if (allLashEvents.length > 0) {
          console.log('💜 Sample LASH event:', allLashEvents[0]);
          console.log('💜 Sample LASH tags (full):', JSON.stringify(allLashEvents[0]?.tags, null, 2));
          
          // Check for 'e' tags specifically
          const eTags = allLashEvents[0]?.tags?.filter((tag: string[]) => tag[0] === 'e');
          console.log('💜 Sample "e" tags:', eTags);
          console.log('💜 Sample "e" tag values:', eTags?.map((t: string[]) => t[1]));
          
          // Check for 'd' tags
          const dTags = allLashEvents[0]?.tags?.filter((tag: string[]) => tag[0] === 'd');
          console.log('💜 Sample "d" tags:', dTags);
          
          // Show first 3 post IDs we're looking for
          console.log('💜 Looking for post IDs (first 3):', postIds.slice(0, 3));
        }

        // Now fetch ALL recent KIND 39991 events and filter client-side
        // (relay tag filtering may not work correctly on all relays)
        console.log('💜 Step 2: Fetching ALL recent LASH events and filtering client-side...');
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

        console.log('💜 Found', lashEvents.length, 'LASH events');
        console.log('💜 Sample event:', lashEvents[0]);

        if (!isSubscribed) return;

        // Count UNIQUE LASH IDs per post (filter out expired ones)
        const counts = new Map<string, number>();
        const postLashIds = new Map<string, Set<string>>(); // postId -> Set of unique lash IDs
        
        console.log('💜 Processing LASH events...');
        
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

        console.log('💜 LASH counts calculated:', Array.from(counts.entries()));
        console.log('💜 Total posts with LASHes:', counts.size);

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
