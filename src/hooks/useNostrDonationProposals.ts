import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { arraysEqual } from '@/lib/arrayComparison';

export interface DonationProposal {
  id: string;
  d: string;
  payerPubkey: string;
  recipientPubkey: string;
  wallet: string;
  fiatCurrency: string;
  fiatAmount: string;
  lanaAmount: string;
  lanoshiAmount: string;
  service: string;
  type: string;
  ref?: string;
  expires?: number;
  url?: string;
  content: string;
  createdAt: number;
  eventId: string;
  isPaid?: boolean;
  paymentTxId?: string;
}

export interface UseNostrDonationProposalsOptions {
  poll?: boolean;
  pollIntervalMs?: number;
  enabled?: boolean;
}

export const useNostrDonationProposals = (
  userPubkey?: string,
  options: UseNostrDonationProposalsOptions = {}
) => {
  const { poll = true, pollIntervalMs = 10000, enabled = true } = options;
  const [proposals, setProposals] = useState<DonationProposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const fetchStartedRef = useRef(false);

  const fetchProposals = useCallback(async () => {
    if (!enabled) {
      return;
    }

    // Loading indicator only for initial load
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }

    try {
      console.log('📥 Fetching KIND 90900 donation proposals via server...');

      const { data, error } = await supabase.functions.invoke('fetch-donation-proposals', {
        body: { userPubkey }
      });

      if (error) throw error;

      if (data?.proposals && data.proposals.length > 0) {
        console.log(`✅ Found ${data.proposals.length} donation proposals`);

        const parsedProposals: DonationProposal[] = data.proposals;

        // Only update state if data actually changed
        setProposals(prev => arraysEqual(parsedProposals, prev) ? prev : parsedProposals);
      } else {
        // Only clear if this is the initial load
        if (!hasLoadedOnceRef.current) {
          setProposals([]);
        }
      }
    } catch (error) {
      console.error('❌ Error fetching donation proposals:', error);
      // DO NOT clear proposals after first successful load - keep last known good state
      if (!hasLoadedOnceRef.current) {
        setProposals([]);
      }
    } finally {
      if (!hasLoadedOnceRef.current) {
        setIsLoading(false);
        hasLoadedOnceRef.current = true;
      }
    }
  }, [enabled, userPubkey]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    // Only fetch once when enabled (unless polling)
    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchProposals();
    }

    // Only set up polling if poll option is true
    let interval: NodeJS.Timeout | undefined;
    if (poll && enabled) {
      interval = setInterval(fetchProposals, pollIntervalMs);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [enabled, poll, pollIntervalMs, fetchProposals]);

  // Reset refs when enabled changes to false
  useEffect(() => {
    if (!enabled) {
      fetchStartedRef.current = false;
      hasLoadedOnceRef.current = false;
    }
  }, [enabled]);

  return {
    proposals,
    isLoading: enabled ? isLoading : false,
    refetch: fetchProposals
  };
};
