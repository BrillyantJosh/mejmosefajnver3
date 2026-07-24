import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process grievance ledgers for one case root. The
// beings (being3) publish these as PUBLIC plaintext JSON on Nostr — anyone
// can read them, no key or decryption is needed.
//   37046 = replaceable Being Grievance Ledger (d = caseRoot, one per being)
// Multi-being divergence is BY DESIGN: each being keeps its own ledger, so we
// always return one ledger per being and never merge across beings.

const GRIEVANCE_LEDGER_KIND = 37046;

export interface Grievance {
  id: string;
  fromPubkey: string;
  toPubkey: string;
  summary: string;
  expressedAt: number;
  status: 'open' | 'accepted';
  acceptedAt: number | null;
  apologyNoted: boolean;
  // Steber 1.5 — grievances are the axis of all three phases:
  // reflection completes once the TARGET responded to every received
  // grievance (any expressed reaction counts); alignment completes once the
  // GIVER also owns each given grievance as their own delusion.
  respondedByTarget: boolean;
  acceptedByGiver: boolean;
  confidence: number;
  lastUpdateAt: number;
  // Evidence-gating (37050 v2 era) — all default false/absent on legacy bodies:
  disputedByGiver: boolean;      // the giver denies ever voicing this grievance
  disputedAt: number | null;
  disputeEvidence: string;       // abstract of the giver's denial, when present
  grounded: boolean;             // true = entry was evidence-gated at creation
  evidenceMsgIds: string[];
}

export interface GrievanceRollup {
  given: number;
  given_accepted_by_me: number;
  received: number;
  received_responded: number;
  received_accepted: number;
  apologized: boolean;
}

export interface GrievanceLedger {
  beingPubkey: string;
  created_at: number;
  processPhase: string;
  grievances: Grievance[];
  participants: Record<string, GrievanceRollup>;
  archived: Record<string, { given: number; received: number }>;
}

export const useOwnGrievances = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [ledgers, setLedgers] = useState<GrievanceLedger[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setLedgers([]); return; }
    let cancelled = false;
    // Clear the previous process's data immediately on switch.
    setLedgers([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, {
          kinds: [GRIEVANCE_LEDGER_KIND],
          '#e': [caseRoot],
          limit: 500,
        });
        if (cancelled) return;
        const ledgerMap = new Map<string, { created_at: number; ev: Event; body: any }>(); // being, newest wins

        for (const ev of evs) {
          let body: any;
          try { body = JSON.parse(ev.content); } catch { continue; } // public plaintext only
          if (!body || typeof body !== 'object') continue;
          const being = ev.pubkey.toLowerCase();
          const cur = ledgerMap.get(being);
          if (cur && cur.created_at >= ev.created_at) continue;
          ledgerMap.set(being, { created_at: ev.created_at, ev, body });
        }

        const out: GrievanceLedger[] = [];
        for (const [being, { created_at, body }] of ledgerMap) {
          const grievances: Grievance[] = Array.isArray(body.grievances)
            ? body.grievances
                .filter((g: any) => g && typeof g === 'object')
                .map((g: any) => ({
                  id: String(g.id || ''),
                  fromPubkey: String(g.from_pubkey || '').toLowerCase(),
                  toPubkey: String(g.to_pubkey || '').toLowerCase(),
                  summary: String(g.summary || ''),
                  expressedAt: Number(g.expressed_at) || 0,
                  status: g.status === 'accepted' ? 'accepted' as const : 'open' as const,
                  acceptedAt: g.accepted_at != null ? Number(g.accepted_at) || 0 : null,
                  apologyNoted: !!g.apology_noted,
                  // Legacy (pre-1.5) bodies lack the flags: accepted ⊃ responded,
                  // giver-owning never existed before → false.
                  respondedByTarget: g.responded_by_target ?? (g.status === 'accepted'),
                  acceptedByGiver: !!g.accepted_by_giver,
                  confidence: Number(g.confidence) || 0,
                  lastUpdateAt: Number(g.last_update_at) || 0,
                  disputedByGiver: !!g.disputed_by_giver,
                  disputedAt: g.disputed_at != null ? Number(g.disputed_at) || 0 : null,
                  disputeEvidence: String(g.dispute_evidence || ''),
                  grounded: !!g.grounded,
                  evidenceMsgIds: Array.isArray(g.evidence_msg_ids) ? g.evidence_msg_ids.map(String) : [],
                }))
            : [];

          const participants: Record<string, GrievanceRollup> = {};
          if (body.participants && typeof body.participants === 'object') {
            for (const [pk, r] of Object.entries<any>(body.participants)) {
              if (!r || typeof r !== 'object') continue;
              const pkl = pk.toLowerCase();
              // Legacy rollups lack the 1.5 fields — derive them from the
              // (already migrated) grievance entries so the matrix never
              // shows 0/N for an all-accepted legacy ledger.
              const mine = { given: grievances.filter((g) => g.fromPubkey === pkl), received: grievances.filter((g) => g.toPubkey === pkl) };
              participants[pkl] = {
                given: Number(r.given) || 0,
                given_accepted_by_me: r.given_accepted_by_me != null ? Number(r.given_accepted_by_me) || 0 : mine.given.filter((g) => g.acceptedByGiver).length,
                received: Number(r.received) || 0,
                received_responded: r.received_responded != null ? Number(r.received_responded) || 0 : mine.received.filter((g) => g.respondedByTarget).length,
                received_accepted: Number(r.received_accepted) || 0,
                apologized: !!r.apologized,
              };
            }
          }

          const archived: Record<string, { given: number; received: number }> = {};
          if (body.archived && typeof body.archived === 'object') {
            for (const [pk, r] of Object.entries<any>(body.archived)) {
              if (!r || typeof r !== 'object') continue;
              archived[pk.toLowerCase()] = {
                given: Number(r.given) || 0,
                received: Number(r.received) || 0,
              };
            }
          }

          out.push({
            beingPubkey: being,
            created_at,
            processPhase: body.process_phase || '',
            grievances,
            participants,
            archived,
          });
        }
        setLedgers(out.sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)));
      } catch (e) {
        console.error('useOwnGrievances error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { ledgers, isLoading };
};
