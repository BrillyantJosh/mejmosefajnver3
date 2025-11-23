import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface RockReference {
  id: string;
  pubkey: string; // Person giving the reference
  targetPubkey: string; // Person being referenced (current user)
  kind0EventId?: string;
  familiarity: 'real_life' | 'virtual' | 'limited';
  relation: string;
  content: string;
  createdAt: number;
}

export const useNostrRockReceived = () => {
  const [references, setReferences] = useState<RockReference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchReferences = async () => {
      if (!session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        console.log('🪨 Fetching KIND 87033 references received by user...');
        
        const events = await pool.querySync(relays, {
          kinds: [87033],
          '#p': [session.nostrHexId],
          limit: 500
        });

        console.log(`📋 Found ${events.length} KIND 87033 references received`);

        const parsedReferences: RockReference[] = events.map((event: NostrEvent) => {
          const pTag = event.tags.find(tag => tag[0] === 'p');
          const eTag = event.tags.find(tag => tag[0] === 'e');
          const familiarityTag = event.tags.find(tag => tag[0] === 'familiarity');
          const relationTag = event.tags.find(tag => tag[0] === 'relation');

          return {
            id: event.id,
            pubkey: event.pubkey,
            targetPubkey: pTag?.[1] || '',
            kind0EventId: eTag?.[1],
            familiarity: (familiarityTag?.[1] as 'real_life' | 'virtual' | 'limited') || 'limited',
            relation: relationTag?.[1] || 'other',
            content: event.content,
            createdAt: event.created_at
          };
        });

        setReferences(parsedReferences.sort((a, b) => b.createdAt - a.createdAt));
      } catch (error) {
        console.error('❌ Error fetching rock references received:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchReferences();
  }, [session?.nostrHexId, parameters?.relays]);

  return { references, isLoading };
};
