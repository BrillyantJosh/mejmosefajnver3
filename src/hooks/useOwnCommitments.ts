import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process CHANGE COMMITMENTS for one case root — the
// PARTICIPANT'S OWN stated commitment, captured, verified and published by each
// being in their name. PUBLIC plaintext JSON — no key needed.
//   37049 = param-replaceable Change Commitment (d = <participant>:<caseRoot>)
// THE ATTRIBUTION INVERSION vs 37048: a proposal is the BEING'S words written
// in the participant's voice; a commitment IS the participant's own decision,
// only recorded and verified by the being. The being signs the event, the
// participant never does — so no surface may say "signed by"/"podpisano".
// Divergence between beings is BY DESIGN — one record per being per
// participant, never merged across beings.

const CHANGE_COMMITMENT_KIND = 37049;

export interface CommitmentPoint {
  text: string;
  addresses: { given: string[]; received: string[] };
}

export interface CommitmentTask {
  id: string;
  text: string;
  source: string;   // 'being' | 'coverage'
}

export interface CommitmentCoverage {
  covered_given: string[];
  covered_received: string[];
  uncovered_given: string[];
  uncovered_received: string[];
}

export interface CommitmentVerification {
  coverage_ok: boolean;
  substance_ok: boolean;
  open_tasks: number;
  reasoning: string;
}

export interface ChangeCommitment {
  beingPubkey: string;
  beingName: string;
  participantPubkey: string;
  caseRoot: string;
  processPhase: string;   // phase WHEN RECORDED — never present as the current phase
  lang: 'sl' | 'en';
  // 'violated' is RESERVED and never published in v1 — anything unexpected
  // must render as unknown, never as a verdict.
  status: 'forming' | 'complete';
  statedCommitment: string;   // may be '' while forming — then only tasks exist
  points: CommitmentPoint[];
  tasks: CommitmentTask[];
  coverage: CommitmentCoverage | null;
  verification: CommitmentVerification | null;
  revision: number;
  firstStatedAt: string | null;
  firstCompleteAt: string | null;
  updatedAt: string | null;
  created_at: number;
}

export const useOwnCommitments = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [commitments, setCommitments] = useState<ChangeCommitment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setCommitments([]); return; }
    let cancelled = false;
    setCommitments([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, { kinds: [CHANGE_COMMITMENT_KIND], '#e': [caseRoot], limit: 500 });
        if (cancelled) return;
        // Param-replaceable: newest per (being, d-tag) FIRST — dedupe must run
        // BEFORE the withdrawn filter, otherwise dropping a withdrawn newest
        // resurrects a superseded older revision.
        const newest = new Map<string, { at: number; ev: any; body: any }>();
        for (const ev of evs) {
          let body: any;
          try { body = JSON.parse(ev.content); } catch { continue; }
          if (!body || typeof body !== 'object') continue;
          const d = (ev.tags as string[][]).find((t) => t[0] === 'd')?.[1] || '';
          const k = `${ev.pubkey}|${d}`;
          const cur = newest.get(k);
          if (cur && cur.at >= ev.created_at) continue;
          newest.set(k, { at: ev.created_at, ev, body });
        }
        const out: ChangeCommitment[] = [];
        for (const { at, ev, body } of newest.values()) {
          // Withdrawn commitments are skipped ENTIRELY (mandatory display rule).
          if (body.status === 'withdrawn') continue;
          // NOTE: an empty stated_commitment is NOT a reason to drop the record
          // — a forming commitment legitimately carries only tasks.
          const points: CommitmentPoint[] = (Array.isArray(body.points) ? body.points : [])
            .filter((p: any) => p && typeof p.text === 'string' && p.text)
            .map((p: any) => ({
              text: String(p.text),
              addresses: {
                given: Array.isArray(p.addresses?.given) ? p.addresses.given.map(String) : [],
                received: Array.isArray(p.addresses?.received) ? p.addresses.received.map(String) : [],
              },
            }));
          const tasks: CommitmentTask[] = (Array.isArray(body.tasks) ? body.tasks : [])
            .filter((t: any) => t && typeof t.text === 'string' && t.text)
            .map((t: any, i: number) => ({
              id: String(t.id || `t${i + 1}`),
              text: String(t.text),
              source: String(t.source || 'being'),
            }));
          const cov = body.coverage && typeof body.coverage === 'object' ? body.coverage : null;
          const coverage: CommitmentCoverage | null = cov ? {
            covered_given: Array.isArray(cov.covered_given) ? cov.covered_given.map(String) : [],
            covered_received: Array.isArray(cov.covered_received) ? cov.covered_received.map(String) : [],
            uncovered_given: Array.isArray(cov.uncovered_given) ? cov.uncovered_given.map(String) : [],
            uncovered_received: Array.isArray(cov.uncovered_received) ? cov.uncovered_received.map(String) : [],
          } : null;
          const ver = body.verification && typeof body.verification === 'object' ? body.verification : null;
          const verification: CommitmentVerification | null = ver ? {
            coverage_ok: !!ver.coverage_ok,
            substance_ok: !!ver.substance_ok,
            open_tasks: Number(ver.open_tasks) || 0,
            reasoning: String(ver.reasoning || ''),
          } : null;
          out.push({
            beingPubkey: ev.pubkey.toLowerCase(),
            beingName: body.being_name || '',
            participantPubkey: String(body.participant_pubkey || '').toLowerCase(),
            caseRoot: String(body.case_root || caseRoot).toLowerCase(),
            processPhase: body.process_phase || '',
            lang: body.lang === 'en' ? 'en' : 'sl',
            // Only 'complete' is a verdict; everything else (incl. a reserved
            // 'violated' that v1 never publishes) reads as still forming.
            status: body.status === 'complete' ? 'complete' : 'forming',
            statedCommitment: typeof body.stated_commitment === 'string' ? body.stated_commitment : '',
            points,
            tasks,
            coverage,
            verification,
            revision: Number(body.revision) || 1,
            firstStatedAt: body.first_stated_at || null,
            firstCompleteAt: body.first_complete_at || null,
            updatedAt: body.updated_at || null,
            created_at: at,
          });
        }
        setCommitments(out.sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)));
      } catch (e) {
        console.error('useOwnCommitments error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { commitments, isLoading };
};
