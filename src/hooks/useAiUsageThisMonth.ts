import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface AiUsageData {
  totalLana: number;
  requestCount: number;
  isLoading: boolean;
}

export function useAiUsageThisMonth(): AiUsageData {
  const { session } = useAuth();
  const [totalLana, setTotalLana] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUsage = async () => {
      if (!session?.nostrHexId) {
        setIsLoading(false);
        return;
      }

      try {
        // Get first day of current month
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const { data, error } = await supabase
          .from('ai_usage_logs')
          .select('cost_lana')
          .eq('nostr_hex_id', session.nostrHexId)
          .gte('created_at', firstDayOfMonth.toISOString());

        if (error) {
          console.error('Error fetching AI usage:', error);
          setIsLoading(false);
          return;
        }

        // Sum up the cost_lana values and multiply by 20 (service markup)
        const total = data?.reduce((sum, row) => sum + (row.cost_lana || 0), 0) || 0;
        const totalWithMultiplier = total * 20;
        
        setTotalLana(totalWithMultiplier);
        setRequestCount(data?.length || 0);
      } catch (err) {
        console.error('Error fetching AI usage:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsage();
  }, [session?.nostrHexId]);

  return { totalLana, requestCount, isLoading };
}
