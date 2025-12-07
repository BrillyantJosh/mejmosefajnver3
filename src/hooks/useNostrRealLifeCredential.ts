import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface RealLifeCredentialStatus {
  hasRealLifeReference: boolean;
  referenceCount: number;
  latestReference?: {
    fromPubkey: string;
    relation: string;
    createdAt: number;
  };
}

export const useNostrRealLifeCredential = () => {
  const [status, setStatus] = useState<RealLifeCredentialStatus>({ 
    hasRealLifeReference: false, 
    referenceCount: 0 
  });
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchCredentialStatus = async () => {
      if (!session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        console.log('🔐 Fetching KIND 87033 real_life credentials for user:', session.nostrHexId);
        
        // Query for KIND 87033 where user is in p tag
        const events = await pool.querySync(relays, {
          kinds: [87033],
          '#p': [session.nostrHexId],
          limit: 100
        });

        console.log(`📋 Found ${events.length} KIND 87033 reference events`);

        // Filter for real_life familiarity
        const realLifeEvents = events.filter(event => {
          const familiarityTag = event.tags.find(tag => tag[0] === 'familiarity');
          return familiarityTag?.[1] === 'real_life';
        });

        console.log(`✅ Found ${realLifeEvents.length} real_life references`);

        if (realLifeEvents.length > 0) {
          // Sort by created_at descending
          realLifeEvents.sort((a, b) => b.created_at - a.created_at);
          const latest = realLifeEvents[0];
          const relationTag = latest.tags.find(tag => tag[0] === 'relation');

          setStatus({
            hasRealLifeReference: true,
            referenceCount: realLifeEvents.length,
            latestReference: {
              fromPubkey: latest.pubkey,
              relation: relationTag?.[1] || 'unknown',
              createdAt: latest.created_at
            }
          });
        } else {
          setStatus({ hasRealLifeReference: false, referenceCount: 0 });
        }
      } catch (error) {
        console.error('❌ Error fetching credential status:', error);
        setStatus({ hasRealLifeReference: false, referenceCount: 0 });
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchCredentialStatus();
  }, [session?.nostrHexId, parameters?.relays]);

  return { status, isLoading };
};
