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
      console.log('⚠️ useNostrProjectDonations: Missing relays or projectId', { 
        hasRelays: !!parameters?.relays, 
        projectId 
      });
      setIsLoading(false);
      return;
    }

    const fetchDonations = async () => {
      const pool = new SimplePool();
      setIsLoading(true);

      try {
        const filter = {
          kinds: [60200],
          '#project': [projectId],
          limit: 100
        };
        
        console.log('🔍 Fetching donations for project:', projectId);
        console.log('📡 Using relays:', parameters.relays);
        console.log('🔎 Filter:', JSON.stringify(filter, null, 2));
        
        const donationEvents = await pool.querySync(parameters.relays, filter);

        console.log(`💰 Fetched ${donationEvents.length} donation events for project ${projectId}`);
        
        if (donationEvents.length > 0) {
          console.log('📝 First donation event:', JSON.stringify(donationEvents[0], null, 2));
        } else {
          console.warn('⚠️ No donation events found. Filter used:', filter);
          console.warn('⚠️ Checking if events exist by querying ALL KIND 60200 events...');
          
          // Try to fetch ALL kind 60200 events to see if any exist
          const allDonations = await pool.querySync(parameters.relays, {
            kinds: [60200],
            limit: 50
          });
          console.log(`📊 Total KIND 60200 events on relays: ${allDonations.length}`);
          if (allDonations.length > 0) {
            console.log('📝 Sample KIND 60200 event:', JSON.stringify(allDonations[0], null, 2));
            console.log('📋 All project tags found:', 
              allDonations.map(e => e.tags.find(t => t[0] === 'project')?.[1])
            );
          }
        }

        const parsedDonations = donationEvents
          .map((event) => {
            const parsed = parseDonationEvent(event);
            if (!parsed) {
              console.warn('⚠️ Failed to parse donation event:', event);
            }
            return parsed;
          })
          .filter((d): d is DonationData => d !== null)
          .sort((a, b) => b.timestampPaid - a.timestampPaid);

        console.log(`✅ Parsed ${parsedDonations.length} valid donations`);
        if (parsedDonations.length > 0) {
          console.log('📊 Sample parsed donation:', parsedDonations[0]);
        }

        setDonations(parsedDonations);

        // Calculate total raised
        const total = parsedDonations.reduce((sum, donation) => {
          return sum + parseFloat(donation.amountFiat);
        }, 0);
        setTotalRaised(total);
        
        console.log(`💵 Total raised: ${total}`);

      } catch (error) {
        console.error('❌ Error fetching project donations:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchDonations();
  }, [parameters?.relays, projectId]);

  return { donations, isLoading, totalRaised };
};
