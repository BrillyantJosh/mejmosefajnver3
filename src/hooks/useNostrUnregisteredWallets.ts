import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Filter } from 'nostr-tools';
import { readFromRelays } from '@/lib/relayRead';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface UnregisteredWallet {
  address: string;
  note: string;
}

export interface UnregisteredWalletList {
  eventId: string;
  pubkey: string;
  ownerPubkey: string;
  createdAt: number;
  status: string;
  wallets: UnregisteredWallet[];
}

export function useNostrUnregisteredWallets() {
  const [lists, setLists] = useState<UnregisteredWalletList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  const fetchLists = useCallback(async () => {
    if (!parameters?.relays || parameters.relays.length === 0) {
      console.warn('No relays available');
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    const relays = parameters.relays;

    try {
      console.log('🔄 Fetching KIND 30289 (Unregistered Wallet Lists)...');

      const filter: Filter = {
        kinds: [30289],
        limit: 100
      };

      // readFromRelays, not pool.querySync: these lists are wallets, and a list
      // that came back short is one a person will add again by hand, believing
      // it lost. nostr-tools invents an EOSE 4.4 s after the subscription opens
      // and discards every event still queued behind it, and counts a relay that
      // never connected as having answered — so both a slow phone and a dead
      // network arrive here as a short, confident list.
      const read = await readFromRelays(pool, relays, filter, { budgetMs: 15000 });
      const events = read.events;

      if (read.answered.length === 0) {
        console.warn(
          `📡 No relay answered for KIND 30289 (${read.failed.map((f) => `${f.url}: ${f.reason}`).join(' | ')}) — keeping the lists already on screen`,
        );
        return;
      }

      console.log(`✅ Fetched ${events.length} unregistered wallet list events from ${read.answered.length}/${relays.length} relays`);

      // Process events
      const processedLists: UnregisteredWalletList[] = [];

      for (const event of events) {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1];
        const pTag = event.tags.find(t => t[0] === 'p')?.[1];
        const statusTag = event.tags.find(t => t[0] === 'status')?.[1];

        if (!dTag || !pTag || statusTag !== 'active') continue;

        const wallets: UnregisteredWallet[] = event.tags
          .filter(t => t[0] === 'w' && t.length >= 3)
          .map(t => ({
            address: t[1],
            note: t[2] || ''
          }));

        processedLists.push({
          eventId: event.id,
          pubkey: event.pubkey,
          ownerPubkey: dTag,
          createdAt: event.created_at,
          status: statusTag,
          wallets
        });
      }

      // Sort by creation date (newest first)
      processedLists.sort((a, b) => b.createdAt - a.createdAt);

      setLists(processedLists);
      console.log(`📊 Processed ${processedLists.length} valid wallet lists`);

    } catch (error) {
      console.error('❌ Error fetching unregistered wallet lists:', error);
    } finally {
      pool.close(relays);
      setIsLoading(false);
    }
  }, [parameters]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  return { lists, isLoading, refetch: fetchLists };
}
