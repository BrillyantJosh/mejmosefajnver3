import { useState, useEffect, useCallback } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface NostrWallet {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
}

export const useNostrWallets = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [wallets, setWallets] = useState<NostrWallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const relays = parameters?.relays || [];

  const fetchWallets = useCallback(async () => {
    if (!session?.nostrHexId || relays.length === 0) {
      setIsLoading(false);
      return;
    }

    const pool = new SimplePool();
    
    try {
      console.log('Fetching wallet records (KIND 30889) for:', session.nostrHexId);
      
      // Fetch wallet list events - KIND 30889 (Registrar Wallet List)
      // Query by #d tag (customer pubkey) to get all registrar records for this customer
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [30889],
          '#d': [session.nostrHexId],
        }),
        new Promise<Event[]>((_, reject) => 
          setTimeout(() => reject(new Error('Wallet fetch timeout')), 10000)
        )
      ]) as Event[];

      if (events && events.length > 0) {
        console.log('Found wallet list events:', events.length);
        
        // Filter events to only include those from LanaRegistrar trusted signers
        const lanaRegistrarSigners = parameters?.trustedSigners?.LanaRegistrar || [];
        
        // If no trusted signers are configured, allow all events (for development/testing)
        const filteredEvents = lanaRegistrarSigners.length === 0 
          ? events 
          : events.filter(event => {
              const isAuthorized = lanaRegistrarSigners.includes(event.pubkey);
              if (!isAuthorized) {
                console.log(`Filtered out event from unauthorized pubkey: ${event.pubkey}`);
              }
              return isAuthorized;
            });
        
        console.log(`Using ${filteredEvents.length} wallet events (${lanaRegistrarSigners.length} trusted signers configured)`);
        
        const allWallets: NostrWallet[] = [];
        
        // Process each event (one per registrar)
        filteredEvents.forEach(event => {
          const statusTag = event.tags.find(t => t[0] === 'status');
          const status = statusTag?.[1] || 'active';
          
          // Extract all wallet ("w") tags
          const walletTags = event.tags.filter(t => t[0] === 'w');
          
          walletTags.forEach(tag => {
            // w tag format: ["w", wallet_id, wallet_type, "LANA", note, amount_unregistered_lanoshi]
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

        // Sort by creation date, newest first
        allWallets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        // Deduplicate wallets by walletId, keeping only the latest (first) record
        const uniqueWallets = Array.from(
          new Map(allWallets.map(wallet => [wallet.walletId, wallet])).values()
        );
        
        setWallets(uniqueWallets);
        console.log('Wallets loaded (deduplicated):', uniqueWallets);
      } else {
        setWallets([]);
        console.log('No wallet records found');
      }
    } catch (error) {
      console.error('Error fetching wallets:', error);
      setWallets([]);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [session?.nostrHexId, relays, parameters]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  return {
    wallets,
    isLoading,
    refetch: fetchWallets
  };
};
