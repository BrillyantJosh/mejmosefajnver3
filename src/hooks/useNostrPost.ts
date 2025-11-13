import { useState, useEffect } from "react";
import { SimplePool } from "nostr-tools";

interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

interface NostrPost {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  tags: string[][];
  sig: string;
  kind: number;
}

export function useNostrPost(eventId: string, relays: string[]) {
  const [post, setPost] = useState<NostrPost | null>(null);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || relays.length === 0) {
      console.log('⚠️ PublicPost: Missing eventId or relays', { eventId, relaysCount: relays.length });
      setLoading(false);
      return;
    }

    const pool = new SimplePool();
    let isMounted = true;
    const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
    const POST_TIMEOUT = isMobile ? 15000 : 10000;
    const PROFILE_TIMEOUT = isMobile ? 8000 : 5000;

    console.log('🔍 PublicPost: Fetching post', { 
      eventId, 
      relaysCount: relays.length,
      isMobile,
      timeout: POST_TIMEOUT
    });

    const fetchPost = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch post by ID with timeout (optimized for mobile)
        const events = await Promise.race([
          pool.querySync(relays, {
            ids: [eventId],
            kinds: [1]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), POST_TIMEOUT)
          )
        ]);

        if (!isMounted) return;

        if (events.length === 0) {
          console.warn('💜 Post not found on relays:', relays);
          setError('Post not found on any relay. It may have been deleted or is on different relays.');
          setLoading(false);
          return;
        }

        console.log('✅ Post found:', events[0].id);

        const event = events[0];
        setPost(event as NostrPost);

        // Fetch author profile with mobile-optimized timeout
        const profileEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [0],
            authors: [event.pubkey]
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
        console.error('Error fetching post:', err);
        setError('Failed to load post');
        setLoading(false);
      }
    };

    fetchPost();

    return () => {
      isMounted = false;
      pool.close(relays);
    };
  }, [eventId, relays]);

  return { post, profile, loading, error };
}
