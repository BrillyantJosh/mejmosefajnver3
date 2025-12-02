import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface OpenProcess {
  id: string;
  processEventId: string;
  title: string;
  status: string;
  phase: string;
  openedAt: number;
  initiator: string;
  facilitator: string;
  participants: string[];
  guests: string[];
  language: string;
  topic?: string;
  userRole?: string;
}

export const useNostrOpenProcesses = (userPubkey: string | null) => {
  const [processes, setProcesses] = useState<OpenProcess[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!userPubkey || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const fetchProcesses = async () => {
      const pool = new SimplePool();
      
      try {
        console.log('🔍 Fetching KIND 37044 (open processes)...', {
          userPubkey: userPubkey.slice(0, 16) + '...',
          relays: parameters.relays
        });
        
        const filter: Filter = {
          kinds: [37044],
          limit: 100
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`📦 Found ${events.length} KIND 37044 events`);
        
        if (events.length === 0) {
          console.warn('⚠️ No KIND 37044 events found on any relay. User may not have any open processes.');
        }

        // Process and filter events
        const processedEvents: OpenProcess[] = events
          .map((event: Event) => {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
            const status = event.tags.find(t => t[0] === 'status')?.[1] || '';
            const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
            const phase = event.tags.find(t => t[0] === 'phase')?.[1] || 'opening';
            const openedAt = parseInt(event.tags.find(t => t[0] === 'opened_at')?.[1] || '0');
            const language = event.tags.find(t => t[0] === 'lang')?.[1] || 'en';
            const topic = event.tags.find(t => t[0] === 'topic')?.[1];
            
            // Find process event reference (root event)
            // Priority: 1) e-tag with 'process'/'root' marker, 2) d-tag (should equal KIND 87044 ID), 3) event.id
            const eTagProcessId = event.tags.find(t => t[0] === 'e' && (t[3] === 'root' || t[2] === 'process'))?.[1];
            const processEventId = eTagProcessId || dTag;
            
            console.log('📋 Process event:', {
              eventId: event.id.slice(0, 16),
              dTag: dTag.slice(0, 16),
              eTagProcessId: eTagProcessId ? eTagProcessId.slice(0, 16) : 'NONE',
              finalProcessEventId: processEventId.slice(0, 16),
              title: title || 'Untitled',
              status
            });

            // Extract roles - check both index 2 and 3 for compatibility
            const getRole = (tag: string[]) => tag[3] || tag[2];
            const initiator = event.tags.find(t => t[0] === 'p' && (t[2] === 'initiator' || t[3] === 'initiator'))?.[1] || '';
            const facilitator = event.tags.find(t => t[0] === 'p' && (t[2] === 'facilitator' || t[3] === 'facilitator'))?.[1] || '';
            const participants = event.tags.filter(t => t[0] === 'p' && (t[2] === 'participant' || t[3] === 'participant')).map(t => t[1]);
            const guests = event.tags.filter(t => t[0] === 'p' && (t[2] === 'guest' || t[3] === 'guest')).map(t => t[1]);

            // Check if user is in any role
            let userRole: string | undefined;
            if (initiator === userPubkey) userRole = 'initiator';
            else if (facilitator === userPubkey) userRole = 'facilitator';
            else if (participants.includes(userPubkey)) userRole = 'participant';
            else if (guests.includes(userPubkey)) userRole = 'guest';

            return {
              id: dTag,
              processEventId,
              title,
              status,
              phase,
              openedAt,
              initiator,
              facilitator,
              participants,
              guests,
              language,
              topic,
              userRole
            };
          })
          .filter(process => 
            process.status === 'open' && 
            process.userRole !== undefined
          )
          .sort((a, b) => b.openedAt - a.openedAt);

        console.log(`✅ Filtered to ${processedEvents.length} open processes where user is involved`);
        
        if (processedEvents.length === 0 && events.length > 0) {
          console.warn('⚠️ Found KIND 37044 events but none where user has a role:', {
            totalEvents: events.length,
            userPubkey: userPubkey.slice(0, 16),
            sampleEvent: events[0] ? {
              id: events[0].id.slice(0, 16),
              tags: events[0].tags.filter(t => t[0] === 'p')
            } : null
          });
        }
        
        setProcesses(processedEvents);
        
      } catch (error) {
        console.error('Error fetching open processes:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchProcesses();
  }, [userPubkey, parameters?.relays]);

  return { processes, isLoading };
};
