import { useState, useEffect } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { AwarenessProposal } from './useNostrAwarenessProposals';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

function parseProposalFromEvent(event: Event): AwarenessProposal | null {
  try {
    const getTag = (name: string): string => {
      const tag = event.tags.find(t => t[0] === name);
      return tag ? tag[1] : '';
    };

    const title = getTag('title');
    const status = getTag('status') as 'draft' | 'active' | 'archived';
    const dTag = getTag('d');

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

export function useNostrPublicProposal(dTag: string, systemRelays?: string[]) {
  const [proposal, setProposal] = useState<AwarenessProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dTag) {
      setError('No proposal identifier provided');
      setLoading(false);
      return;
    }

    const relays = systemRelays && systemRelays.length > 0 ? systemRelays : DEFAULT_RELAYS;
    const pool = new SimplePool();
    let isMounted = true;
    let foundProposal = false;

    const fetchProposal = async () => {
      try {
        console.log('Fetching proposal with dTag:', dTag, 'from relays:', relays);

        // First try with #d filter
        const filterWithD: Filter = {
          kinds: [38883],
          '#d': [dTag],
        };

        let events = await pool.querySync(relays, filterWithD);
        console.log(`Received ${events.length} events with #d filter for dTag:`, dTag);

        // If no results, try fetching all and filter manually (some relays don't support #d for parameterized events)
        if (events.length === 0) {
          console.log('No results with #d filter, trying to fetch all and filter manually...');
          const filterAll: Filter = {
            kinds: [38883],
            limit: 100,
          };
          
          const allEvents = await pool.querySync(relays, filterAll);
          console.log(`Received ${allEvents.length} total KIND 38883 events`);
          
          // Filter by d-tag manually
          events = allEvents.filter(e => {
            const eventDTag = e.tags.find(t => t[0] === 'd')?.[1];
            return eventDTag === dTag;
          });
          console.log(`Found ${events.length} events matching dTag after manual filter`);
        }

        if (!isMounted) return;

        if (events.length === 0) {
          setError('Proposal not found');
          setLoading(false);
          return;
        }

        // Get the newest event
        const sortedEvents = events.sort((a, b) => b.created_at - a.created_at);
        const parsedProposal = parseProposalFromEvent(sortedEvents[0]);

        if (parsedProposal) {
          foundProposal = true;
          setProposal(parsedProposal);
          setError(null);
        } else {
          setError('Failed to parse proposal data');
        }
      } catch (err) {
        console.error('Error fetching proposal:', err);
        if (isMounted) {
          setError('Failed to load proposal');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchProposal();

    // Timeout for slow relays
    const timeout = setTimeout(() => {
      if (isMounted && loading && !foundProposal) {
        setLoading(false);
        if (!proposal) {
          setError('Request timed out - please try again');
        }
      }
    }, 20000);

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      pool.close(relays);
    };
  }, [dTag, systemRelays]);

  return { proposal, loading, error };
}
