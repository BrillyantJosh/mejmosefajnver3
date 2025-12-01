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
        console.log('Fetching KIND 37044 (open processes)...');
        
        const filter: Filter = {
          kinds: [37044],
          limit: 100
        };

        const events = await pool.querySync(parameters.relays, filter);
        
        console.log(`Found ${events.length} KIND 37044 events`);

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
            
            // Find process event reference
            const processEventId = event.tags.find(t => t[0] === 'e' && t[2] === 'process')?.[1] || '';

            // Extract roles
            const initiator = event.tags.find(t => t[0] === 'p' && t[2] === 'initiator')?.[1] || '';
            const facilitator = event.tags.find(t => t[0] === 'p' && t[2] === 'facilitator')?.[1] || '';
            const participants = event.tags.filter(t => t[0] === 'p' && t[2] === 'participant').map(t => t[1]);
            const guests = event.tags.filter(t => t[0] === 'p' && t[2] === 'guest').map(t => t[1]);

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

        console.log(`Filtered to ${processedEvents.length} open processes where user is involved`);
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
