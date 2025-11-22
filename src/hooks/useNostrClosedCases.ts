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
        console.log('🔍 Fetching KIND 37044 master process records...');
        
        // Step 1: Fetch all KIND 37044 events (broader query, no tag filter)
        const recordEvents = await pool.querySync(relays, {
          kinds: [37044],
          limit: 500
        });

        console.log(`📋 Found ${recordEvents.length} KIND 37044 events total`);

        // Step 2: Filter for closed status client-side
        const closedRecords = recordEvents.filter((event: NostrEvent) => {
          const statusTag = event.tags.find(tag => tag[0] === 'status');
          return statusTag?.[1] === 'closed';
        });

        console.log(`✅ Filtered to ${closedRecords.length} closed process records`);

        if (closedRecords.length === 0) {
          console.warn('No closed process records found');
          setClosedCases([]);
          setIsLoading(false);
          pool.close(relays);
          return;
        }

        // Step 3: Extract all referenced KIND 87044 IDs from "d" tags
        const processStartIds = closedRecords
          .map(e => e.tags.find(t => t[0] === 'd')?.[1])
          .filter(Boolean) as string[];

        const uniqueStartIds = Array.from(new Set(processStartIds));
        
        console.log(`🔗 Found ${uniqueStartIds.length} unique KIND 87044 references`);

        // Step 4: Fetch all KIND 87044 (process start) events
        const startEvents = uniqueStartIds.length > 0
          ? await pool.querySync(relays, {
              kinds: [87044],
              ids: uniqueStartIds
            })
          : [];

        console.log(`📥 Fetched ${startEvents.length} KIND 87044 start events`);

        // Step 5: Create a map for quick lookup
        const startById = new Map(startEvents.map(e => [e.id, e]));

        // Step 6: Merge KIND 37044 + KIND 87044 data into ClosedCase
        const cases: ClosedCase[] = closedRecords.map((record: NostrEvent) => {
          const dTag = record.tags.find(t => t[0] === 'd');
          const processId = dTag?.[1] || record.id;
          const start = processId ? startById.get(processId) : undefined;

          const statusTag = record.tags.find(t => t[0] === 'status');
          const langTagRecord = record.tags.find(t => t[0] === 'lang');
          const langTagStart = start?.tags.find(t => t[0] === 'lang');
          const topicTag = record.tags.find(t => t[0] === 'topic') || start?.tags.find(t => t[0] === 'topic');
          const openedAtTag = record.tags.find(t => t[0] === 'opened_at');
          const closedAtTag = record.tags.find(t => t[0] === 'closed_at');

          const participantsRecord = record.tags.filter(t => t[0] === 'p');
          const participants = participantsRecord.map(t => t[1]);

          const lang = langTagRecord?.[1] || langTagStart?.[1] || 'en';
          const closedAt = closedAtTag ? parseInt(closedAtTag[1]) : record.created_at;

          const initialContent = start?.content || '';
          const finalContent = record.content || '';

          const initiatorFromRoles = participantsRecord.find(t => t[3] === 'initiator');
          const initiatorPubkey = initiatorFromRoles?.[1] || start?.pubkey || record.pubkey;

          return {
            id: processId,              // = 87044 event id (critical for revenue share lookup)
            pubkey: initiatorPubkey,    // initiator pubkey
            content: finalContent || initialContent, // prefer final report, fallback to initial reason
            status: statusTag?.[1] || 'closed',
            lang,
            participants,
            topic: topicTag?.[1],
            triggerEventId: processId,
            lanacoinTxid: undefined,
            createdAt: closedAt,
          };
        });

        // Step 7: Sort by closed date, newest first
        cases.sort((a, b) => b.createdAt - a.createdAt);

        console.log(`🎯 Final closed cases: ${cases.length}`);
        if (cases.length > 0) {
          console.log('📄 Sample case:', {
            id: cases[0].id,
            topic: cases[0].topic,
            participants: cases[0].participants.length,
            content: cases[0].content.substring(0, 100)
          });
        }

        setClosedCases(cases);
      } catch (error) {
        console.error('❌ Error fetching closed cases:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchClosedCases();
  }, [parameters]);

  return { closedCases, isLoading };
};
