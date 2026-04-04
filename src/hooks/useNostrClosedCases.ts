import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface ParticipantWithRole {
  pubkey: string;
  role: 'initiator' | 'facilitator' | 'participant' | 'guest';
}

export interface ClosedCase {
  id: string;
  recordId: string;
  pubkey: string;
  content: string;
  status: string;
  lang: string;
  participants: string[];
  participantRoles: ParticipantWithRole[];
  title?: string;
  topic?: string;
  triggerEventId?: string;
  lanacoinTxid?: string;
  startedAt: number;
  closedAt: number;
  initialContent: string;
}

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

export const useNostrClosedCases = () => {
  const [closedCases, setClosedCases] = useState<ClosedCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchClosedCases = async () => {
      try {
        console.log('🔍 Fetching KIND 37044 master process records via server...');

        // Step 1: Fetch all KIND 37044 events via server-side relay query
        const recordEvents = await queryServer({ kinds: [37044], limit: 500 });

        console.log(`📋 Found ${recordEvents.length} KIND 37044 events total`);

        // Step 2: Filter for closed status client-side
        const closedRecords = recordEvents.filter((event: any) => {
          const statusTag = event.tags?.find((tag: string[]) => tag[0] === 'status');
          return statusTag?.[1] === 'closed';
        });

        console.log(`✅ Filtered to ${closedRecords.length} closed process records`);

        if (closedRecords.length === 0) {
          setClosedCases([]);
          setIsLoading(false);
          return;
        }

        // Step 3: Extract referenced KIND 87044 IDs
        const processStartIds = closedRecords
          .map((e: any) => e.tags?.find((t: string[]) => t[0] === 'd')?.[1])
          .filter(Boolean) as string[];

        const uniqueStartIds = Array.from(new Set(processStartIds));

        // Step 4: Fetch KIND 87044 (process start) events
        const startEvents = uniqueStartIds.length > 0
          ? await queryServer({ kinds: [87044], ids: uniqueStartIds })
          : [];

        console.log(`📥 Fetched ${startEvents.length} KIND 87044 start events`);

        // Step 5: Create lookup map
        const startById = new Map(startEvents.map((e: any) => [e.id, e]));

        // Step 6: Merge into ClosedCase objects
        const cases: ClosedCase[] = closedRecords.map((record: any) => {
          const tags: string[][] = record.tags || [];
          const dTag = tags.find(t => t[0] === 'd');
          const processId = dTag?.[1] || record.id;
          const start = processId ? startById.get(processId) : undefined;
          const startTags: string[][] = start?.tags || [];

          const statusTag = tags.find(t => t[0] === 'status');
          const titleTag = tags.find(t => t[0] === 'title');
          const langTagRecord = tags.find(t => t[0] === 'lang');
          const langTagStart = startTags.find(t => t[0] === 'lang');
          const topicTag = tags.find(t => t[0] === 'topic') || startTags.find(t => t[0] === 'topic');
          const openedAtTag = tags.find(t => t[0] === 'opened_at');
          const closedAtTag = tags.find(t => t[0] === 'closed_at');

          const participantsRecord = tags.filter(t => t[0] === 'p');
          const participants = participantsRecord.map(t => t[1]);
          const participantRoles: ParticipantWithRole[] = participantsRecord.map(t => ({
            pubkey: t[1],
            role: (t[3] || 'participant') as ParticipantWithRole['role'],
          }));

          const lang = langTagRecord?.[1] || langTagStart?.[1] || 'en';
          const closedAt = closedAtTag ? parseInt(closedAtTag[1]) : record.created_at;
          const startedAt = start?.created_at || (openedAtTag ? parseInt(openedAtTag[1]) : closedAt);

          const initialContent = start?.content || '';
          const finalContent = record.content || '';

          const initiatorFromRoles = participantsRecord.find(t => t[3] === 'initiator');
          const initiatorPubkey = initiatorFromRoles?.[1] || start?.pubkey || record.pubkey;

          return {
            id: processId,
            recordId: record.id,
            pubkey: initiatorPubkey,
            content: finalContent || initialContent,
            status: statusTag?.[1] || 'closed',
            lang,
            participants,
            participantRoles,
            title: titleTag?.[1],
            topic: topicTag?.[1],
            triggerEventId: processId,
            lanacoinTxid: undefined,
            startedAt,
            closedAt,
            initialContent,
          };
        });

        // Step 7: Check which cases have KIND 87944 transcripts
        // Only show cases that have a published transcript
        const caseIds = cases.map(c => c.id.replace(/^own:/, ''));
        const transcriptEvents = caseIds.length > 0
          ? await queryServer({ kinds: [87944], '#e': caseIds, limit: 500 })
          : [];

        // Build a map: processId → roles from transcript messages
        const transcriptRolesMap = new Map<string, ParticipantWithRole[]>();
        const transcriptProcessIds = new Set<string>();

        for (const evt of transcriptEvents) {
          const eTags = (evt.tags || []).filter((t: string[]) => t[0] === 'e');
          const processId = eTags[0]?.[1];
          if (processId) transcriptProcessIds.add(processId);

          // Extract roles from transcript content messages
          try {
            const content = JSON.parse(evt.content);
            const roleMap = new Map<string, string>();
            for (const msg of (content.messages || [])) {
              if (msg.sender_pubkey && msg.role && !roleMap.has(msg.sender_pubkey)) {
                roleMap.set(msg.sender_pubkey, msg.role);
              }
            }
            if (processId && roleMap.size > 0) {
              const roles: ParticipantWithRole[] = Array.from(roleMap.entries()).map(([pubkey, role]) => ({
                pubkey,
                role: role as ParticipantWithRole['role'],
              }));
              transcriptRolesMap.set(processId, roles);
            }
          } catch {}
        }

        const casesWithTranscript = cases
          .filter(c => {
            const cleanId = c.id.replace(/^own:/, '');
            return transcriptProcessIds.has(cleanId);
          })
          .map(c => {
            // Merge: transcript roles (accurate) + remaining p-tag pubkeys (as guests)
            const cleanId = c.id.replace(/^own:/, '');
            const transcriptRoles = transcriptRolesMap.get(cleanId);
            if (transcriptRoles && transcriptRoles.length > 0) {
              const knownPubkeys = new Set(transcriptRoles.map(r => r.pubkey));
              // Add any p-tag pubkeys NOT in transcript as guests
              const remaining = c.participants
                .filter(pk => !knownPubkeys.has(pk))
                .map(pk => ({ pubkey: pk, role: 'guest' as ParticipantWithRole['role'] }));
              return { ...c, participantRoles: [...transcriptRoles, ...remaining] };
            }
            return c;
          });

        // Sort by closed date, newest first
        casesWithTranscript.sort((a, b) => b.closedAt - a.closedAt);

        console.log(`🎯 Closed cases: ${cases.length} total, ${casesWithTranscript.length} with transcript`);
        setClosedCases(casesWithTranscript);
      } catch (error) {
        console.error('❌ Error fetching closed cases:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchClosedCases();
  }, []);

  return { closedCases, isLoading };
};
