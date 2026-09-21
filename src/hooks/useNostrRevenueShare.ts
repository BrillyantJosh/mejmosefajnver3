import { useState, useEffect } from 'react';
import { Event as NostrEvent } from 'nostr-tools';
import { queryEventsViaServer } from '@/lib/relayReadViaServer';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface RevenueRecipient {
  pubkey: string;
  role: string;
  wallet_id: string;
  share_percent: number;
}

export interface RevenueShareData {
  donation_amount: number;
  currency: string;
  revenue_share: RevenueRecipient[];
  notes?: string;
}

export interface RevenueShareEvent {
  id: string;
  processRecordId: string;
  transcriptEventId?: string;
  currency: string;
  amount: string;
  visibility: string;
  data: RevenueShareData;
  createdAt: number;
}

export const useNostrRevenueShare = (processRecordId: string | null) => {
  const [revenueShare, setRevenueShare] = useState<RevenueShareEvent | null>(null);
  const [allRevenueShares, setAllRevenueShares] = useState<RevenueShareEvent[]>([]);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [transcriptEventId, setTranscriptEventId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    const fetchRevenueShare = async () => {
      if (!processRecordId || !parameters?.relays || parameters.relays.length === 0) {
        setIsLoading(false);
        return;
      }

      const relays = parameters.relays;

      try {
        // First, check if transcript exists (KIND 87944)
        // Through this app's server — see src/lib/relayReadViaServer.ts.
        const transcriptEvents = await queryEventsViaServer({
          kinds: [87944],
          '#e': [processRecordId],
          limit: 1
        }, { label: 'process transcript (KIND 87944)' });

        if (transcriptEvents.length > 0) {
          setHasTranscript(true);
          setTranscriptEventId(transcriptEvents[0].id);
        }

        // Fetch revenue share configurations (KIND 87945)
        const revenueEvents = await queryEventsViaServer<NostrEvent>({
          kinds: [87945],
          '#e': [processRecordId],
          limit: 10
        }, { label: 'revenue share (KIND 87945)' });

        const shares: RevenueShareEvent[] = revenueEvents
          .map((event: NostrEvent) => {
            try {
              const processTag = event.tags.find((tag) => tag[0] === 'e' && tag[2] === 'process');
              const transcriptTag = event.tags.find((tag) => tag[0] === 'e' && tag[2] === 'transcript');
              const currencyTag = event.tags.find((tag) => tag[0] === 'currency');
              const amountTag = event.tags.find((tag) => tag[0] === 'amount');
              const visibilityTag = event.tags.find((tag) => tag[0] === 'visibility');

              const data: RevenueShareData = JSON.parse(event.content);

              return {
                id: event.id,
                processRecordId: processTag?.[1] || processRecordId,
                transcriptEventId: transcriptTag?.[1],
                currency: currencyTag?.[1] || data.currency || 'EUR',
                amount: amountTag?.[1] || data.donation_amount.toString(),
                visibility: visibilityTag?.[1] || 'public',
                data,
                createdAt: event.created_at,
              };
            } catch (error) {
              console.error('Error parsing revenue share event:', error);
              return null;
            }
          })
          .filter((share) => share !== null) as RevenueShareEvent[];

        // Sort by creation date, newest first
        shares.sort((a, b) => b.createdAt - a.createdAt);

        setAllRevenueShares(shares);
        if (shares.length > 0) {
          setRevenueShare(shares[0]); // Use the most recent one
        }
      } catch (error) {
        console.error('Error fetching revenue share:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRevenueShare();
  }, [processRecordId, parameters]);

  return { revenueShare, allRevenueShares, hasTranscript, transcriptEventId, isLoading };
};
