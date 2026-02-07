import { useState, useEffect } from 'react';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface SentDonation {
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

export const useNostrSentDonations = () => {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [donations, setDonations] = useState<SentDonation[]>([]);
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

      try {
        console.log('📤 Fetching KIND 60200 donations sent by:', session.nostrHexId);

        // Use server-side relay query — fetch donations authored by the current user
        const { data, error } = await supabase.functions.invoke('query-nostr-events', {
          body: {
            filter: {
              kinds: [60200],
              authors: [session.nostrHexId],
              limit: 100
            },
            timeout: 15000
          }
        });

        if (error) {
          console.error('❌ Server query error:', error);
          throw new Error(error.message);
        }

        const events = data?.events || [];

        if (events && events.length > 0) {
          console.log(`✅ Found ${events.length} sent donation events`);

          const parsedDonations: SentDonation[] = events
            .map((event: any) => {
              const projectTag = event.tags.find((t: string[]) => t[0] === 'project')?.[1] || '';
              const supporterTag = event.tags.find((t: string[]) => t[0] === 'p' && t[2] === 'supporter')?.[1] || '';
              const ownerTag = event.tags.find((t: string[]) => t[0] === 'p' && t[2] === 'project_owner')?.[1] || '';
              const fromWalletTag = event.tags.find((t: string[]) => t[0] === 'from_wallet')?.[1] || '';
              const toWalletTag = event.tags.find((t: string[]) => t[0] === 'to_wallet')?.[1] || '';
              const amountLanoshisTag = event.tags.find((t: string[]) => t[0] === 'amount_lanoshis')?.[1] || '';
              const amountFiatTag = event.tags.find((t: string[]) => t[0] === 'amount_fiat')?.[1] || '';
              const currencyTag = event.tags.find((t: string[]) => t[0] === 'currency')?.[1] || '';
              const txTag = event.tags.find((t: string[]) => t[0] === 'tx')?.[1] || '';
              const timestampPaidTag = event.tags.find((t: string[]) => t[0] === 'timestamp_paid')?.[1];

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
            .sort((a: SentDonation, b: SentDonation) => b.timestampPaid - a.timestampPaid);

          console.log(`📤 Parsed ${parsedDonations.length} sent donations`);
          setDonations(parsedDonations);
        } else {
          setDonations([]);
        }
      } catch (error) {
        console.error('❌ Error fetching sent donations:', error);
        setDonations([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDonations();
  }, [relays.join(','), session?.nostrHexId]);

  return {
    donations,
    isLoading
  };
};
