import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface QuorumStatus {
  id: string;
  pubkey: string;
  userPubkey: string;
  status: 'in-quorum' | 'not-in-quorum';
  scope: string;
  updatedAt: number;
  canResist: 'allow' | 'not_yet';
  wallet?: string;
  holdings?: string;
  profile: 'ok' | 'missing';
  registry: 'ok' | 'missing';
  activity?: number;
  selfResp: 'ok' | 'unresolved';
  location?: string;
  credentials: 'ok' | 'missing';
  lana8wonder: 'ok' | 'missing';
  ttl?: number;
  createdAt: number;
}

export const useNostrQuorumStatus = () => {
  const [quorumStatus, setQuorumStatus] = useState<QuorumStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchQuorumStatus = async () => {
      if (!session?.nostrNpubId || !session?.nostrHexId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        console.log('🎯 Fetching KIND 38806 quorum status for user...');
        console.log('📌 User npub:', session.nostrNpubId);
        console.log('📌 User HEX:', session.nostrHexId);
        
        // First try with npub
        console.log('🔍 Trying query with NPUB...');
        let events = await pool.querySync(relays, {
          kinds: [38806],
          '#p': [session.nostrNpubId],
          limit: 10
        });

        console.log(`📋 Found ${events.length} KIND 38806 events with NPUB`);

        // If no results, try with HEX
        if (events.length === 0) {
          console.log('🔍 No results with NPUB, trying with HEX...');
          events = await pool.querySync(relays, {
            kinds: [38806],
            '#p': [session.nostrHexId],
            limit: 10
          });
          console.log(`📋 Found ${events.length} KIND 38806 events with HEX`);
        }

        console.log(`📋 Total KIND 38806 quorum status events found: ${events.length}`);

        if (events.length === 0) {
          setQuorumStatus(null);
          setIsLoading(false);
          pool.close(relays);
          return;
        }

        // Get the most recent event
        const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];

        const getTagValue = (event: NostrEvent, tagName: string): string | undefined => {
          const tag = event.tags.find(t => t[0] === tagName);
          return tag?.[1];
        };

        const parsed: QuorumStatus = {
          id: latestEvent.id,
          pubkey: latestEvent.pubkey,
          userPubkey: getTagValue(latestEvent, 'p') || '',
          status: (getTagValue(latestEvent, 'status') as 'in-quorum' | 'not-in-quorum') || 'not-in-quorum',
          scope: getTagValue(latestEvent, 'scope') || 'global',
          updatedAt: parseInt(getTagValue(latestEvent, 'updated_at') || '0', 10),
          canResist: (getTagValue(latestEvent, 'can_resist') as 'allow' | 'not_yet') || 'not_yet',
          wallet: getTagValue(latestEvent, 'wallet'),
          holdings: getTagValue(latestEvent, 'holdings'),
          profile: (getTagValue(latestEvent, 'profile') as 'ok' | 'missing') || 'missing',
          registry: (getTagValue(latestEvent, 'registry') as 'ok' | 'missing') || 'missing',
          activity: getTagValue(latestEvent, 'activity') ? parseInt(getTagValue(latestEvent, 'activity')!, 10) : undefined,
          selfResp: (getTagValue(latestEvent, 'self_resp') as 'ok' | 'unresolved') || 'unresolved',
          location: getTagValue(latestEvent, 'location'),
          credentials: (getTagValue(latestEvent, 'credentials') as 'ok' | 'missing') || 'missing',
          lana8wonder: (getTagValue(latestEvent, 'lana8wonder') as 'ok' | 'missing') || 'missing',
          ttl: getTagValue(latestEvent, 'ttl') ? parseInt(getTagValue(latestEvent, 'ttl')!, 10) : undefined,
          createdAt: latestEvent.created_at
        };

        console.log('✅ Parsed quorum status:', parsed);
        setQuorumStatus(parsed);
      } catch (error) {
        console.error('❌ Error fetching quorum status:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchQuorumStatus();
  }, [session?.nostrNpubId, parameters?.relays]);

  return { quorumStatus, isLoading };
};
