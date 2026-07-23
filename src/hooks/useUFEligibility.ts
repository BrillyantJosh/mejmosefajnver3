/**
 * Unconditional Financing — "Lana8Wonder member for >= 4 completed Splits" gate.
 * The heavy lifting (fetch ALL KIND 88888 versions, min created_at, compare
 * against the server-recorded split_history) happens server-side at
 * GET /api/unconditional-financing/eligibility/:pubkey.
 */
import { useEffect, useState } from 'react';
import { UF_API } from './useUFData';

export interface UfEligibility {
  eligible: boolean;
  exists: boolean;          // has a Lana8Wonder plan at all
  enrolledAt: number | null;
  completedSplitsSinceEnrollment: number;
  grandfathered?: boolean;
  requiredSplits: number;
  currentSplit: number;
}

export function useUFEligibility(pubkey: string | undefined) {
  const [eligibility, setEligibility] = useState<UfEligibility | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) { setIsLoading(false); return; }
    let alive = true;
    setIsLoading(true);
    fetch(`${UF_API}/eligibility/${encodeURIComponent(pubkey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setEligibility(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [pubkey]);

  return { eligibility, isLoading, error };
}
