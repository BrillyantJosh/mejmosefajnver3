import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

/**
 * Lightweight hook that checks if the current user has any active (open)
 * OWN processes (KIND 37044 with status=open where user has a role).
 * Used for the header warning badge only.
 */
export function useOwnActiveProcess() {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [hasActiveProcess, setHasActiveProcess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pubkey = session?.nostrHexId;
    const relays = parameters?.relays;

    if (!pubkey || !relays || relays.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const check = async () => {
      const pool = new SimplePool();
      try {
        const events = await pool.querySync(relays, {
          kinds: [37044],
          limit: 100,
        });

        if (cancelled) return;

        const found = events.some((event) => {
          const status = event.tags.find(t => t[0] === 'status')?.[1];
          if (status !== 'open') return false;

          // Check if user is in any role (p tag at index 2 or 3)
          return event.tags.some(
            t =>
              t[0] === 'p' &&
              t[1] === pubkey &&
              (t[2] === 'initiator' || t[3] === 'initiator' ||
               t[2] === 'facilitator' || t[3] === 'facilitator' ||
               t[2] === 'participant' || t[3] === 'participant' ||
               t[2] === 'guest' || t[3] === 'guest')
          );
        });

        if (!cancelled) {
          setHasActiveProcess(found);
        }
      } catch (err) {
        console.error('[useOwnActiveProcess] Error:', err);
      } finally {
        if (!cancelled) setLoading(false);
        pool.close(relays);
      }
    };

    check();

    return () => {
      cancelled = true;
    };
  }, [session?.nostrHexId, parameters?.relays]);

  return { hasActiveProcess, loading };
}
