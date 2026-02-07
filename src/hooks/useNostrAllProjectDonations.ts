import { useState, useEffect } from 'react';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { supabase } from '@/integrations/supabase/client';

export interface AllProjectsDonationSummary {
  totalRaisedFiat: number;
  donationCount: number;
}

export const useNostrAllProjectDonations = (visibleProjectIds: string[]) => {
  const { parameters } = useSystemParameters();
  const [summary, setSummary] = useState<AllProjectsDonationSummary>({
    totalRaisedFiat: 0,
    donationCount: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!parameters?.relays || visibleProjectIds.length === 0) {
      setIsLoading(false);
      return;
    }

    const fetchAllDonations = async () => {
      setIsLoading(true);

      try {
        // Use server-side relay query instead of SimplePool (browser WebSocket fails)
        const { data, error } = await supabase.functions.invoke('query-nostr-events', {
          body: {
            filter: {
              kinds: [60200],
              limit: 500
            },
            timeout: 15000
          }
        });

        if (error) {
          console.error('❌ Server query error:', error);
          throw new Error(error.message);
        }

        const allDonationEvents = data?.events || [];

        let totalFiat = 0;
        let count = 0;

        allDonationEvents.forEach((event: any) => {
          // Get the project ID from donation event
          const projectTag = event.tags.find((t: string[]) => t[0] === 'project')?.[1];

          // Skip donations for projects not in visible list
          if (!projectTag || !visibleProjectIds.includes(projectTag)) {
            return;
          }

          const amountFiatTag = event.tags.find((t: string[]) => t[0] === 'amount_fiat')?.[1];
          if (amountFiatTag) {
            const amount = parseFloat(amountFiatTag);
            if (!isNaN(amount)) {
              totalFiat += amount;
              count++;
            }
          }
        });

        setSummary({
          totalRaisedFiat: totalFiat,
          donationCount: count
        });
      } catch (error) {
        console.error('Error fetching all donations:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllDonations();
  }, [parameters?.relays, visibleProjectIds]);

  return { summary, isLoading };
};
