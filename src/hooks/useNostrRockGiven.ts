import { useState, useEffect } from 'react';
import { Event as NostrEvent } from 'nostr-tools';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface RockReference {
  id: string;
  pubkey: string; // Person giving the reference
  targetPubkey: string; // Person being referenced
  kind0EventId?: string;
  familiarity: 'real_life' | 'virtual' | 'limited';
  relation: string;
  content: string;
  createdAt: number;
}

export const useNostrRockGiven = () => {
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

      try {
        console.log('🪨 Fetching KIND 87033 references given by user...');
        
        // Through this app's server — see src/lib/relayReadViaServer.ts.
        const events = await queryEventsViaServer<NostrEvent>({
          kinds: [87033],
          authors: [session.nostrHexId],
          limit: 500
        }, { label: 'rocks I gave (KIND 87033)' });

        console.log(`📋 Found ${events.length} KIND 87033 references given`);

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
        console.error('❌ Error fetching rock references given:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReferences();
  }, [session?.nostrHexId, parameters?.relays]);

  return { references, isLoading };
};
