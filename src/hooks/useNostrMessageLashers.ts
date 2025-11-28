import { useState, useEffect, useMemo } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { isLashExpired } from '@/lib/lashExpiration';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface Lasher {
  pubkey: string;
  name?: string;
  picture?: string;
  amount: string;
  timestamp: number;
  lashId: string;
}

/**
 * Hook to fetch details of who LASHed which messages
 * Returns a Map of messageId -> Lasher[]
 */
export function useNostrMessageLashers(messageIds: string[]) {
  const { parameters } = useSystemParameters();
  const [messageLashers, setMessageLashers] = useState<Map<string, Lasher[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const pool = useMemo(() => new SimplePool(), []);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  useEffect(() => {
    if (messageIds.length === 0) {
      return;
    }

    let isSubscribed = true;

    const fetchMessageLashers = async () => {
      setLoading(true);

      try {
        // Fetch all recent KIND 39991 LASH events
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
        
        // Filter to only events that reference our message IDs
        const messageIdSet = new Set(messageIds);
        const lashEvents = allRecentLashEvents.filter(event => {
          if (isLashExpired(event)) return false;
          
          const eTag = event.tags.find((tag: string[]) => tag[0] === 'e');
          return eTag && eTag[1] && messageIdSet.has(eTag[1]);
        });

        if (!isSubscribed) return;

        // Get unique pubkeys to fetch profiles
        const uniquePubkeys = Array.from(new Set(lashEvents.map(event => event.pubkey)));
        
        // Fetch profiles for all LASHers
        const profiles = new Map<string, any>();
        if (uniquePubkeys.length > 0) {
          const profileEvents = await Promise.race([
            pool.querySync(relays, {
              kinds: [0],
              authors: uniquePubkeys
            }),
            new Promise<any[]>((_, reject) => 
              setTimeout(() => reject(new Error('Profile query timeout')), 3000)
            )
          ]).catch(() => []);

          for (const event of profileEvents) {
            try {
              const profile = JSON.parse(event.content);
              profiles.set(event.pubkey, profile);
            } catch (e) {
              console.error('Failed to parse profile:', e);
            }
          }
        }

        if (!isSubscribed) return;

        // Build map of messageId -> Lasher[]
        const lashersMap = new Map<string, Lasher[]>();
        
        for (const event of lashEvents) {
          const eTag = event.tags.find((tag: string[]) => tag[0] === 'e');
          const dTag = event.tags.find((tag: string[]) => tag[0] === 'd');
          const amountTag = event.tags.find((tag: string[]) => tag[0] === 'amount');
          
          if (!eTag || !eTag[1] || !dTag || !dTag[1]) continue;
          
          const messageId = eTag[1];
          const lashId = dTag[1];
          const amount = amountTag ? amountTag[1] : '1000'; // Default 1000 lanoshis
          
          const profile = profiles.get(event.pubkey);
          
          const lasher: Lasher = {
            pubkey: event.pubkey,
            name: profile?.display_name || profile?.name,
            picture: profile?.picture,
            amount,
            timestamp: event.created_at,
            lashId
          };
          
          if (!lashersMap.has(messageId)) {
            lashersMap.set(messageId, []);
          }
          
          // Check if this LASH ID already exists (avoid duplicates)
          const existing = lashersMap.get(messageId)!;
          if (!existing.some(l => l.lashId === lashId)) {
            existing.push(lasher);
          }
        }

        // Sort by timestamp (most recent first)
        for (const [messageId, lashers] of lashersMap.entries()) {
          lashers.sort((a, b) => b.timestamp - a.timestamp);
        }

        setMessageLashers(lashersMap);
        setLoading(false);

      } catch (error) {
        console.error('❌ Error fetching message lashers:', error);
        setLoading(false);
      }
    };

    fetchMessageLashers();

    return () => {
      isSubscribed = false;
    };
  }, [messageIds.join(','), relays.join(','), pool]);

  return { messageLashers, loading };
}
