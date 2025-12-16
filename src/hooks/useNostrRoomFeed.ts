import { useState, useEffect, useCallback, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface NostrRoomPost {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  tags?: string[][];
  replyCount?: number;
}

export function useNostrRoomFeed(roomSlug: string | undefined) {
  const { parameters: systemParameters } = useSystemParameters();
  const [posts, setPosts] = useState<NostrRoomPost[]>([]);
  const [replyCounts, setReplyCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);
  
  const pool = useMemo(() => new SimplePool(), []);
  
  const RELAYS = useMemo(() => {
    if (systemParameters?.relays && systemParameters.relays.length > 0) {
      return systemParameters.relays;
    }
    return DEFAULT_RELAYS;
  }, [systemParameters?.relays]);

  // Get all post authors for bulk profile fetching
  const postAuthors = useMemo(() => 
    [...new Set(posts.map(p => p.pubkey))],
    [posts]
  );

  // Use bulk profile cache
  const { profiles: cachedProfiles, isLoading: profilesLoading } = useNostrProfilesCacheBulk(postAuthors);

  // Initial fetch
  useEffect(() => {
    if (!roomSlug) return;
    
    let isSubscribed = true;

    const loadRoomFeed = async () => {
      console.log(`🏠 Loading feed for room: ${roomSlug}`);
      setLoading(true);
      setError(null);
      setPosts([]);
      setHasMore(true);
      setOldestTimestamp(null);

      try {
        console.log('📡 Room feed querying for #t and #a tags:', roomSlug);

        // Query both #t and #a tags (some posts use alternative tag)
        const [eventsT, eventsA] = await Promise.race([
          Promise.all([
            pool.querySync(RELAYS, { kinds: [1], '#t': [roomSlug], limit: 20 }),
            pool.querySync(RELAYS, { kinds: [1], '#a': [roomSlug], limit: 20 })
          ]),
          new Promise<[Event[], Event[]]>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          )
        ]);

        // Combine and deduplicate by event id
        const allEvents = [...eventsT, ...eventsA];
        const events = Array.from(
          new Map(allEvents.map(e => [e.id, e])).values()
        );

        console.log(`📨 Received ${eventsT.length} #t events + ${eventsA.length} #a events = ${events.length} unique events`);

        if (!isSubscribed) return;

        console.log(`📨 Received ${events.length} events for room ${roomSlug}`);

        // Filter only main posts (no replies)
        const mainPosts = events.filter(event => {
          const hasReplyTag = event.tags?.some(tag => tag[0] === 'e');
          return !hasReplyTag;
        });

        console.log(`📝 Main posts (no replies): ${mainPosts.length}`);

        // Convert to posts and sort by time
        const roomPosts: NostrRoomPost[] = mainPosts.map(event => ({
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags
        })).sort((a, b) => b.created_at - a.created_at);

        setPosts(roomPosts);

        // Track oldest timestamp for pagination
        if (roomPosts.length > 0) {
          const oldest = Math.min(...roomPosts.map(p => p.created_at));
          setOldestTimestamp(oldest);
          setHasMore(mainPosts.length >= 10);
        } else {
          setHasMore(false);
        }

        // Count replies
        const replyCountMap = new Map<string, number>();
        events.forEach(event => {
          const replyToTags = event.tags?.filter(tag => tag[0] === 'e') || [];
          replyToTags.forEach(tag => {
            const referencedEventId = tag[1];
            if (referencedEventId) {
              replyCountMap.set(referencedEventId, (replyCountMap.get(referencedEventId) || 0) + 1);
            }
          });
        });
        setReplyCounts(replyCountMap);

        setLoading(false);
      } catch (error) {
        console.error('❌ Error loading room feed:', error);
        setError('Unable to load posts. Please try again.');
        setLoading(false);
      }
    };

    loadRoomFeed();

    return () => {
      isSubscribed = false;
    };
  }, [roomSlug, RELAYS, pool]);

  // Load more posts function
  const loadMore = useCallback(async () => {
    if (!roomSlug || !oldestTimestamp || loadingMore || !hasMore) return;

    console.log(`📜 Loading more posts for room ${roomSlug}, before: ${oldestTimestamp}`);
    setLoadingMore(true);

    try {
      const until = oldestTimestamp - 1;

      // Query both #t and #a tags for older posts
      const [eventsT, eventsA] = await Promise.race([
        Promise.all([
          pool.querySync(RELAYS, { kinds: [1], '#t': [roomSlug], until, limit: 20 }),
          pool.querySync(RELAYS, { kinds: [1], '#a': [roomSlug], until, limit: 20 })
        ]),
        new Promise<[Event[], Event[]]>((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 15000)
        )
      ]);

      // Combine and deduplicate
      const allEvents = [...eventsT, ...eventsA];
      const events = Array.from(
        new Map(allEvents.map(e => [e.id, e])).values()
      );

      console.log(`📨 Loaded ${events.length} more events (${eventsT.length} #t + ${eventsA.length} #a)`);

      // Filter only main posts
      const mainPosts = events.filter(event => {
        const hasReplyTag = event.tags?.some(tag => tag[0] === 'e');
        return !hasReplyTag;
      });

      if (mainPosts.length === 0) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }

      // Convert to posts
      const newPosts: NostrRoomPost[] = mainPosts.map(event => ({
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        created_at: event.created_at,
        tags: event.tags
      })).sort((a, b) => b.created_at - a.created_at);

      // Append to existing posts (dedupe by id)
      setPosts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const uniqueNewPosts = newPosts.filter(p => !existingIds.has(p.id));
        return [...prev, ...uniqueNewPosts].sort((a, b) => b.created_at - a.created_at);
      });

      // Update oldest timestamp
      const newOldest = Math.min(...newPosts.map(p => p.created_at));
      setOldestTimestamp(newOldest);
      setHasMore(mainPosts.length >= 10);

      // Update reply counts
      events.forEach(event => {
        const replyToTags = event.tags?.filter(tag => tag[0] === 'e') || [];
        replyToTags.forEach(tag => {
          const referencedEventId = tag[1];
          if (referencedEventId) {
            setReplyCounts(prev => {
              const newMap = new Map(prev);
              newMap.set(referencedEventId, (newMap.get(referencedEventId) || 0) + 1);
              return newMap;
            });
          }
        });
      });

      setLoadingMore(false);
    } catch (error) {
      console.error('❌ Error loading more posts:', error);
      setLoadingMore(false);
    }
  }, [roomSlug, oldestTimestamp, loadingMore, hasMore, RELAYS, pool]);

  // Merge posts with profiles and reply counts
  const postsWithProfiles = useMemo(() => {
    return posts.map(post => ({
      ...post,
      profile: cachedProfiles.get(post.pubkey),
      replyCount: replyCounts.get(post.id) || 0
    }));
  }, [posts, cachedProfiles, replyCounts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pool.close(RELAYS);
    };
  }, [pool, RELAYS]);

  return {
    posts: postsWithProfiles,
    loading: loading || profilesLoading,
    loadingMore,
    error,
    hasMore,
    loadMore
  };
}
