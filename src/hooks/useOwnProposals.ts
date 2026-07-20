import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process CHANGE PROPOSALS for one case root — each
// being's proposed commitment per participant, distilled from that being's own
// grievance matrix. PUBLIC plaintext JSON — no key needed.
//   37048 = param-replaceable Being Change Proposal (d = <participant>:<caseRoot>)
// Divergence between beings is BY DESIGN — one proposal per being per
// participant, never merged across beings. The vow is written in the FIRST
// person but it is the BEING'S proposal — every surface must carry the
// attribution line so it never reads as the participant's own words.

const CHANGE_PROPOSAL_KIND = 37048;

export interface ProposalPoint {
  text: string;
  addresses: { given: string[]; received: string[] };
}

export interface ChangeProposal {
  beingPubkey: string;
  beingName: string;
  participantPubkey: string;
  caseRoot: string;
  processPhase: string;   // phase WHEN PROPOSED — never present as the current phase
  lang: 'sl' | 'en';
  proposedCommitment: string;
  points: ProposalPoint[];
  revision: number;
  firstProposedAt: string | null;
  updatedAt: string | null;
  created_at: number;
}

export const useOwnProposals = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setProposals([]); return; }
    let cancelled = false;
    setProposals([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, { kinds: [CHANGE_PROPOSAL_KIND], '#e': [caseRoot], limit: 500 });
        if (cancelled) return;
        // Param-replaceable: newest per (being, d-tag).
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
        const out: ChangeProposal[] = [];
        for (const { at, ev, body } of newest.values()) {
          // Withdrawn proposals are skipped ENTIRELY (mandatory display rule).
          if (body.status === 'withdrawn') continue;
          if (!body.proposed_commitment || typeof body.proposed_commitment !== 'string') continue;
          const points: ProposalPoint[] = (Array.isArray(body.points) ? body.points : [])
            .filter((p: any) => p && typeof p.text === 'string' && p.text)
            .map((p: any) => ({
              text: String(p.text),
              addresses: {
                given: Array.isArray(p.addresses?.given) ? p.addresses.given.map(String) : [],
                received: Array.isArray(p.addresses?.received) ? p.addresses.received.map(String) : [],
              },
            }));
          out.push({
            beingPubkey: ev.pubkey.toLowerCase(),
            beingName: body.being_name || '',
            participantPubkey: String(body.participant_pubkey || '').toLowerCase(),
            caseRoot: String(body.case_root || caseRoot).toLowerCase(),
            processPhase: body.process_phase || '',
            lang: body.lang === 'en' ? 'en' : 'sl',
            proposedCommitment: body.proposed_commitment,
            points,
            revision: Number(body.revision) || 1,
            firstProposedAt: body.first_proposed_at || null,
            updatedAt: body.updated_at || null,
            created_at: at,
          });
        }
        setProposals(out.sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)));
      } catch (e) {
        console.error('useOwnProposals error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { proposals, isLoading };
};
