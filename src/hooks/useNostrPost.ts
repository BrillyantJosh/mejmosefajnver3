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
      setLoading(false);
      return;
    }

    const pool = new SimplePool();
    let isMounted = true;

    const fetchPost = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch post by ID with timeout
        const events = await Promise.race([
          pool.querySync(relays, {
            ids: [eventId],
            kinds: [1]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]);

        if (!isMounted) return;

        if (events.length === 0) {
          setError('Post not found');
          setLoading(false);
          return;
        }

        const event = events[0];
        setPost(event as NostrPost);

        // Fetch author profile
        const profileEvents = await Promise.race([
          pool.querySync(relays, {
            kinds: [0],
            authors: [event.pubkey]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
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
