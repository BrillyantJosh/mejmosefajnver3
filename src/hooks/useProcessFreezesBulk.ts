/**
 * KIND 87057 freeze state for MANY processes at once — for the process list,
 * where the reader needs to see that someone in a case is frozen before they
 * open it.
 *
 * Same rules as `useProcessFreezes`, same anchored authority: the list is a
 * display, but "this person is frozen" is a public statement about someone, and
 * a display that says it on weaker evidence than the gate is not a lighter
 * claim — it is just a wronger one. So the roster is resolved per case exactly
 * as it is for the gate; only the notice query is shared across cases.
 *
 * Cost: two roster queries per case plus one shared registry read (cached) and
 * one notice query. The list holds a handful of open processes, so this stays
 * small — and it is the price of not inventing a second, looser truth.
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

export interface BulkFreezes {
  /** caseRoot → (person → state). A case absent from the map asserts nothing. */
  byCase: Map<string, Map<string, PersonFreezeState>>;
  isLoading: boolean;
}

/** Is anyone at all frozen in this case? */
export const anyoneFrozen = (states: Map<string, PersonFreezeState> | undefined): boolean =>
  !!states && [...states.values()].some((s) => s.frozen);

export const useProcessFreezesBulk = (caseRoots: string[]): BulkFreezes => {
  const { parameters } = useSystemParameters();
  const [byCase, setByCase] = useState<Map<string, Map<string, PersonFreezeState>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const rootsKey = [...new Set(caseRoots.map((r) => (r || '').toLowerCase()).filter(Boolean))].sort().join(',');
  const relaysKey = (parameters?.relays || []).join(',');
  const splitRaw = parameters?.split;

  useEffect(() => {
    const relays = parameters?.relays || [];
    const roots = rootsKey ? rootsKey.split(',') : [];
    if (!roots.length || !relays.length) { setByCase(new Map()); return; }

    let cancelled = false;
    const pool = new SimplePool();
    setIsLoading(true);

    (async () => {
      try {
        const registry = await fetchFacilitatorRegistry();
        const rosters = await Promise.all(
          roots.map((r) => resolveFacilitatorAllowList(r, relays, pool).catch(() => ({ allow: null, contested: false }))),
        );
        if (cancelled) return;

        const authorityByRoot = new Map<string, Set<string>>();
        const everyAuthor = new Set<string>();
        roots.forEach((r, i) => {
          if (rosters[i].contested) return;               // disputed → decide nothing
          const a = unionAuthority(rosters[i].allow, registry);
          if (!a) return;                                  // unverified → assert nothing
          authorityByRoot.set(r, a);
          a.forEach((k) => everyAuthor.add(k));
        });
        if (!authorityByRoot.size) { setByCase(new Map()); setIsLoading(false); return; }

        // ONE notice query for every case, constrained to the union of every
        // case's authorised authors. Each case is then filtered against ITS OWN
        // allow-list below, so a facilitator of case A can never freeze someone
        // in case B just by being in the shared author filter.
        const events: Event[] = await pool.querySync(relays, {
          kinds: [PERSON_FREEZE_KIND], '#e': [...authorityByRoot.keys()],
          authors: [...everyAuthor], limit: 2000,
        });
        if (cancelled) return;

        const currentSplit = parseSplit(splitRaw);
        const noticesByRoot = new Map<string, ReturnType<typeof parseFreezeNotice>[]>();
        for (const ev of events) {
          const n = parseFreezeNotice(ev);
          if (!n) continue;
          const arr = noticesByRoot.get(n.caseRoot) || [];
          arr.push(n);
          noticesByRoot.set(n.caseRoot, arr);
        }

        const out = new Map<string, Map<string, PersonFreezeState>>();
        for (const [root, authority] of authorityByRoot) {
          const notices = (noticesByRoot.get(root) || []).filter((n): n is NonNullable<typeof n> => n !== null);
          out.set(root, computeFreezeStates(notices, authority, currentSplit));
        }
        setByCase(out);
        setIsLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.warn('⚠️ Could not read the freezes across processes:', error);
        setByCase(new Map());   // unverified — asserts nothing about anyone
        setIsLoading(false);
      }
    })();

    return () => { cancelled = true; try { pool.close(relays); } catch { /* already closed */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsKey, relaysKey, splitRaw]);

  return { byCase, isLoading };
};
