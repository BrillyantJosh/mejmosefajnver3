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

    // Get d tag to extract proposal reference
    const dTag = getTag('d');
    const ack = getTag('ack') as 'yes' | 'resistance';

    if (!dTag || !ack) {
      console.log('❌ Missing dTag or ack:', { dTag, ack });
      return null;
    }

    // Extract proposal slug from d tag: "ack:<slug>:<user_hex>"
    const dTagParts = dTag.split(':');
    const proposalSlug = dTagParts.length >= 2 ? dTagParts[1] : '';

    console.log('✅ Parsed acknowledgement:', { dTag, proposalSlug, ack });

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      proposalDTag: `awareness:${proposalSlug}`,
      ack,
      content: event.content,
      donationWallet: getTag('donation_wallet') || undefined,
    };
  } catch (error) {
    console.error('Error parsing acknowledgement:', error);
    return null;
  }
}

export function useNostrUserAcknowledgement(proposalDTag: string, proposalEventId?: string) {
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

      console.log('🔍 Fetching acknowledgement with filter:', { dTagValue, filter });
      const events = await pool.querySync(parameters.relays, filter);
      console.log('📋 Found acknowledgement events:', events.length, events);
      
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
    if (!parameters?.relays || !session?.nostrPrivateKey || !session?.nostrHexId || !proposalEventId) {
      throw new Error('Not authenticated, no relays available, or missing proposal event ID');
    }

    const pool = new SimplePool();
    const proposalSlug = proposalDTag.replace('awareness:', '');
    const dTagValue = `ack:${proposalSlug}:${session.nostrHexId}`;
    const relays = parameters.relays;

    interface PublishResult {
      relay: string;
      success: boolean;
      error?: string;
    }

    const results: PublishResult[] = [];

    try {
      const eventTemplate = {
        kind: 38884,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', proposalEventId, '', 'reply'],
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

      console.log('✍️ Event signed:', {
        id: signedEvent.id,
        kind: signedEvent.kind,
        pubkey: signedEvent.pubkey
      });

      // Publish to each relay with proper timeout handling
      const publishPromises = relays.map(async (relay: string) => {
        console.log(`🔄 Publishing to ${relay}...`);
        
        return new Promise<void>((resolve) => {
          // Outer timeout: 10s - guards against relay never responding
          const timeout = setTimeout(() => {
            results.push({ relay, success: false, error: 'Connection timeout (10s)' });
            console.error(`❌ ${relay}: Timeout`);
            resolve();
          }, 10000);

          try {
            const pubs = pool.publish([relay], signedEvent);
            
            // Race: publish vs inner timeout (8s)
            Promise.race([
              Promise.all(pubs),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Publish timeout')), 8000)
              )
            ]).then(() => {
              clearTimeout(timeout);
              results.push({ relay, success: true });
              console.log(`✅ ${relay}: Successfully published`);
              resolve();
            }).catch((error) => {
              clearTimeout(timeout);
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              results.push({ relay, success: false, error: errorMsg });
              console.error(`❌ ${relay}: ${errorMsg}`);
              resolve();
            });
          } catch (error) {
            clearTimeout(timeout);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            results.push({ relay, success: false, error: errorMsg });
            console.error(`❌ ${relay}: ${errorMsg}`);
            resolve();
          }
        });
      });

      // Wait for ALL relays to complete or timeout
      await Promise.all(publishPromises);

      // Summary
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      console.log('📊 Publishing summary:', {
        eventId: signedEvent.id,
        total: results.length,
        successful: successCount,
        failed: failedCount,
        details: results
      });

      // Success if at least 1 relay accepted
      if (successCount === 0) {
        throw new Error('Failed to publish to any relay');
      }

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
      pool.close(relays);
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
