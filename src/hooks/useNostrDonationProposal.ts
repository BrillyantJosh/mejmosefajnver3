import { useState, useEffect } from 'react';
import { SimplePool, Event as NostrEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface DonationProposal {
  id: string;
  donationId: string;
  recipientPubkey: string;
  recipientWallet: string;
  fiatCurrency: string;
  fiatAmount: number;
  lanaAmount: number;
  lanoshiAmount: number;
  paymentType: string;
  service: string;
  processEventId: string;
  expiresAt: number;
  createdAt: number;
}

export const useNostrDonationProposal = (
  userPubkey: string | undefined,
  processRecordId: string | null
) => {
  const [donationProposal, setDonationProposal] = useState<DonationProposal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchDonationProposal = async () => {
      if (!userPubkey || !processRecordId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;
      const pool = new SimplePool();

      try {
        // Fetch KIND 90900 events created by this user for this process
        const events = await pool.querySync(relays, {
          kinds: [90900],
          authors: [userPubkey],
          '#e': [processRecordId],
          limit: 10
        });

        if (events.length > 0) {
          // Use the most recent proposal
          const event = events.sort((a, b) => b.created_at - a.created_at)[0];

          const dTag = event.tags.find((tag) => tag[0] === 'd');
          const pTag = event.tags.find((tag) => tag[0] === 'p');
          const walletTag = event.tags.find((tag) => tag[0] === 'wallet');
          const fiatTag = event.tags.find((tag) => tag[0] === 'fiat');
          const lanaTag = event.tags.find((tag) => tag[0] === 'lana');
          const lanoshiTag = event.tags.find((tag) => tag[0] === 'lanoshi');
          const typeTag = event.tags.find((tag) => tag[0] === 'type');
          const serviceTag = event.tags.find((tag) => tag[0] === 'service');
          const processTag = event.tags.find((tag) => tag[0] === 'e' && tag[2] === 'process');
          const expiresTag = event.tags.find((tag) => tag[0] === 'expires');

          setDonationProposal({
            id: event.id,
            donationId: dTag?.[1] || '',
            recipientPubkey: pTag?.[1] || '',
            recipientWallet: walletTag?.[1] || '',
            fiatCurrency: fiatTag?.[1] || 'EUR',
            fiatAmount: parseFloat(fiatTag?.[2] || '0'),
            lanaAmount: parseFloat(lanaTag?.[1] || '0'),
            lanoshiAmount: parseInt(lanoshiTag?.[1] || '0'),
            paymentType: typeTag?.[1] || '',
            service: serviceTag?.[1] || '',
            processEventId: processTag?.[1] || '',
            expiresAt: parseInt(expiresTag?.[1] || '0'),
            createdAt: event.created_at,
          });
        }
      } catch (error) {
        console.error('Error fetching donation proposal:', error);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchDonationProposal();
  }, [userPubkey, processRecordId, parameters]);

  return { donationProposal, isLoading };
};
