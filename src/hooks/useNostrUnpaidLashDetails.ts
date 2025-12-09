import { useState, useEffect, useRef, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { isLashExpired } from '@/lib/lashExpiration';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export interface UnpaidLashDetail {
  lashId: string; // "lash:uuid"
  eventId: string; // event ID for deletion
  recipientPubkey: string;
  recipientName?: string;
  recipientDisplayName?: string;
  recipientWallet: string;
  fromWallet: string;
  amount: string; // lanoshis
  amountLana: string; // LANA (amount / 100000000)
  memo?: string;
  createdAt: number; // Unix timestamp
  postId?: string; // if linked to a post
}

export const useNostrUnpaidLashDetails = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [allUnpaidLashes, setAllUnpaidLashes] = useState<UnpaidLashDetail[]>([]);
  const [displayedLashes, setDisplayedLashes] = useState<UnpaidLashDetail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(true);
  const profileCache = useRef<Map<string, { name?: string; display_name?: string }>>(new Map());
  
  const ITEMS_PER_PAGE = 20;

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  const fetchRecipientProfile = async (pool: SimplePool, pubkey: string) => {
    // Check cache first
    if (profileCache.current.has(pubkey)) {
      return profileCache.current.get(pubkey)!;
    }

    try {
      const profileEvents = await pool.querySync(relays, {
        kinds: [0],
        authors: [pubkey],
        limit: 1
      });

      if (profileEvents.length > 0) {
        const content = JSON.parse(profileEvents[0].content);
        const profile = {
          name: content.name,
          display_name: content.display_name
        };
        profileCache.current.set(pubkey, profile);
        return profile;
      }
    } catch (error) {
      console.error('Error fetching recipient profile:', error);
    }

    return {};
  };

  const fetchUnpaidLashDetails = useCallback(async () => {
    if (!session?.nostrHexId) {
      setAllUnpaidLashes([]);
      setDisplayedLashes([]);
      return;
    }

    setIsLoading(true);
    const pool = new SimplePool();

    try {
      // Fetch all payment records (KIND 39991) by this user
      const paymentRecords = await pool.querySync(relays, {
        kinds: [39991],
        authors: [session.nostrHexId],
        limit: 1000
      });

      // Filter out expired and paid records
      const activeRecords = paymentRecords.filter(event => {
        if (isLashExpired(event)) return false;
        const stateTag = event.tags.find(tag => tag[0] === 'state');
        return stateTag?.[1] !== 'paid'; // Exclude paid records
      });

      console.log(`📤 Found payment records: ${paymentRecords.length} total, ${activeRecords.length} active (non-expired, unpaid)`);

      if (activeRecords.length === 0) {
        setAllUnpaidLashes([]);
        setDisplayedLashes([]);
        setIsLoading(false);
        pool.close(relays);
        return;
      }

      console.log('💰 Unpaid payment records:', activeRecords.length);

      // Create detailed unpaid lash objects
      const detailsPromises = activeRecords.map(async (event) => {
        const lashId = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const recipientPubkey = event.tags.find(tag => tag[0] === 'p')?.[1] || '';
        const amount = event.tags.find(tag => tag[0] === 'amount')?.[1] || '0';
        const fromWallet = event.tags.find(tag => tag[0] === 'from_wallet')?.[1] || '';
        const toWallet = event.tags.find(tag => tag[0] === 'to_wallet')?.[1] || '';
        const memo = event.tags.find(tag => tag[0] === 'memo')?.[1];
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];

        // Fetch recipient profile
        const profile = await fetchRecipientProfile(pool, recipientPubkey);

        const amountNum = parseInt(amount);
        const amountLana = (amountNum / 100000000).toFixed(8);

        return {
          lashId,
          eventId: event.id,
          recipientPubkey,
          recipientName: profile.name,
          recipientDisplayName: profile.display_name,
          recipientWallet: toWallet,
          fromWallet,
          amount,
          amountLana,
          memo,
          createdAt: event.created_at,
          postId
        };
      });

      const details = await Promise.all(detailsPromises);
      
      // Sort by created_at descending (newest first)
      details.sort((a, b) => b.createdAt - a.createdAt);

      setAllUnpaidLashes(details);
      // Show first page by default
      setDisplayedLashes(details.slice(0, ITEMS_PER_PAGE));
    } catch (error) {
      console.error('❌ Error fetching unpaid lash details:', error);
      setAllUnpaidLashes([]);
      setDisplayedLashes([]);
    } finally {
      setIsLoading(false);
      pool.close(relays);
    }
  }, [session?.nostrHexId, relays]);

  const loadPage = useCallback((page: number) => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedLashes(allUnpaidLashes.slice(startIndex, endIndex));
    setCurrentPage(page);
  }, [allUnpaidLashes]);

  const totalPages = Math.ceil(allUnpaidLashes.length / ITEMS_PER_PAGE);

  const removeLashFromList = useCallback((lashId: string) => {
    setAllUnpaidLashes(prev => {
      const filtered = prev.filter(l => l.lashId !== lashId);
      // Update displayed lashes for current page
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      setDisplayedLashes(filtered.slice(startIndex, endIndex));
      return filtered;
    });
  }, [currentPage]);

  useEffect(() => {
    fetchUnpaidLashDetails();

    // Only auto-refresh if enabled
    let interval: NodeJS.Timeout | null = null;
    if (isAutoRefreshEnabled) {
      interval = setInterval(fetchUnpaidLashDetails, 15000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchUnpaidLashDetails, isAutoRefreshEnabled]);

  return { 
    displayedLashes,  // ✅ Paginated view
    allLashes: allUnpaidLashes,  // ✅ All unpaid lashes for batch send
    totalLashes: allUnpaidLashes.length,
    isLoading,
    currentPage,
    totalPages,
    loadPage,
    removeLashFromList,
    setAutoRefreshEnabled: setIsAutoRefreshEnabled,
    refetch: fetchUnpaidLashDetails 
  };
};
