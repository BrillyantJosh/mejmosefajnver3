import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useLashHistory() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);

  // Fetch which posts user has already LASHed
  const fetchUserLashes = useCallback(async (eventIds: string[]): Promise<Set<string>> => {
    if (!session?.nostrHexId || eventIds.length === 0) {
      return new Set();
    }

    try {
      const { data, error } = await supabase
        .from('lash_users_history')
        .select('event_id')
        .eq('nostr_hex_id', session.nostrHexId)
        .in('event_id', eventIds);

      if (error) {
        console.error('Error fetching user lashes:', error);
        return new Set();
      }

      return new Set(data?.map(d => d.event_id) || []);
    } catch (err) {
      console.error('Error in fetchUserLashes:', err);
      return new Set();
    }
  }, [session?.nostrHexId]);

  // Add a LASH to history
  const addLash = useCallback(async (eventId: string): Promise<boolean> => {
    if (!session?.nostrHexId) {
      console.error('No user session for adding lash');
      return false;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('lash_users_history')
        .insert({ 
          event_id: eventId, 
          nostr_hex_id: session.nostrHexId 
        });

      if (error) {
        // Ignore duplicate errors (user already lashed)
        if (error.code === '23505') {
          console.log('User already lashed this event');
          return true;
        }
        console.error('Error adding lash:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error in addLash:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [session?.nostrHexId]);

  return { fetchUserLashes, addLash, loading };
}
