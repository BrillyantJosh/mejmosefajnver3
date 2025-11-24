import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

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

const parseDonationEvent = (event: Event): DonationData | null => {
  try {
    const getTag = (tagName: string, role?: string): string | undefined => {
      const tag = event.tags.find(t => t[0] === tagName && (!role || t[2] === role));
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
      setIsLoading(false);
      return;
    }

    const fetchDonations = async () => {
      const pool = new SimplePool();
      setIsLoading(true);

      try {
        const donationEvents = await pool.querySync(parameters.relays, {
          kinds: [60200],
          '#project': [projectId],
          limit: 100
        });

        console.log(`💰 Fetched ${donationEvents.length} donations for project ${projectId}`);

        const parsedDonations = donationEvents
          .map(parseDonationEvent)
          .filter((d): d is DonationData => d !== null)
          .sort((a, b) => b.timestampPaid - a.timestampPaid);

        setDonations(parsedDonations);

        // Calculate total raised
        const total = parsedDonations.reduce((sum, donation) => {
          return sum + parseFloat(donation.amountFiat);
        }, 0);
        setTotalRaised(total);

      } catch (error) {
        console.error('Error fetching project donations:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchDonations();
  }, [parameters?.relays, projectId]);

  return { donations, isLoading, totalRaised };
};
