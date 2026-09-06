import { useCallback, useEffect, useMemo, useState } from 'react';
import { tallyAcks, proposalSlug, type AckEvent, type AlignmentTally } from '@/lib/alignmentTally';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/** The relays answer at most 500 events per request (strfry max_limit). */
const PAGE_SIZE = 500;
/** 164 votes exist today across ten proposals; six pages is room to grow into. */
const MAX_PAGES = 6;

async function queryServer(filter: Record<string, unknown>, timeout = 15000): Promise<AckEvent[]> {
  const res = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, timeout }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return (data.events || []) as AckEvent[];
}

export interface AlignmentTalliesState {
  tallies: Map<string, AlignmentTally>;
  /**
   * Whether the count can be believed. A relay that fails to connect answers
   * with an empty list, exactly like a relay that holds no votes — so an empty
   * answer is reported as "not loaded", never drawn as a row of zeros. The
   * result feeds a published outcome; being wrong quietly is the one thing it
   * must not do.
   */
  resolved: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Every vote on every alignment, counted per proposal.
 *
 * Fetched in one sweep rather than per proposal: the list page shows ten
 * results at once, and ten separate relay round-trips from a phone is what
 * made these pages crawl before.
 */
export function useAlignmentTallies(): AlignmentTalliesState {
  const [events, setEvents] = useState<AckEvent[]>([]);
  const [resolved, setResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const collected: AckEvent[] = [];
        const seen = new Set<string>();
        let until: number | undefined;

        for (let page = 0; page < MAX_PAGES; page++) {
          const filter: Record<string, unknown> = { kinds: [38884], limit: PAGE_SIZE };
          if (until) filter.until = until;
          const batch = await queryServer(filter);

          let added = 0;
          let oldest = Number.POSITIVE_INFINITY;
          for (const event of batch) {
            if (event?.id && !seen.has(event.id)) {
              seen.add(event.id);
              collected.push(event);
              added++;
            }
            const at = Number(event?.created_at) || 0;
            if (at && at < oldest) oldest = at;
          }

          // `until` is inclusive, so a page that brings nothing new is the end.
          if (batch.length < PAGE_SIZE || added === 0 || !Number.isFinite(oldest)) break;
          until = oldest;
        }

        if (cancelled) return;
        setEvents(collected);
        setResolved(collected.length > 0);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load alignment votes:', err);
        setError(err instanceof Error ? err.message : 'Failed to load votes');
        setEvents([]);
        setResolved(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const tallies = useMemo(() => tallyAcks(events), [events]);

  return { tallies, resolved, isLoading, error, refetch };
}

/** The tally for one proposal, by its `d` tag (`awareness:<slug>` or the slug). */
export function tallyFor(
  tallies: Map<string, AlignmentTally>,
  dTag: string | undefined,
): AlignmentTally | undefined {
  if (!dTag) return undefined;
  return tallies.get(proposalSlug(dTag));
}
