import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface Lana8WonderStatus {
  exists: boolean;
  planId?: string;
  eventId?: string;
  createdAt?: number;
}

export const useNostrLana8Wonder = () => {
  const [status, setStatus] = useState<Lana8WonderStatus>({ exists: false });
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchLana8WonderStatus = async () => {
      if (!session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        console.log('🌟 Fetching KIND 88888 Lana8Wonder status for user:', session.nostrHexId);
        
        const events = await pool.querySync(relays, {
          kinds: [88888],
          '#p': [session.nostrHexId],
          limit: 1
        });

        console.log(`📋 Found ${events.length} KIND 88888 Lana8Wonder events`);

        if (events.length > 0) {
          const event = events[0];
          const dTag = event.tags.find(tag => tag[0] === 'd');
          
          setStatus({
            exists: true,
            planId: dTag?.[1],
            eventId: event.id,
            createdAt: event.created_at
          });
        } else {
          setStatus({ exists: false });
        }
      } catch (error) {
        console.error('❌ Error fetching Lana8Wonder status:', error);
        setStatus({ exists: false });
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchLana8WonderStatus();
  }, [session?.nostrHexId, parameters?.relays]);

  return { status, isLoading };
};
