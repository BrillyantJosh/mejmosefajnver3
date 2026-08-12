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
  /** From the 90900's billing_day tag — the obligation's cycle identity. */
  billingDay?: string;
  ref?: string;
  expires?: number;
  url?: string;
  content: string;
  createdAt: number;
  eventId: string;
  isPaid?: boolean;
  paymentTxId?: string;
  /** Set when isPaid was inherited from an older regenerated proposal set. */
  paidViaDTag?: string;
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
  // Fail-closed default: paid-state is unknown until a verified read says otherwise.
  const [paidStateUnknown, setPaidStateUnknown] = useState(true);
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

      // The server distinguishes "relays said empty" from "relays did not
      // answer": paidStateUnknown means the 90901 confirmation read was NOT
      // verified, so isPaid on these proposals cannot be trusted.
      const unknown = !!data?.paidStateUnknown;
      setPaidStateUnknown(unknown);
      if (unknown) {
        console.warn(`⚠ Paid-state unknown: ${data?.paidStateUnknownReason || 'relays unreachable'}`);
      }

      if (data?.proposals && data.proposals.length > 0) {
        console.log(`✅ Found ${data.proposals.length} donation proposals`);

        const parsedProposals: DonationProposal[] = data.proposals;

        // Only update state if data actually changed
        setProposals(prev => arraysEqual(parsedProposals, prev) ? prev : parsedProposals);
      } else if (!unknown) {
        // VERIFIED empty — clear (condition resolved)
        setProposals([]);
      }
      // unknown && empty → keep last known state; the flag blocks the UI anyway
    } catch (error) {
      console.error('❌ Error fetching donation proposals:', error);
      // Server unreachable — paid-state is unverifiable. Fail closed.
      setPaidStateUnknown(true);
      // Network error — keep last known good state after first load
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
    /**
     * True when the paid-state of the returned proposals could NOT be verified
     * (relays did not answer, or the server was unreachable). While true, no
     * proposal may be treated as payable — an unpaid look-alike might be paid.
     */
    paidStateUnknown,
    refetch: fetchProposals
  };
};
