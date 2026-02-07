import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { arraysEqual } from '@/lib/arrayComparison';

export interface DonationPayment {
  id: string;
  proposalDTag: string;
  recipientPubkey: string;
  fromWallet: string;
  toWallet: string;
  amountLana: string;
  amountLanoshi: string;
  fiatCurrency: string;
  fiatAmount: string;
  txId: string;
  service: string;
  timestampPaid: number;
  proposalEventId: string;
  type: string;
  content: string;
  createdAt: number;
}

export interface UseNostrDonationPaymentsOptions {
  poll?: boolean;
  pollIntervalMs?: number;
  enabled?: boolean;
}

export const useNostrDonationPayments = (
  options: UseNostrDonationPaymentsOptions = {}
) => {
  const { poll = true, pollIntervalMs = 5000, enabled = true } = options;
  const [payments, setPayments] = useState<DonationPayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const fetchStartedRef = useRef(false);

  const fetchPayments = useCallback(async () => {
    if (!enabled) {
      return;
    }

    // Loading indicator only for initial load
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }

    try {
      console.log('📥 Fetching KIND 90901 donation payments via server...');

      const { data, error } = await supabase.functions.invoke('fetch-donation-payments', {
        body: {}
      });

      if (error) throw error;

      if (data?.payments && data.payments.length > 0) {
        console.log(`✅ Found ${data.payments.length} donation payments`);

        const parsedPayments: DonationPayment[] = data.payments;

        // Only update state if data actually changed
        setPayments(prev => arraysEqual(parsedPayments, prev) ? prev : parsedPayments);
      } else {
        // Only clear if this is the initial load
        if (!hasLoadedOnceRef.current) {
          setPayments([]);
        }
      }
    } catch (error) {
      console.error('❌ Error fetching donation payments:', error);
      // DO NOT clear payments after first successful load - keep last known good state
      if (!hasLoadedOnceRef.current) {
        setPayments([]);
      }
    } finally {
      if (!hasLoadedOnceRef.current) {
        setIsLoading(false);
        hasLoadedOnceRef.current = true;
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    // Only fetch once when enabled (unless polling)
    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchPayments();
    }

    // Only set up polling if poll option is true
    let interval: NodeJS.Timeout | undefined;
    if (poll && enabled) {
      interval = setInterval(fetchPayments, pollIntervalMs);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [enabled, poll, pollIntervalMs, fetchPayments]);

  // Reset refs when enabled changes to false
  useEffect(() => {
    if (!enabled) {
      fetchStartedRef.current = false;
      hasLoadedOnceRef.current = false;
    }
  }, [enabled]);

  return {
    payments,
    isLoading: enabled ? isLoading : false,
    refetch: fetchPayments
  };
};
