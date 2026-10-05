/**
 * Unconditional Financing — "Lana8Wonder member for >= 4 completed Splits" gate.
 * The heavy lifting (fetch ALL KIND 88888 versions signed by the Lana8Wonder
 * key, min created_at, count the Splits that are over since then from the
 * signed KIND 38888 calendar) happens server-side at
 * GET /api/unconditional-financing/eligibility/:pubkey.
 *
 * "The server could not tell" (no relay answered, or the Split calendar could not
 * be read — HTTP 503) is an ERROR here, never an `eligibility` that says "no plan":
 * the page has to say "cannot check right now", not "you are not a member".
 */
import { useCallback, useEffect, useState } from 'react';
import { UF_API } from './useUFData';

export interface UfEligibility {
  eligible: boolean;
  exists: boolean;          // has a Lana8Wonder plan at all
  enrolledAt: number | null;
  completedSplitsSinceEnrollment: number;
  requiredSplits: number;
  currentSplit: number;
}

export function useUFEligibility(pubkey: string | undefined) {
  const [eligibility, setEligibility] = useState<UfEligibility | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!pubkey) { setIsLoading(false); return; }
    let alive = true;
    setIsLoading(true);
    setError(null);
    fetch(`${UF_API}/eligibility/${encodeURIComponent(pubkey)}`)
      .then(async (r) => {
        if (r.ok) return r.json();
        // The server says WHY it cannot tell; keep that, it is what someone reports back.
        const body = await r.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' && body.error ? body.error : `HTTP ${r.status}`);
      })
      .then((d) => { if (alive) { setEligibility(d); setError(null); } })
      .catch((e) => { if (alive) { setEligibility(null); setError(e?.message || 'unavailable'); } })
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [pubkey, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { eligibility, isLoading, error, retry };
}
