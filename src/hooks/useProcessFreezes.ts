/**
 * KIND 87057 person-freeze state for one OWN process. READ ONLY — freezes are
 * published from selfresponsible.life, where the facilitator works.
 *
 * Verification comes FIRST and fails closed: a notice whose author is on
 * neither arm of authority is discarded outright. When NEITHER arm resolves,
 * nothing is asserted at all (`unverified`) — the caller must then show no
 * freeze AND lift no block, because "I could not check" is not "nobody is
 * frozen".
 */
import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import type { Event } from 'nostr-tools/pure';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { fetchFacilitatorRegistry } from '@/lib/facilitatorRegistry';
import {
  PERSON_FREEZE_KIND,
  parseFreezeNotice,
  resolveFacilitatorAllowList,
  unionAuthority,
  computeFreezeStates,
  parseSplit,
  type PersonFreezeState,
} from '@/lib/ownFreeze';

export interface ProcessFreezes {
  /** Per person, as of now. Empty while unresolved — read `isLoading` first. */
  states: Map<string, PersonFreezeState>;
  isLoading: boolean;
  /** Authority could not be established: assert NOTHING, in either direction. */
  unverified: boolean;
  /** Rival claimants on the roster that the handover chain never links. */
  contested: boolean;
  /** The SPLIT round the states were computed against, or null if unknown. */
  currentSplit: number | null;
}

const EMPTY: ProcessFreezes = {
  states: new Map(), isLoading: false, unverified: true, contested: false, currentSplit: null,
};

export const useProcessFreezes = (caseRoot: string | null): ProcessFreezes => {
  const { parameters } = useSystemParameters();
  const [result, setResult] = useState<ProcessFreezes>(EMPTY);
  // A SPLIT-bounded freeze lapses on a round change, not on a clock — but the
  // round can change while the tab is open, and nothing else would re-render.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const relaysKey = (parameters?.relays || []).join(',');
  const splitRaw = parameters?.split;

  useEffect(() => {
    const relays = parameters?.relays || [];
    if (!caseRoot || relays.length === 0) { setResult(EMPTY); return; }

    let cancelled = false;
    const pool = new SimplePool();
    setResult((prev) => ({ ...prev, isLoading: true }));

    (async () => {
      try {
        // Authority BEFORE the notices. Beyond ordering, it lets the query be
        // constrained to authorised authors: an unconstrained `#e` query is
        // limit-capped, so anyone could flood junk 87057s tagging this case and
        // push the genuine freeze out of the relay window — a denial-of-
        // sanction that needs no key at all.
        const [roster, registry] = await Promise.all([
          resolveFacilitatorAllowList(caseRoot, relays, pool),
          fetchFacilitatorRegistry(),
        ]);
        if (cancelled) return;

        if (roster.contested) {
          setResult({ states: new Map(), isLoading: false, unverified: true, contested: true, currentSplit: parseSplit(splitRaw) });
          return;
        }
        const authority = unionAuthority(roster.allow, registry);
        if (!authority) {
          setResult({ states: new Map(), isLoading: false, unverified: true, contested: false, currentSplit: parseSplit(splitRaw) });
          return;
        }

        const events: Event[] = await pool.querySync(relays, {
          kinds: [PERSON_FREEZE_KIND], '#e': [caseRoot.toLowerCase()],
          authors: [...authority], limit: 500,
        });
        if (cancelled) return;

        const notices = events.map(parseFreezeNotice).filter((n): n is NonNullable<typeof n> => n !== null);
        const currentSplit = parseSplit(splitRaw);
        setResult({
          states: computeFreezeStates(notices, authority, currentSplit),
          isLoading: false, unverified: false, contested: false, currentSplit,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn('⚠️ Could not read the freezes for this process:', error);
        // Unverified, NOT "nobody is frozen": a failed read must not release
        // anyone, and must not freeze anyone either.
        setResult({ states: new Map(), isLoading: false, unverified: true, contested: false, currentSplit: parseSplit(splitRaw) });
      }
    })();

    return () => { cancelled = true; try { pool.close(relays); } catch { /* already closed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseRoot, relaysKey, splitRaw, tick]);

  return result;
};
