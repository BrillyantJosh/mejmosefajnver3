import { useState, useEffect, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface RoomLatestPost {
  roomSlug: string;
  postId: string;
  content: string;
  created_at: number;
  imageUrl?: string;
  authorPubkey: string;
}

export function useNostrRoomLatestPosts(roomSlugs: string[]) {
  const [latestPosts, setLatestPosts] = useState<Map<string, RoomLatestPost>>(new Map());
  const [loading, setLoading] = useState(true);
  const { parameters } = useSystemParameters();

  const RELAYS = useMemo(() => {
    return parameters?.relays || [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol"
    ];
  }, [parameters]);

  useEffect(() => {
    if (roomSlugs.length === 0) {
      setLoading(false);
      return;
    }

    const pool = new SimplePool();
    let isMounted = true;

    const fetchLatestPosts = async () => {
      try {
        setLoading(true);

        // Create filters for each room - we use 't' or 'a' tags
        const postsMap = new Map<string, RoomLatestPost>();

        // Fetch posts for each room slug
        for (const slug of roomSlugs) {
          try {
            const events = await pool.querySync(RELAYS, {
              kinds: [1],
              '#t': [slug],
              limit: 5
            });

            // Also try with 'a' tag
            const eventsA = await pool.querySync(RELAYS, {
              kinds: [1],
              '#a': [slug],
              limit: 5
            });

            const allEvents = [...events, ...eventsA];

            if (allEvents.length > 0) {
              // Get the latest event
              const latestEvent = allEvents.reduce((latest, event) => {
                return !latest || event.created_at > latest.created_at ? event : latest;
              }, null as Event | null);

              if (latestEvent) {
                // Extract image URL from content if present
                const imageMatch = latestEvent.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
                
                // Also check imeta tags for images
                const imetaTag = latestEvent.tags.find(t => t[0] === 'imeta');
                let imageUrl = imageMatch?.[0];
                
                if (imetaTag) {
                  const urlMatch = imetaTag.find(v => v.startsWith('url '));
                  if (urlMatch) {
                    imageUrl = urlMatch.replace('url ', '');
                  }
                }

                postsMap.set(slug, {
                  roomSlug: slug,
                  postId: latestEvent.id,
                  content: latestEvent.content,
                  created_at: latestEvent.created_at,
                  imageUrl,
                  authorPubkey: latestEvent.pubkey
                });
              }
            }
          } catch (err) {
            console.warn(`Error fetching posts for room ${slug}:`, err);
          }
        }

        if (isMounted) {
          setLatestPosts(postsMap);
        }
      } catch (error) {
        console.error('Error fetching latest posts:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchLatestPosts();

    return () => {
      isMounted = false;
      pool.close(RELAYS);
    };
  }, [roomSlugs.join(','), RELAYS]);

  return { latestPosts, loading };
}
