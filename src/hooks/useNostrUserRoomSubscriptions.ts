import { useState, useEffect, useMemo, useCallback } from 'react';
import { SimplePool, Event, finalizeEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface RoomSubscription {
  slug: string;
  status: 'active' | 'muted' | 'left';
  since: number;
}

interface UseNostrUserRoomSubscriptionsParams {
  userPubkey?: string;
  userPrivateKey?: string;
}

export const useNostrUserRoomSubscriptions = ({ userPubkey, userPrivateKey }: UseNostrUserRoomSubscriptionsParams) => {
  const { parameters } = useSystemParameters();
  const [subscriptions, setSubscriptions] = useState<RoomSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const RELAYS = useMemo(() => {
    if (parameters?.relays && parameters.relays.length > 0) {
      return parameters.relays;
    }
    return DEFAULT_RELAYS;
  }, [parameters]);

  const fetchSubscriptions = useCallback(async () => {
    if (!userPubkey) {
      setSubscriptions([]);
      return;
    }

    const pool = new SimplePool();
    try {
      setLoading(true);
      
      console.log('🔍 Fetching room subscriptions for user:', userPubkey.slice(0, 8) + '...');
      console.log('📡 Using relays:', RELAYS);

      const filter = {
        kinds: [38890],
        authors: [userPubkey],
        "#d": ["rooms-subscriptions"],
        limit: 1
      };

      const events = await pool.querySync(RELAYS, filter);
      
      console.log('📨 Found', events.length, 'subscription events');
      
      if (events.length === 0) {
        setSubscriptions([]);
        setLoading(false);
        return;
      }

      // Get the latest event
      const latest = events.reduce((latest: Event | null, event: Event) => {
        if (!latest || event.created_at > latest.created_at) {
          return event;
        }
        return latest;
      }, null);

      if (!latest) {
        setSubscriptions([]);
        setLoading(false);
        return;
      }

      console.log('📋 Latest subscription event:', {
        id: latest.id.slice(0, 8) + '...',
        created_at: latest.created_at,
        tags: latest.tags.length
      });

      // Parse subscriptions from tags
      const subs: RoomSubscription[] = latest.tags
        .filter(t => t[0] === "sub")
        .map(t => ({
          slug: t[1],
          status: (t[2] || 'active') as 'active' | 'muted' | 'left',
          since: parseInt(t[3] || "0", 10)
        }));

      console.log('✅ Parsed subscriptions:', subs);
      setSubscriptions(subs);
    } catch (error) {
      console.error('❌ Error fetching user room subscriptions:', error);
      setSubscriptions([]);
    } finally {
      setLoading(false);
      pool.close(RELAYS);
    }
  }, [userPubkey, RELAYS]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const updateSubscriptions = useCallback(async (newSubscriptions: RoomSubscription[]) => {
    if (!userPubkey || !userPrivateKey) {
      console.error('User pubkey and private key required to update subscriptions');
      return false;
    }

    const pool = new SimplePool();
    setUpdating(true);

    try {
      // Build tags
      const tags: string[][] = [
        ["d", "rooms-subscriptions"],
        ["version", "1"],
        ["updated_at", Math.floor(Date.now() / 1000).toString()],
      ];

      // Add subscription tags
      newSubscriptions
        .filter(sub => sub.status !== 'left') // Don't include left rooms
        .forEach(sub => {
          tags.push(["sub", sub.slug, sub.status, sub.since.toString()]);
        });

      // Create and sign event
      const unsignedEvent = {
        kind: 38890,
        pubkey: userPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "My active Lana rooms subscriptions.",
      };

      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        userPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      const signedEvent = finalizeEvent(unsignedEvent, privateKeyBytes);

      // Publish to relays with detailed logging
      console.log('📡 Publishing KIND 38890 to', RELAYS.length, 'relays...');
      console.log('Event structure:', {
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey,
        tags: signedEvent.tags,
        subscriptions: newSubscriptions.length
      });

      const publishResults = await Promise.allSettled(
        RELAYS.map(relay => {
          const publishPromises = pool.publish([relay], signedEvent);
          return Promise.race([
            Promise.all(publishPromises).then(() => {
              console.log('✅ Published KIND 38890 to', relay);
              return { relay, success: true };
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('timeout')), 5000)
            )
          ]).catch(err => {
            console.log('❌ Failed to publish KIND 38890 to', relay, ':', err.message);
            return { relay, success: false, error: err.message };
          });
        })
      );

      const successCount = publishResults.filter(
        r => r.status === 'fulfilled' && (r.value as any).success
      ).length;

      console.log(`✅ KIND 38890 published to ${successCount}/${RELAYS.length} relays`);

      if (successCount === 0) {
        throw new Error('Failed to publish to any relay');
      }

      setSubscriptions(newSubscriptions);
      return true;
    } catch (error) {
      console.error('Error updating room subscriptions:', error);
      return false;
    } finally {
      setUpdating(false);
      pool.close(RELAYS);
    }
  }, [userPubkey, userPrivateKey, RELAYS]);

  const subscribe = useCallback(async (roomSlug: string) => {
    const existing = subscriptions.find(s => s.slug === roomSlug);
    
    let newSubscriptions: RoomSubscription[];
    if (existing) {
      // Update existing subscription to active
      newSubscriptions = subscriptions.map(s => 
        s.slug === roomSlug 
          ? { ...s, status: 'active' as const }
          : s
      );
    } else {
      // Add new subscription
      newSubscriptions = [
        ...subscriptions,
        {
          slug: roomSlug,
          status: 'active' as const,
          since: Math.floor(Date.now() / 1000)
        }
      ];
    }

    return await updateSubscriptions(newSubscriptions);
  }, [subscriptions, updateSubscriptions]);

  const unsubscribe = useCallback(async (roomSlug: string) => {
    // Remove the subscription
    const newSubscriptions = subscriptions.filter(s => s.slug !== roomSlug);
    return await updateSubscriptions(newSubscriptions);
  }, [subscriptions, updateSubscriptions]);

  const isSubscribed = useCallback((roomSlug: string) => {
    return subscriptions.some(s => s.slug === roomSlug && s.status === 'active');
  }, [subscriptions]);

  return {
    subscriptions,
    loading,
    updating,
    subscribe,
    unsubscribe,
    isSubscribed,
    refresh: fetchSubscriptions
  };
};
