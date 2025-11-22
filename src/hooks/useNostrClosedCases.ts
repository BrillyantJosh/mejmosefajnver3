import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface ClosedCase {
  id: string;
  pubkey: string;
  content: string;
  status: string;
  lang: string;
  participants: string[];
  topic?: string;
  triggerEventId?: string;
  lanacoinTxid?: string;
  createdAt: number;
}

export const useNostrClosedCases = () => {
  const [closedCases, setClosedCases] = useState<ClosedCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchClosedCases = async () => {
      if (!parameters?.relays || parameters.relays.length === 0) {
        console.warn('No relays available');
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        // Fetch KIND 37044 (master process record) with status="closed"
        const events = await pool.querySync(relays, {
          kinds: [37044],
          '#status': ['closed'],
          limit: 100
        });

        const cases: ClosedCase[] = events.map((event: NostrEvent) => {
          const statusTag = event.tags.find((tag) => tag[0] === 'status');
          const langTag = event.tags.find((tag) => tag[0] === 'lang');
          const participantTags = event.tags.filter((tag) => tag[0] === 'p');
          const topicTag = event.tags.find((tag) => tag[0] === 'topic');
          const dTag = event.tags.find((tag) => tag[0] === 'd'); // References 87044 event
          const txidTag = event.tags.find((tag) => tag[0] === 'lanacoin_txid');
          const closedAtTag = event.tags.find((tag) => tag[0] === 'closed_at');

          return {
            id: dTag?.[1] || event.id, // Use the referenced 87044 ID if available
            pubkey: event.pubkey,
            content: event.content,
            status: statusTag?.[1] || 'closed',
            lang: langTag?.[1] || 'en',
            participants: participantTags.map((tag) => tag[1]),
            topic: topicTag?.[1],
            triggerEventId: dTag?.[1], // Reference to original 87044 event
            lanacoinTxid: txidTag?.[1],
            createdAt: closedAtTag ? parseInt(closedAtTag[1]) : event.created_at,
          };
        });

        // Sort by creation date, newest first
        cases.sort((a, b) => b.createdAt - a.createdAt);

        setClosedCases(cases);
      } catch (error) {
        console.error('Error fetching closed cases:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchClosedCases();
  }, [parameters]);

  return { closedCases, isLoading };
};
