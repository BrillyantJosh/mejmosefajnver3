import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface NostrUserWallet {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
  freezeStatus?: string;  // per-wallet freeze: '' | 'frozen_l8w' | 'frozen_max_cap' | 'frozen_too_wild'
}

export const useNostrUserWallets = (pubkey: string | null) => {
  const { parameters } = useSystemParameters();
  const [wallets, setWallets] = useState<NostrUserWallet[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const relays = parameters?.relays || [];

  useEffect(() => {
    const fetchWallets = async () => {
      if (!pubkey || relays.length === 0) {
        setWallets([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const pool = new SimplePool();
      
      try {
        console.log('Fetching wallet records (KIND 30889) for pubkey:', pubkey);
        
        // Query by both #d and #p for robust matching (registrars use different d-tag formats)
        const [eventsByD, eventsByWalletD, eventsByP] = await Promise.race([
          Promise.all([
            pool.querySync(relays, { kinds: [30889], '#d': [pubkey] }),
            pool.querySync(relays, { kinds: [30889], '#d': [`wallet-list-${pubkey}`] }),
            pool.querySync(relays, { kinds: [30889], '#p': [pubkey] }),
          ]),
          new Promise<[Event[], Event[], Event[]]>((_, reject) =>
            setTimeout(() => reject(new Error('Wallet fetch timeout')), 10000)
          )
        ]) as [Event[], Event[], Event[]];

        // Merge and deduplicate by event id
        const eventMap = new Map<string, Event>();
        [...eventsByD, ...eventsByWalletD, ...eventsByP].forEach(e => eventMap.set(e.id, e));
        const events = Array.from(eventMap.values());

        if (events && events.length > 0) {
          console.log('Found wallet list events:', events.length);
          
          const lanaRegistrarSigners = parameters?.trustedSigners?.LanaRegistrar || [];

          const filteredEvents = lanaRegistrarSigners.length === 0
            ? events
            : events.filter(event => lanaRegistrarSigners.includes(event.pubkey));

          // Only keep events that have w tags (wallet-list events)
          const walletListEvents = filteredEvents.filter(event =>
            event.tags.some(t => t[0] === 'w')
          );

          if (walletListEvents.length === 0) {
            setWallets([]);
            console.log('No wallet-list events found');
            return;
          }

          // CRITICAL: Use ONLY the newest wallet-list event.
          // The latest event from a trusted registrar is the authoritative wallet list.
          // Merging wallets from multiple events causes stale/old wallets to appear.
          walletListEvents.sort((a, b) => b.created_at - a.created_at);
          const latestEvent = walletListEvents[0];

          console.log(`Using latest event: ${latestEvent.id} (created_at: ${latestEvent.created_at})`);

          const statusTag = latestEvent.tags.find(t => t[0] === 'status');
          const status = statusTag?.[1] || 'active';
          const isAccountFrozen = status === 'frozen';

          const walletTags = latestEvent.tags.filter(t => t[0] === 'w');
          const parsedWallets: NostrUserWallet[] = [];

          walletTags.forEach(tag => {
            if (tag.length >= 6) {
              // 7th field (index 6) is optional freeze_status
              const perWalletFreeze = tag.length >= 7 ? (tag[6] || '') : '';
              let freezeStatus = '';
              if (isAccountFrozen) {
                freezeStatus = perWalletFreeze || 'frozen';
              } else if (perWalletFreeze) {
                freezeStatus = perWalletFreeze;
              }

              parsedWallets.push({
                walletId: tag[1],
                walletType: tag[2],
                note: tag[4] || '',
                amountUnregistered: tag[5],
                status: status,
                freezeStatus,
                registrarPubkey: latestEvent.pubkey,
                eventId: latestEvent.id,
                createdAt: latestEvent.created_at
              });
            }
          });

          setWallets(parsedWallets);
          console.log('Wallets loaded from latest event:', parsedWallets.length, 'wallets, status:', status);
        } else {
          setWallets([]);
          console.log('No wallet records found for this user');
        }
      } catch (error) {
        console.error('Error fetching wallets:', error);
        setWallets([]);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchWallets();
  }, [pubkey, relays.join(',')]);  // Only depend on pubkey and relays string

  return {
    wallets,
    isLoading
  };
};
