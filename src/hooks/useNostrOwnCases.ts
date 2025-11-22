import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface OwnCase {
  id: string;
  creatorPubkey: string;
  content: string;
  status: string;
  lang: string;
  participants: string[];
  topic?: string;
  triggerEventId?: string;
  lanacoinTxid?: string;
  createdAt: number;
  userRole: 'initiated' | 'participant';
}

export const useNostrOwnCases = () => {
  const [cases, setCases] = useState<OwnCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    const fetchCases = async () => {
      if (!parameters?.relays || parameters.relays.length === 0) {
        console.warn('No relays available');
        setIsLoading(false);
        return;
      }

      if (!session?.nostrHexId) {
        console.warn('No user session');
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();
      
      try {
        // Fetch both cases created by user and cases where user is a participant
        const authoredEvents = await pool.querySync(relays, {
          kinds: [87044],
          authors: [session.nostrHexId],
        });
        
        const participantEvents = await pool.querySync(relays, {
          kinds: [87044],
          "#p": [session.nostrHexId],
        });
        
        // Combine and deduplicate events
        const allEvents = [...authoredEvents];
        participantEvents.forEach(event => {
          if (!allEvents.find(e => e.id === event.id)) {
            allEvents.push(event);
          }
        });
        
        const events = allEvents;

        const parsedCases: OwnCase[] = events.map((event: any) => {
          const tags = event.tags || [];
          const statusTag = tags.find((tag: string[]) => tag[0] === 'status');
          const langTag = tags.find((tag: string[]) => tag[0] === 'lang');
          const topicTag = tags.find((tag: string[]) => tag[0] === 'topic');
          const triggerTag = tags.find((tag: string[]) => tag[0] === 'e' && tag[2] === 'trigger');
          const txidTag = tags.find((tag: string[]) => tag[0] === 'lanacoin_txid');
          const participantTags = tags.filter((tag: string[]) => tag[0] === 'p');

          const userRole = event.pubkey === session.nostrHexId ? 'initiated' : 'participant';
          
          return {
            id: event.id,
            creatorPubkey: event.pubkey,
            content: event.content,
            status: statusTag?.[1] || 'unknown',
            lang: langTag?.[1] || 'en',
            participants: participantTags.map((tag: string[]) => tag[1]),
            topic: topicTag?.[1],
            triggerEventId: triggerTag?.[1],
            lanacoinTxid: txidTag?.[1],
            createdAt: event.created_at,
            userRole,
          };
        });

        // Sort by creation date, newest first
        parsedCases.sort((a, b) => b.createdAt - a.createdAt);

        setCases(parsedCases);
      } catch (error) {
        console.error('Error fetching OWN cases:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchCases();
  }, [parameters, session]);

  return { cases, isLoading };
};
