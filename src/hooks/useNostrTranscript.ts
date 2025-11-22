import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface TranscriptMessage {
  seq: number;
  timestamp: number;
  sender_pubkey: string;
  role: string;
  source_event_id: string;
  type: string;
  text: string;
  attachments: Array<{
    kind: string;
    url: string;
    ref_event_id?: string;
  }>;
}

export interface TranscriptData {
  summary?: string;
  opened_at: number;
  closed_at: number;
  messages: TranscriptMessage[];
}

export interface TranscriptEvent {
  id: string;
  title: string;
  lang?: string;
  status: string;
  phase: string;
  visibility: string;
  facilitatorPubkey: string;
  processEventId: string;
  recordEventId: string;
  data: TranscriptData;
  createdAt: number;
}

export const useNostrTranscript = (processRecordId: string | null) => {
  const [transcript, setTranscript] = useState<TranscriptEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchTranscript = async () => {
      if (!processRecordId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        console.log('📄 [Transcript] Fetching KIND 87944 for process:', processRecordId);
        
        // Fetch transcript (KIND 87944) - process ID might need "own:" prefix stripped
        const cleanProcessId = processRecordId.replace(/^own:/, '');
        
        const transcriptEvents = await pool.querySync(relays, {
          kinds: [87944],
          '#e': [cleanProcessId],
          limit: 1
        });

        console.log('📄 [Transcript] Found events:', transcriptEvents.length);

        if (transcriptEvents.length === 0) {
          setError('Transcript not found');
          setIsLoading(false);
          pool.close(relays);
          return;
        }

        const event = transcriptEvents[0];
        console.log('📄 [Transcript] Event:', event);

        // Parse tags
        const titleTag = event.tags.find(tag => tag[0] === 'title');
        const langTag = event.tags.find(tag => tag[0] === 'lang');
        const statusTag = event.tags.find(tag => tag[0] === 'status');
        const phaseTag = event.tags.find(tag => tag[0] === 'phase');
        const visibilityTag = event.tags.find(tag => tag[0] === 'visibility');
        const facilitatorTag = event.tags.find(tag => tag[0] === 'p' && tag[2] === 'facilitator');
        const processTag = event.tags.find(tag => tag[0] === 'e' && tag[2] === 'process');
        const recordTag = event.tags.find(tag => tag[0] === 'e' && tag[2] === 'record');

        // Parse content JSON
        let data: TranscriptData;
        try {
          data = JSON.parse(event.content);
          console.log('📄 [Transcript] Parsed data:', data);
        } catch (error) {
          console.error('❌ [Transcript] Failed to parse content:', error);
          setError('Invalid transcript format');
          setIsLoading(false);
          pool.close(relays);
          return;
        }

        const transcriptEvent: TranscriptEvent = {
          id: event.id,
          title: titleTag?.[1] || 'Untitled Transcript',
          lang: langTag?.[1],
          status: statusTag?.[1] || 'closed',
          phase: phaseTag?.[1] || 'resolution',
          visibility: visibilityTag?.[1] || 'public',
          facilitatorPubkey: facilitatorTag?.[1] || '',
          processEventId: processTag?.[1] || '',
          recordEventId: recordTag?.[1] || '',
          data,
          createdAt: event.created_at,
        };

        console.log('✅ [Transcript] Successfully loaded:', transcriptEvent);
        setTranscript(transcriptEvent);
      } catch (error: any) {
        console.error('❌ [Transcript] Error:', error);
        setError(error.message || 'Failed to fetch transcript');
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchTranscript();
  }, [processRecordId, parameters]);

  return { transcript, isLoading, error };
};
