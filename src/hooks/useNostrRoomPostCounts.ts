import { useState, useEffect, useMemo } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

interface RoomPostCounts {
  [slug: string]: number;
}

export const useNostrRoomPostCounts = (roomSlugs: string[]) => {
  const { parameters } = useSystemParameters();
  const [postCounts, setPostCounts] = useState<RoomPostCounts>({});
  const [loading, setLoading] = useState(false);

  const RELAYS = useMemo(() => {
    return parameters?.relays || [];
  }, [parameters]);

  // Memoize the roomSlugs to prevent infinite loops
  const roomSlugsKey = useMemo(() => JSON.stringify(roomSlugs), [roomSlugs]);

  useEffect(() => {
    const parsedSlugs = JSON.parse(roomSlugsKey);
    
    if (!parsedSlugs || parsedSlugs.length === 0) {
      setPostCounts({});
      return;
    }

    const fetchPostCounts = async () => {
      const pool = new SimplePool();
      setLoading(true);

      try {
        // Calculate timestamp for 30 days ago
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

        console.log('📊 Fetching post counts for rooms:', parsedSlugs);
        console.log('📡 Using relays:', RELAYS);
        console.log('📅 Since:', new Date(thirtyDaysAgo * 1000).toISOString());

        // Fetch KIND 1 events for all rooms in the last 30 days
        const filter = {
          kinds: [1],
          since: thirtyDaysAgo,
        };

        const events = await pool.querySync(RELAYS, filter);
        
        console.log('📨 Total events received:', events.length);

        // Count posts per room slug
        const counts: RoomPostCounts = {};
        parsedSlugs.forEach((slug: string) => {
          counts[slug] = 0;
        });

        events.forEach(event => {
          // Check for 'a' or 't' tag matching room slugs
          const roomTags = event.tags.filter(t => t[0] === 'a' || t[0] === 't');
          roomTags.forEach(tag => {
            const slug = tag[1];
            if (counts[slug] !== undefined) {
              counts[slug]++;
            }
          });
        });

        console.log('✅ Post counts calculated:', counts);
        setPostCounts(counts);
      } catch (error) {
        console.error('❌ Error fetching room post counts:', error);
        setPostCounts({});
      } finally {
        setLoading(false);
        pool.close(RELAYS);
      }
    };

    fetchPostCounts();
  }, [roomSlugsKey, RELAYS]);

  return { postCounts, loading };
};
