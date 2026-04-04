import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? '';

async function queryServer(filter: Record<string, any>, timeout = 15000): Promise<any[]> {
  const res = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, timeout }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

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

  useEffect(() => {
    if (!processRecordId) {
      setIsLoading(false);
      return;
    }

    const fetchTranscript = async () => {
      setIsLoading(true);
      setError(null);

      try {
        console.log('📄 [Transcript] Fetching KIND 87944 for process:', processRecordId);

        const cleanProcessId = processRecordId.replace(/^own:/, '');

        // Use server-side relay query (more reliable than browser SimplePool)
        const transcriptEvents = await queryServer({
          kinds: [87944],
          '#e': [cleanProcessId],
          limit: 1,
        });

        console.log('📄 [Transcript] Found events:', transcriptEvents.length);

        if (transcriptEvents.length === 0) {
          setError('Transcript not found');
          setIsLoading(false);
          return;
        }

        const event = transcriptEvents[0];
        const tags: string[][] = event.tags || [];

        const titleTag = tags.find(tag => tag[0] === 'title');
        const langTag = tags.find(tag => tag[0] === 'lang');
        const statusTag = tags.find(tag => tag[0] === 'status');
        const phaseTag = tags.find(tag => tag[0] === 'phase');
        const visibilityTag = tags.find(tag => tag[0] === 'visibility');
        const facilitatorTag = tags.find(tag => tag[0] === 'p' && tag[2] === 'facilitator');
        const processTag = tags.find(tag => tag[0] === 'e' && tag[2] === 'process');
        const recordTag = tags.find(tag => tag[0] === 'e' && tag[2] === 'record');

        let data: TranscriptData;
        try {
          data = JSON.parse(event.content);
        } catch {
          setError('Invalid transcript format');
          setIsLoading(false);
          return;
        }

        setTranscript({
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
        });
      } catch (err: any) {
        console.error('❌ [Transcript] Error:', err);
        setError(err.message || 'Failed to fetch transcript');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTranscript();
  }, [processRecordId]);

  return { transcript, isLoading, error };
};
