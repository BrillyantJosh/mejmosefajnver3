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
        
        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [30889],
            '#d': [pubkey],
          }),
          new Promise<Event[]>((_, reject) => 
            setTimeout(() => reject(new Error('Wallet fetch timeout')), 10000)
          )
        ]) as Event[];

        if (events && events.length > 0) {
          console.log('Found wallet list events:', events.length);
          
          const lanaRegistrarSigners = parameters?.trustedSigners?.LanaRegistrar || [];
          
          const filteredEvents = lanaRegistrarSigners.length === 0 
            ? events 
            : events.filter(event => lanaRegistrarSigners.includes(event.pubkey));
          
          const allWallets: NostrUserWallet[] = [];
          
          filteredEvents.forEach(event => {
            const statusTag = event.tags.find(t => t[0] === 'status');
            const status = statusTag?.[1] || 'active';
            
            const walletTags = event.tags.filter(t => t[0] === 'w');
            
            walletTags.forEach(tag => {
              if (tag.length >= 6) {
                allWallets.push({
                  walletId: tag[1],
                  walletType: tag[2],
                  note: tag[4] || '',
                  amountUnregistered: tag[5],
                  status: status,
                  registrarPubkey: event.pubkey,
                  eventId: event.id,
                  createdAt: event.created_at
                });
              }
            });
          });

          allWallets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          
          const uniqueWallets = Array.from(
            new Map(allWallets.map(wallet => [wallet.walletId, wallet])).values()
          );
          
          setWallets(uniqueWallets);
          console.log('Wallets loaded for user:', uniqueWallets);
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
