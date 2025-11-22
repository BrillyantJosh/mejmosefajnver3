import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { arraysEqual } from '@/lib/arrayComparison';

export interface DonationProposal {
  id: string;
  d: string;
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

export const useNostrDonationProposals = () => {
  const { parameters } = useSystemParameters();
  const [proposals, setProposals] = useState<DonationProposal[]>([]);
  const relays = parameters?.relays || [];

  useEffect(() => {
    const fetchProposals = async () => {
      if (relays.length === 0) {
        setProposals([]);
        return;
      }

      const pool = new SimplePool();

      try {
        console.log('📥 Fetching KIND 90900 donation proposals...');

        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [90900],
            limit: 100
          }),
          new Promise<Event[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]) as Event[];

        if (events && events.length > 0) {
          console.log(`✅ Found ${events.length} donation proposals`);

          const parsedProposals: DonationProposal[] = events.map(event => {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
            const pTag = event.tags.find(t => t[0] === 'p')?.[1] || '';
            const walletTag = event.tags.find(t => t[0] === 'wallet')?.[1] || '';
            const fiatTag = event.tags.find(t => t[0] === 'fiat');
            const lanaTag = event.tags.find(t => t[0] === 'lana')?.[1] || '';
            const lanoshiTag = event.tags.find(t => t[0] === 'lanoshi')?.[1] || '';
            const typeTag = event.tags.find(t => t[0] === 'type')?.[1] || '';
            const serviceTag = event.tags.find(t => t[0] === 'service')?.[1] || '';
            const refTag = event.tags.find(t => t[0] === 'ref')?.[1];
            const expiresTag = event.tags.find(t => t[0] === 'expires')?.[1];
            const urlTag = event.tags.find(t => t[0] === 'url')?.[1];

            return {
              id: event.id,
              d: dTag,
              recipientPubkey: pTag,
              wallet: walletTag,
              fiatCurrency: fiatTag?.[1] || '',
              fiatAmount: fiatTag?.[2] || '',
              lanaAmount: lanaTag,
              lanoshiAmount: lanoshiTag,
              type: typeTag,
              service: serviceTag,
              ref: refTag,
              expires: expiresTag ? parseInt(expiresTag) : undefined,
              url: urlTag,
              content: event.content,
              createdAt: event.created_at,
              eventId: event.id
            };
          });

          // Sort by newest first
          parsedProposals.sort((a, b) => b.createdAt - a.createdAt);
          
          // Only update state if data actually changed
          if (!arraysEqual(parsedProposals, proposals)) {
            console.log('📋 Proposals updated');
            setProposals(parsedProposals);
          }
        } else {
          if (proposals.length > 0) {
            setProposals([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching donation proposals:', error);
        setProposals([]);
      } finally {
        pool.close(relays);
      }
    };

    fetchProposals();

    // Poll every 10 seconds for updates
    const interval = setInterval(fetchProposals, 10000);
    return () => clearInterval(interval);
  }, [relays.join(',')]);

  return {
    proposals
  };
};
