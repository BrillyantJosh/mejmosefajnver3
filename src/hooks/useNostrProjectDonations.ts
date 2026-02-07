import { useState, useEffect } from 'react';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { supabase } from '@/integrations/supabase/client';

export interface DonationData {
  id: string;
  eventId: string;
  createdAt: number;
  projectId: string;
  supporterPubkey: string;
  projectOwnerPubkey: string;
  amountLanoshis: string;
  amountFiat: string;
  currency: string;
  fromWallet: string;
  toWallet: string;
  txid: string;
  timestampPaid: number;
  message: string;
}

const parseDonationEvent = (event: any): DonationData | null => {
  try {
    const getTag = (tagName: string, role?: string): string | undefined => {
      const tag = event.tags.find((t: string[]) => t[0] === tagName && (!role || t[2] === role));
      return tag?.[1];
    };

    const projectId = getTag('project');
    const supporterPubkey = getTag('p', 'supporter');
    const projectOwnerPubkey = getTag('p', 'project_owner');
    const amountLanoshis = getTag('amount_lanoshis');
    const amountFiat = getTag('amount_fiat');
    const currency = getTag('currency');
    const fromWallet = getTag('from_wallet');
    const toWallet = getTag('to_wallet');
    const txid = getTag('tx');
    const timestampPaid = getTag('timestamp_paid');

    if (!projectId || !supporterPubkey || !projectOwnerPubkey || !amountLanoshis || !amountFiat || !currency || !txid || !timestampPaid) {
      return null;
    }

    return {
      id: projectId,
      eventId: event.id,
      createdAt: event.created_at,
      projectId,
      supporterPubkey,
      projectOwnerPubkey,
      amountLanoshis,
      amountFiat,
      currency,
      fromWallet: fromWallet || '',
      toWallet: toWallet || '',
      txid,
      timestampPaid: parseInt(timestampPaid),
      message: event.content
    };
  } catch (error) {
    console.error('Error parsing donation event:', error);
    return null;
  }
};

export const useNostrProjectDonations = (projectId: string) => {
  const { parameters } = useSystemParameters();
  const [donations, setDonations] = useState<DonationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalRaised, setTotalRaised] = useState(0);

  useEffect(() => {
    if (!parameters?.relays || !projectId) {
      console.log('⚠️ useNostrProjectDonations: Missing relays or projectId', {
        hasRelays: !!parameters?.relays,
        projectId
      });
      setIsLoading(false);
      return;
    }

    const fetchDonations = async () => {
      setIsLoading(true);

      try {
        console.log('🔍 Fetching donations for project:', projectId);

        // Use server-side relay query instead of SimplePool (browser WebSocket fails)
        const { data, error } = await supabase.functions.invoke('query-nostr-events', {
          body: {
            filter: {
              kinds: [60200],
              limit: 200
            },
            timeout: 15000
          }
        });

        if (error) {
          console.error('❌ Server query error:', error);
          throw new Error(error.message);
        }

        const allDonationEvents = data?.events || [];
        console.log(`💰 Fetched ${allDonationEvents.length} total KIND 60200 events`);

        // Filter for this specific project
        const donationEvents = allDonationEvents.filter((event: any) => {
          const projectTag = event.tags.find((t: string[]) => t[0] === 'project')?.[1];
          return projectTag === projectId;
        });

        console.log(`🎯 Filtered to ${donationEvents.length} donations for project ${projectId}`);

        if (donationEvents.length > 0) {
          console.log('📝 First donation event:', JSON.stringify(donationEvents[0], null, 2));
        }

        const parsedDonations = donationEvents
          .map((event: any) => {
            const parsed = parseDonationEvent(event);
            if (!parsed) {
              console.warn('⚠️ Failed to parse donation event:', event);
            }
            return parsed;
          })
          .filter((d: DonationData | null): d is DonationData => d !== null)
          .sort((a: DonationData, b: DonationData) => b.timestampPaid - a.timestampPaid);

        console.log(`✅ Parsed ${parsedDonations.length} valid donations`);
        if (parsedDonations.length > 0) {
          console.log('📊 Sample parsed donation:', parsedDonations[0]);
        }

        setDonations(parsedDonations);

        // Calculate total raised
        const total = parsedDonations.reduce((sum: number, donation: DonationData) => {
          return sum + parseFloat(donation.amountFiat);
        }, 0);
        setTotalRaised(total);

        console.log(`💵 Total raised: ${total}`);

      } catch (error) {
        console.error('❌ Error fetching project donations:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDonations();
  }, [parameters?.relays, projectId]);

  return { donations, isLoading, totalRaised };
};
