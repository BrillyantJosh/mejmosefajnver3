import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PaymentScore {
  score: string;
  proposedLanoshi: string;
  paidLanoshi: string;
  periodMonths: string;
  periodStart: string;
  periodEnd: string;
  content: string;
  createdAt: number;
}

export const useNostrPaymentScore = (userPubkey?: string) => {
  const [score, setScore] = useState<PaymentScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fetchStartedRef = useRef(false);

  const fetchScore = useCallback(async () => {
    if (!userPubkey) return;

    setIsLoading(true);
    try {
      console.log('📥 Fetching KIND 30321 payment score via server...');

      const { data, error } = await supabase.functions.invoke('fetch-payment-score', {
        body: { userPubkey }
      });

      if (error) throw error;

      if (data?.score) {
        console.log(`✅ Payment score: ${data.score.score}/10`);
        setScore(data.score);
      } else {
        setScore(null);
      }
    } catch (error) {
      console.error('❌ Error fetching payment score:', error);
      setScore(null);
    } finally {
      setIsLoading(false);
    }
  }, [userPubkey]);

  useEffect(() => {
    if (!userPubkey) {
      setIsLoading(false);
      return;
    }

    if (!fetchStartedRef.current) {
      fetchStartedRef.current = true;
      fetchScore();
    }
  }, [userPubkey, fetchScore]);

  // Reset when userPubkey changes
  useEffect(() => {
    if (!userPubkey) {
      fetchStartedRef.current = false;
      setScore(null);
    }
  }, [userPubkey]);

  return {
    score,
    isLoading,
    refetch: fetchScore
  };
};
