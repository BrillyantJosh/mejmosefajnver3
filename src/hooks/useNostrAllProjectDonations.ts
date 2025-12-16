import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

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
      const pool = new SimplePool();
      setIsLoading(true);

      try {
        const allDonationEvents = await pool.querySync(parameters.relays, {
          kinds: [60200],
          limit: 500
        });

        let totalFiat = 0;
        let count = 0;

        allDonationEvents.forEach(event => {
          // Get the project ID from donation event
          const projectTag = event.tags.find(t => t[0] === 'project')?.[1];
          
          // Skip donations for projects not in visible list
          if (!projectTag || !visibleProjectIds.includes(projectTag)) {
            return;
          }

          const amountFiatTag = event.tags.find(t => t[0] === 'amount_fiat')?.[1];
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
        pool.close(parameters.relays);
      }
    };

    fetchAllDonations();
  }, [parameters?.relays, visibleProjectIds]);

  return { summary, isLoading };
};
