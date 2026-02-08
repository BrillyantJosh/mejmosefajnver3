import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SimplePool, type Event } from 'nostr-tools';
import { supabase } from '@/integrations/supabase/client';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

interface Lasher {
  pubkey: string;
  amount: string;
  name?: string;
  picture?: string;
}

export interface DMLashesResult {
  lashCounts: Map<string, number>;
  userLashedIds: Set<string>;
  lashers: Map<string, Lasher[]>;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Unified hook for DM LASHes - combines Supabase cache with relay sync
 * Priority: Fast load from Supabase, background sync from relays
 */
export const useNostrDMLashes = (
  messageIds: string[],
  currentUserPubkey?: string
): DMLashesResult => {
  const { parameters } = useSystemParameters();
  const [relaySyncing, setRelaySyncing] = useState(false);

  const relays = parameters?.relays || [];

  // Step 1: Fast load from Supabase cache
  const { data: dbLashes, isLoading, refetch } = useQuery({
    queryKey: ['dm-lashes', messageIds],
    queryFn: async () => {
      if (messageIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('dm_lashes')
        .select('*')
        .in('message_event_id', messageIds);

      if (error) {
        console.error('Error fetching dm_lashes:', error);
        return [];
      }

      return data || [];
    },
    enabled: messageIds.length > 0,
    staleTime: 5000, // Cache for 5 seconds
  });

  // Step 2: Background sync from relays
  useEffect(() => {
    if (messageIds.length === 0 || relaySyncing) return;

    const syncFromRelays = async () => {
      setRelaySyncing(true);
      const pool = new SimplePool();

      try {
        console.log('🔄 Syncing LASHes from relays for', messageIds.length, 'messages...');

        const events: Event[] = await pool.querySync(relays, {
          kinds: [39991],
          '#e': messageIds,
          limit: 1000
        });
        console.log('📥 Fetched', events.length, 'LASH events from relays');

        // Upsert to Supabase (ignore duplicates)
        if (events.length > 0) {
          const lashRecords = events.map(event => {
            const messageId = event.tags.find(t => t[0] === 'e')?.[1] || '';
            const recipientPubkey = event.tags.find(t => t[0] === 'p')?.[1] || '';
            const amount = event.tags.find(t => t[0] === 'amount')?.[1] || '0';
            const expiresTag = event.tags.find(t => t[0] === 'expires')?.[1];
            
            return {
              message_event_id: messageId,
              lash_event_id: event.id,
              sender_pubkey: event.pubkey,
              recipient_pubkey: recipientPubkey,
              amount,
              created_at: new Date(event.created_at * 1000).toISOString(),
              expires_at: expiresTag ? new Date(parseInt(expiresTag) * 1000).toISOString() : null
            };
          });

          // Batch upsert with ON CONFLICT ignore
          const { error } = await supabase
            .from('dm_lashes')
            .upsert(lashRecords, { 
              onConflict: 'lash_event_id',
              ignoreDuplicates: true 
            });

          if (error) {
            console.warn('⚠️ Error upserting LASHes to Supabase:', error);
          } else {
            console.log('💾 Synced', lashRecords.length, 'LASHes to Supabase');
            // Refetch to update UI
            refetch();
          }
        }

      } catch (error) {
        console.error('❌ Error syncing LASHes from relays:', error);
      } finally {
        setRelaySyncing(false);
        pool.close(relays);
      }
    };

    // Debounce: only sync after 1 second of stability
    const timeoutId = setTimeout(syncFromRelays, 1000);
    return () => clearTimeout(timeoutId);
  }, [messageIds.join(','), relays.join(',')]);

  // Step 3: Compute results from cache
  const lashCounts = new Map<string, number>();
  const userLashedIds = new Set<string>();
  const lashersMap = new Map<string, Lasher[]>();

  if (dbLashes) {
    dbLashes.forEach(lash => {
      // Count total lashes per message
      const currentCount = lashCounts.get(lash.message_event_id) || 0;
      lashCounts.set(lash.message_event_id, currentCount + 1);

      // Track user's own lashes
      if (currentUserPubkey && lash.sender_pubkey === currentUserPubkey) {
        userLashedIds.add(lash.message_event_id);
      }

      // Collect lashers per message (for popover display)
      const currentLashers = lashersMap.get(lash.message_event_id) || [];
      currentLashers.push({
        pubkey: lash.sender_pubkey,
        amount: lash.amount,
        // Profile data will be enriched separately
      });
      lashersMap.set(lash.message_event_id, currentLashers);
    });
  }

  return {
    lashCounts,
    userLashedIds,
    lashers: lashersMap,
    isLoading,
    refetch
  };
};