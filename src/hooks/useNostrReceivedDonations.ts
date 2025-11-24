import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';

export interface ReceivedDonation {
  id: string;
  projectDTag: string;
  supporterPubkey: string;
  projectOwnerPubkey: string;
  fromWallet: string;
  toWallet: string;
  amountLanoshis: string;
  amountFiat: string;
  currency: string;
  txId: string;
  timestampPaid: number;
  content: string;
  createdAt: number;
}

export const useNostrReceivedDonations = () => {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [donations, setDonations] = useState<ReceivedDonation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const relays = parameters?.relays || [];

  useEffect(() => {
    if (!session?.nostrHexId || relays.length === 0) {
      setDonations([]);
      setIsLoading(false);
      return;
    }

    const fetchDonations = async () => {
      setIsLoading(true);
      const pool = new SimplePool();

      try {
        console.log('📥 Fetching KIND 60200 donations for project owner:', session.nostrHexId);

        const events = await Promise.race([
          pool.querySync(relays, {
            kinds: [60200],
            '#p': [session.nostrHexId],
            limit: 100
          }),
          new Promise<Event[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000)
          )
        ]) as Event[];

        if (events && events.length > 0) {
          console.log(`✅ Found ${events.length} donation events`);

          // Filter to only donations where user is project_owner
          const parsedDonations: ReceivedDonation[] = events
            .filter(event => {
              const ownerTag = event.tags.find(t => t[0] === 'p' && t[2] === 'project_owner');
              return ownerTag?.[1] === session.nostrHexId;
            })
            .map(event => {
              const projectTag = event.tags.find(t => t[0] === 'project')?.[1] || '';
              const supporterTag = event.tags.find(t => t[0] === 'p' && t[2] === 'supporter')?.[1] || '';
              const ownerTag = event.tags.find(t => t[0] === 'p' && t[2] === 'project_owner')?.[1] || '';
              const fromWalletTag = event.tags.find(t => t[0] === 'from_wallet')?.[1] || '';
              const toWalletTag = event.tags.find(t => t[0] === 'to_wallet')?.[1] || '';
              const amountLanoshisTag = event.tags.find(t => t[0] === 'amount_lanoshis')?.[1] || '';
              const amountFiatTag = event.tags.find(t => t[0] === 'amount_fiat')?.[1] || '';
              const currencyTag = event.tags.find(t => t[0] === 'currency')?.[1] || '';
              const txTag = event.tags.find(t => t[0] === 'tx')?.[1] || '';
              const timestampPaidTag = event.tags.find(t => t[0] === 'timestamp_paid')?.[1];

              return {
                id: event.id,
                projectDTag: projectTag,
                supporterPubkey: supporterTag,
                projectOwnerPubkey: ownerTag,
                fromWallet: fromWalletTag,
                toWallet: toWalletTag,
                amountLanoshis: amountLanoshisTag,
                amountFiat: amountFiatTag,
                currency: currencyTag,
                txId: txTag,
                timestampPaid: timestampPaidTag ? parseInt(timestampPaidTag) : event.created_at,
                content: event.content,
                createdAt: event.created_at
              };
            })
            .sort((a, b) => b.timestampPaid - a.timestampPaid);

          console.log(`💚 Filtered ${parsedDonations.length} donations for this project owner`);
          setDonations(parsedDonations);
        } else {
          setDonations([]);
        }
      } catch (error) {
        console.error('❌ Error fetching donations:', error);
        setDonations([]);
      } finally {
        setIsLoading(false);
        pool.close(relays);
      }
    };

    fetchDonations();
  }, [relays.join(','), session?.nostrHexId]);

  return {
    donations,
    isLoading
  };
};
