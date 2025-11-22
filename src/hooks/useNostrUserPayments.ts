import { useEffect, useState } from 'react';
import { SimplePool, Filter } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

interface UseNostrUserPaymentsResult {
  paidProcessIds: Set<string>;
  isLoading: boolean;
}

export const useNostrUserPayments = (): UseNostrUserPaymentsResult => {
  const [paidProcessIds, setPaidProcessIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  useEffect(() => {
    if (!session?.nostrHexId || !parameters?.relays) {
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    const relays = parameters.relays;

    const filter: Filter = {
      kinds: [90900],
      authors: [session.nostrHexId],
      limit: 1000,
    };

    const processIds = new Set<string>();

    const sub = pool.subscribeMany(relays, [filter] as any, {
      onevent: (event) => {
        // Find the ["e", <event_id>, "", "87044"] tag
        const processTag = event.tags.find(
          (tag) => tag[0] === 'e' && tag[3] === '87044'
        );
        
        if (processTag && processTag[1]) {
          processIds.add(processTag[1]);
        }
      },
      oneose: () => {
        setPaidProcessIds(new Set(processIds));
        setIsLoading(false);
        sub.close();
        pool.close(relays);
      },
    });

    const timeout = setTimeout(() => {
      setPaidProcessIds(new Set(processIds));
      setIsLoading(false);
      sub.close();
      pool.close(relays);
    }, 8000);

    return () => {
      clearTimeout(timeout);
      sub.close();
      pool.close(relays);
    };
  }, [session?.nostrHexId, parameters?.relays]);

  return { paidProcessIds, isLoading };
};
