import { useState, useEffect, useCallback, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface NostrPost {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  tags?: string[][];
  replyCount?: number;
}

export function useNostrFeed() {
  const { parameters: systemParameters } = useSystemParameters();
  const [posts, setPosts] = useState<NostrPost[]>([]);
  const [replyCounts, setReplyCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [visiblePosts, setVisiblePosts] = useState(10);
  const [relayStatus, setRelayStatus] = useState<Map<string, { success: number; failures: number; avgTime: number }>>(new Map());
  const pool = useMemo(() => new SimplePool(), []);
  
  const RELAYS = useMemo(() => {
    if (systemParameters?.relays && systemParameters.relays.length > 0) {
      console.log('📡 Using relays from system parameters:', systemParameters.relays);
      return systemParameters.relays;
    }
    console.log('📡 Using default LANA relays');
    return DEFAULT_RELAYS;
  }, [systemParameters?.relays]);

  // Get all post authors for bulk profile fetching
  const postAuthors = useMemo(() => 
    [...new Set(posts.map(p => p.pubkey))],
    [posts]
  );

  // Use bulk profile cache
  const { profiles: cachedProfiles, isLoading: profilesLoading } = useNostrProfilesCacheBulk(postAuthors);


  useEffect(() => {
    let isSubscribed = true;
    let pollInterval: NodeJS.Timeout | null = null;

    const loadFeed = async (attempt = 1) => {
      console.log(`🔌 Connecting to Nostr relays for feed... (Attempt ${attempt}/3)`);
      console.log('📡 Relays:', RELAYS);
      setLoading(true);
      setError(null);

      try {
        // Fetch recent posts (last 7 days)
        const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        
        // ============ PHASE 1: QUICK LOAD (10 posts) ============
        console.log('⚡ PHASE 1: Quick loading first 10 posts...');
        
        const quickFilter = {
          kinds: [1],
          since: sevenDaysAgo,
          limit: 10  // Only 10 for fast initial display
        };
        
        const phase1Start = Date.now();
        let quickEvents: Event[] = [];
        
        try {
          quickEvents = await Promise.race([
            pool.querySync(RELAYS, quickFilter),
            new Promise<Event[]>((_, reject) => 
              setTimeout(() => reject(new Error('Quick query timeout')), 10000) // 10s for quick load
            )
          ]);
          
          const phase1Time = Date.now() - phase1Start;
          console.log(`✅ Phase 1 completed in ${phase1Time}ms - ${quickEvents.length} events`);
          
          if (!isSubscribed) return;
          
          // Process quick events immediately
          if (quickEvents.length > 0) {
            const mainPosts = quickEvents.filter(event => {
              const hasReplyTag = event.tags?.some(tag => tag[0] === 'e');
              return !hasReplyTag;
            });
            
            console.log('📝 Phase 1 main posts:', mainPosts.length);
            
            // Convert to posts
            const initialPosts: NostrPost[] = mainPosts.map(event => ({
              id: event.id,
              pubkey: event.pubkey,
              content: event.content,
              created_at: event.created_at,
              tags: event.tags
            })).sort((a, b) => b.created_at - a.created_at);
            
            // Show posts IMMEDIATELY
            setPosts(initialPosts);
            
            console.log('👥 Phase 1: Profiles will be loaded by cache hook');
            
            // Count replies
            const replyCountMap = new Map<string, number>();
            quickEvents.forEach(event => {
              const replyToTags = event.tags?.filter(tag => tag[0] === 'e') || [];
              replyToTags.forEach(tag => {
                const referencedEventId = tag[1];
                if (referencedEventId) {
                  replyCountMap.set(referencedEventId, (replyCountMap.get(referencedEventId) || 0) + 1);
                }
              });
            });
            setReplyCounts(replyCountMap);
            
            // Cache to sessionStorage for instant display on refresh
            try {
              sessionStorage.setItem('lana_feed_cache', JSON.stringify({
                posts: initialPosts,
                timestamp: Date.now()
              }));
            } catch (e) {
              console.warn('Failed to cache posts:', e);
            }
            
            console.log('✅ Phase 1 complete - Posts visible!');
            setLoading(false);
            setReady(true);
          }
          
        } catch (err) {
          console.error('❌ Phase 1 failed:', err);
          // Don't fail completely, try full load
        }
        
        // ============ PHASE 2: BACKGROUND LOAD (more posts) ============
        if (!isSubscribed) return;
        
        // Small delay to let UI render
        setTimeout(async () => {
          if (!isSubscribed) return;
          
          console.log('🔄 PHASE 2: Loading more posts in background...');
          setLoadingMore(true);
          
          const fullFilter = {
            kinds: [1],
            // No 'since' - get latest 50 posts
            limit: 50
          };
          
          const phase2Start = Date.now();
          let events: Event[] = [];
          
          try {
            events = await Promise.race([
              pool.querySync(RELAYS, fullFilter),
              new Promise<Event[]>((_, reject) => 
                setTimeout(() => reject(new Error('Full query timeout')), 30000) // 30s for full load
              )
            ]);
            
            const phase2Time = Date.now() - phase2Start;
            console.log(`✅ Phase 2 completed in ${phase2Time}ms - ${events.length} events`);
            
            // Track successful relay performance
            RELAYS.forEach(relay => {
              setRelayStatus(prev => {
                const newMap = new Map(prev);
                const current = newMap.get(relay) || { success: 0, failures: 0, avgTime: 0 };
                newMap.set(relay, {
                  success: current.success + 1,
                  failures: current.failures,
                  avgTime: (current.avgTime * current.success + phase2Time) / (current.success + 1)
                });
                return newMap;
              });
            });
          } catch (err) {
            console.warn('⚠️ Phase 2 failed, keeping Phase 1 posts:', err);
            setLoadingMore(false);
            return; // Keep Phase 1 posts
          }
          
          if (!isSubscribed) return;
          
          // Check if we got any new posts
          if (events.length === 0 || events.length === quickEvents.length) {
            console.log('ℹ️ No new posts in Phase 2, keeping Phase 1');
            setLoadingMore(false);
            return;
          }
          
          console.log('📨 Phase 2: Total events received:', events.length);
          
          // Filter only main posts
          const mainPosts = events.filter(event => {
            const hasReplyTag = event.tags?.some(tag => tag[0] === 'e');
            return !hasReplyTag;
          });
          
          console.log('📝 Phase 2: Main posts (filtered):', mainPosts.length);
          
          // Convert events to posts
          const allPosts: NostrPost[] = mainPosts.map(event => ({
            id: event.id,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
            tags: event.tags
          })).sort((a, b) => b.created_at - a.created_at);
          
          // Update posts with full set
          setPosts(allPosts);
          
          // Count all replies
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
          
          console.log('✅ Phase 2 complete - All posts loaded, profiles will be loaded by cache hook!');
          setLoadingMore(false);
          setRetryCount(0);
          setError(null);
        }, 100); // 100ms delay to let UI render

        // Polling interval: Check for new posts every 2 minutes
        if (!isSubscribed) return;
        
        console.log('⏰ Setting up polling interval (2 minutes)');
        
        pollInterval = setInterval(async () => {
          if (!isSubscribed) return;
          
          console.log('🔄 Polling for new posts...');
          
          const lastPostTime = posts.length > 0 
            ? Math.max(...posts.map(p => p.created_at)) 
            : Math.floor(Date.now() / 1000) - 300; // Last 5 minutes
          
          try {
            const newEvents = await Promise.race([
              pool.querySync(RELAYS, {
                kinds: [1],
                since: lastPostTime,
                limit: 20
              }),
              new Promise<Event[]>((_, reject) => 
                setTimeout(() => reject(new Error('Poll timeout')), 5000)
              )
            ]).catch(() => []);

            if (newEvents.length === 0) {
              console.log('📭 No new posts');
              return;
            }

            console.log('📬 Found', newEvents.length, 'new events');

            // Process new posts
            const newMainPosts = newEvents.filter(event => {
              const hasReplyTag = event.tags?.some(tag => tag[0] === 'e');
              return !hasReplyTag;
            });

            // Update reply counts
            newEvents.forEach(event => {
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

            if (newMainPosts.length > 0) {
              console.log('📝 Adding', newMainPosts.length, 'new posts');

              // Add new posts
              setPosts(prev => {
                const existingIds = new Set(prev.map(p => p.id));
                const uniqueNewPosts = newMainPosts
                  .filter(event => !existingIds.has(event.id))
                  .map(event => ({
                    id: event.id,
                    pubkey: event.pubkey,
                    content: event.content,
                    created_at: event.created_at,
                    tags: event.tags
                  }));
                
                if (uniqueNewPosts.length === 0) return prev;
                
                // Add to beginning and re-sort
                return [...uniqueNewPosts, ...prev].sort((a, b) => b.created_at - a.created_at);
              });
            }
          } catch (error) {
            console.error('❌ Polling error:', error);
          }
        }, 2 * 60 * 1000); // 2 minutes

      } catch (error) {
        console.error('❌ Error loading feed:', error);
        
        // Retry logic with exponential backoff (only for Phase 1)
        if (attempt < 3) {
          const delay = 2000 * attempt; // 2s, 4s, 6s
          console.warn(`⚠️ Retrying Phase 1 in ${delay}ms... (${attempt}/3)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          if (isSubscribed) {
            setRetryCount(attempt);
            return loadFeed(attempt + 1);
          }
        }
        
        // All retries failed
        setError('Unable to load posts. Please check your internet connection and try again.');
        setLoading(false);
        setLoadingMore(false);
      }
    };

    loadFeed(1);

    return () => {
      isSubscribed = false;
      if (pollInterval) clearInterval(pollInterval);
      pool.close(RELAYS);
    };
  }, [RELAYS, pool]);

  // Merge posts with profiles and reply counts
  const postsWithProfiles = useMemo(() => {
    return posts.map(post => ({
      ...post,
      profile: cachedProfiles.get(post.pubkey),
      replyCount: replyCounts.get(post.id) || 0
    }));
  }, [posts, cachedProfiles, replyCounts]);

  // Slice to show only visible posts
  const visiblePostsWithProfiles = useMemo(() => {
    return postsWithProfiles.slice(0, visiblePosts);
  }, [postsWithProfiles, visiblePosts]);

  // Load more posts function
  const loadMore = useCallback(() => {
    setVisiblePosts(prev => Math.min(prev + 10, posts.length));
  }, [posts.length]);

  // Check if there are more posts to load
  const hasMore = visiblePosts < posts.length;
  
  // Retry function that can be called from UI
  const retry = useCallback(() => {
    console.log('🔄 Manual retry triggered');
    setRetryCount(0);
    setError(null);
    setReady(false);
    setPosts([]);
    setReplyCounts(new Map());
    // The useEffect will trigger loadFeed when ready changes
  }, []);

  // Log relay status for diagnostics
  useEffect(() => {
    if (relayStatus.size > 0) {
      console.log('📊 Relay Performance:', Array.from(relayStatus.entries()).map(([relay, stats]) => ({
        relay,
        successRate: stats.success / (stats.success + stats.failures) * 100,
        avgTime: Math.round(stats.avgTime),
        total: stats.success + stats.failures
      })));
    }
  }, [relayStatus]);

  return {
    posts: ready ? visiblePostsWithProfiles : [],
    loading: loading || profilesLoading,
    loadingMore,
    error,
    retryCount,
    profiles: cachedProfiles,
    hasMore,
    loadMore,
    retry
  };
}
