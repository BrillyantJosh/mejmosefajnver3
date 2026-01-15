import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

export interface AwarenessProposal {
  id: string;
  pubkey: string;
  createdAt: number;
  title: string;
  shortPerspective: string;
  longPerspective: string;
  consequenceYes: string;
  consequenceNo: string;
  level: 'local' | 'global';
  start: number;
  end: number;
  tallyAt: number;
  oracle: string;
  status: 'draft' | 'active' | 'archived';
  dTag: string;
  // Optional fields
  link?: string;
  doc?: string;
  img?: string;
  youtube?: string;
  quorumScope?: string;
  donationWallet?: string;
  prev?: string;
}

function parseProposalFromEvent(event: Event): AwarenessProposal | null {
  try {
    const getTag = (name: string): string => {
      const tag = event.tags.find(t => t[0] === name);
      return tag ? tag[1] : '';
    };

    const title = getTag('title');
    const status = getTag('status') as 'draft' | 'active' | 'archived';
    const dTag = getTag('d');

    // Skip if missing required fields or not active
    if (!title || !dTag) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      title,
      shortPerspective: getTag('s_perspective'),
      longPerspective: getTag('l_perspective'),
      consequenceYes: getTag('consequence_yes'),
      consequenceNo: getTag('consequence_no'),
      level: (getTag('level') || 'global') as 'local' | 'global',
      start: parseInt(getTag('start')) || 0,
      end: parseInt(getTag('end')) || 0,
      tallyAt: parseInt(getTag('tally_at')) || 0,
      oracle: getTag('oracle'),
      status: status || 'draft',
      dTag,
      // Optional
      link: getTag('link') || undefined,
      doc: getTag('doc') || undefined,
      img: getTag('img') || undefined,
      youtube: getTag('youtube') || undefined,
      quorumScope: getTag('quorum_scope') || undefined,
      donationWallet: getTag('donation_wallet') || undefined,
      prev: getTag('prev') || undefined,
    };
  } catch (error) {
    console.error('Error parsing awareness proposal:', error);
    return null;
  }
}

export function useNostrAwarenessProposals() {
  const { parameters } = useSystemParameters();
  const [allProposals, setAllProposals] = useState<AwarenessProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProposals = async () => {
      if (!parameters?.relays || parameters.relays.length === 0) {
        console.log('No relays available for fetching proposals');
        setIsLoading(false);
        return;
      }

      const pool = new SimplePool();
      setIsLoading(true);
      setError(null);

      try {
        console.log('Fetching KIND 38883 (Awareness Proposals) from relays:', parameters.relays);

        const filter: Filter = {
          kinds: [38883],
        };

        const events = await pool.querySync(parameters.relays, filter);
        console.log(`Received ${events.length} KIND 38883 events`);

        // Parse and deduplicate by d tag (keep newest)
        const proposalMap = new Map<string, AwarenessProposal>();
        
        for (const event of events) {
          console.log('Processing event:', event.id, event.tags);
          const proposal = parseProposalFromEvent(event);
          console.log('Parsed proposal:', proposal);
          if (proposal && proposal.status === 'active') {
            const existing = proposalMap.get(proposal.dTag);
            if (!existing || existing.createdAt < proposal.createdAt) {
              proposalMap.set(proposal.dTag, proposal);
            }
          }
        }

        const proposals = Array.from(proposalMap.values());
        console.log(`Found ${proposals.length} proposals with active status`);
        setAllProposals(proposals);
      } catch (err) {
        console.error('Error fetching awareness proposals:', err);
        setError('Failed to fetch proposals');
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchProposals();
  }, [parameters?.relays]);

  // Separate active (not yet ended) from expired (already ended)
  const now = Math.floor(Date.now() / 1000);
  const activeProposals = allProposals
    .filter(p => p.end > now)
    .sort((a, b) => a.end - b.end); // Soonest ending first
  const expiredProposals = allProposals
    .filter(p => p.end <= now)
    .sort((a, b) => b.end - a.end); // Most recently ended first

  return { activeProposals, expiredProposals, isLoading, error };
}
