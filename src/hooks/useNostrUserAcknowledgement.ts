import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter, Event, finalizeEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface UserAcknowledgement {
  id: string;
  pubkey: string;
  createdAt: number;
  proposalDTag: string;
  ack: 'yes' | 'resistance';
  content: string;
  donationWallet?: string;
}

function parseAcknowledgementFromEvent(event: Event): UserAcknowledgement | null {
  try {
    const getTag = (name: string): string => {
      const tag = event.tags.find(t => t[0] === name);
      return tag ? tag[1] : '';
    };

    const eTag = event.tags.find(t => t[0] === 'e' && t[2] === 'proposal');
    const proposalDTag = eTag ? eTag[1] : '';
    const ack = getTag('ack') as 'yes' | 'resistance';

    if (!proposalDTag || !ack) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      proposalDTag,
      ack,
      content: event.content,
      donationWallet: getTag('donation_wallet') || undefined,
    };
  } catch (error) {
    console.error('Error parsing acknowledgement:', error);
    return null;
  }
}

export function useNostrUserAcknowledgement(proposalDTag: string) {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [acknowledgement, setAcknowledgement] = useState<UserAcknowledgement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAcknowledgement = useCallback(async () => {
    if (!parameters?.relays || parameters.relays.length === 0 || !session?.nostrHexId || !proposalDTag) {
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    setIsLoading(true);
    setError(null);

    try {
      // The d tag for acknowledgements is "ack:<proposal_slug>:<user_hex>"
      const dTagValue = `ack:${proposalDTag.replace('awareness:', '')}:${session.nostrHexId}`;
      
      const filter: Filter = {
        kinds: [38884],
        authors: [session.nostrHexId],
        '#d': [dTagValue],
      };

      const events = await pool.querySync(parameters.relays, filter);
      
      // Get the newest acknowledgement
      let newestAck: UserAcknowledgement | null = null;
      for (const event of events) {
        const ack = parseAcknowledgementFromEvent(event);
        if (ack && (!newestAck || ack.createdAt > newestAck.createdAt)) {
          newestAck = ack;
        }
      }

      setAcknowledgement(newestAck);
    } catch (err) {
      console.error('Error fetching acknowledgement:', err);
      setError('Failed to fetch vote status');
    } finally {
      setIsLoading(false);
      pool.close(parameters.relays);
    }
  }, [parameters?.relays, session?.nostrHexId, proposalDTag]);

  useEffect(() => {
    fetchAcknowledgement();
  }, [fetchAcknowledgement]);

  const submitVote = async (ackType: 'yes' | 'resistance', content: string): Promise<boolean> => {
    if (!parameters?.relays || !session?.nostrPrivateKey || !session?.nostrHexId) {
      throw new Error('Not authenticated or no relays available');
    }

    const pool = new SimplePool();
    const proposalSlug = proposalDTag.replace('awareness:', '');
    const dTagValue = `ack:${proposalSlug}:${session.nostrHexId}`;

    try {
      const eventTemplate = {
        kind: 38884,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', proposalDTag, 'proposal'],
          ['p', session.nostrHexId],
          ['ack', ackType],
          ['d', dTagValue],
        ],
        content: content,
      };

      // Add prev tag if updating existing vote
      if (acknowledgement) {
        eventTemplate.tags.push(['prev', acknowledgement.id]);
      }

      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

      // Publish to all relays
      try {
        await Promise.all(pool.publish(parameters.relays, signedEvent));
      } catch (err) {
        console.warn('Some relays failed to publish:', err);
      }
      console.log('Vote published successfully:', signedEvent.id);

      // Update local state
      setAcknowledgement({
        id: signedEvent.id,
        pubkey: signedEvent.pubkey,
        createdAt: signedEvent.created_at,
        proposalDTag,
        ack: ackType,
        content,
      });

      return true;
    } catch (err) {
      console.error('Error submitting vote:', err);
      throw err;
    } finally {
      pool.close(parameters.relays);
    }
  };

  return { 
    acknowledgement, 
    isLoading, 
    error, 
    submitVote,
    refetch: fetchAcknowledgement 
  };
}
