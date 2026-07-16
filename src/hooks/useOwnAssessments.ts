import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process assessments for one case root. The beings
// (being3) publish these as PUBLIC plaintext JSON on Nostr — anyone can read
// them, no key or decryption is needed.
//   87047 = append-only Being Assessment Entry (the chronological opinions log)
//   37045 = replaceable Being Participant Phase-State (each being's current verdict)

const ASSESSMENT_ENTRY_KIND = 87047;
const ASSESSMENT_STATE_KIND = 37045;

interface PhaseVerdict { requirement_met: boolean; confidence: number; rationale: string; }

// Additive rollup of the being's grievance ledger (kind 37046) as mirrored on
// the 87047 entries and 37045 states. Optional — older events don't carry it.
export interface GrievanceSummary {
  given: number;
  received: number;
  received_accepted: number;
  apologized: boolean;
}

export interface AssessmentEntry {
  id: string;
  beingPubkey: string;
  participantPubkey: string;
  created_at: number;
  processPhase: string;
  phaseEstimate: string;
  phases: { reflection?: PhaseVerdict; alignment?: PhaseVerdict; change?: PhaseVerdict };
  summary: string;
  overallConfidence: number;
  grievanceSummary?: GrievanceSummary | null;
}

export interface PhaseState {
  beingPubkey: string;
  participantPubkey: string;
  created_at: number;
  processPhase: string;
  currentPhaseEstimate: string;
  reflectionComplete: boolean;
  alignmentComplete: boolean;
  changeComplete: boolean;
  overallConfidence: number;
  grievanceSummary?: GrievanceSummary | null;
}

const tagVal = (ev: Event, name: string, marker?: string): string | undefined => {
  const t = ev.tags.find((x) => x[0] === name && (marker ? x[3] === marker || x[2] === marker : true));
  return t?.[1];
};

export const useOwnAssessments = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [entries, setEntries] = useState<AssessmentEntry[]>([]);
  const [states, setStates] = useState<PhaseState[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setEntries([]); setStates([]); return; }
    let cancelled = false;
    // Clear the previous process's data immediately on switch.
    setEntries([]); setStates([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, {
          kinds: [ASSESSMENT_ENTRY_KIND, ASSESSMENT_STATE_KIND],
          '#e': [caseRoot],
          limit: 5000,
        });
        if (cancelled) return;
        const entryMap = new Map<string, AssessmentEntry>();
        const stateMap = new Map<string, PhaseState>(); // being:participant, newest wins

        for (const ev of evs) {
          let body: any;
          try { body = JSON.parse(ev.content); } catch { continue; } // public plaintext only
          if (!body || typeof body !== 'object') continue;
          const participant = (tagVal(ev, 'p', 'subject') || body.participant_pubkey || '').toLowerCase();
          if (ev.kind === ASSESSMENT_ENTRY_KIND) {
            if (entryMap.has(ev.id)) continue;
            entryMap.set(ev.id, {
              id: ev.id,
              beingPubkey: ev.pubkey.toLowerCase(),
              participantPubkey: participant,
              created_at: ev.created_at,
              processPhase: tagVal(ev, 'phase') || body.process_phase || '',
              phaseEstimate: body.phase_estimate || '',
              phases: body.phases || {},
              summary: body.summary || '',
              overallConfidence: Number(body.overall_confidence) || 0,
              grievanceSummary: body.grievance_summary ?? null,
            });
          } else {
            const key = `${ev.pubkey.toLowerCase()}:${participant}`;
            const cur = stateMap.get(key);
            if (cur && cur.created_at >= ev.created_at) continue;
            stateMap.set(key, {
              beingPubkey: ev.pubkey.toLowerCase(),
              participantPubkey: participant,
              created_at: ev.created_at,
              processPhase: tagVal(ev, 'phase') || body.process_phase || '',
              currentPhaseEstimate: body.current_phase_estimate || '',
              // Flat booleans are the primary source; fall back to the nested
              // verdict objects the publisher also writes, so a state whose
              // flat fields are missing/renamed never falsely reads "not met".
              reflectionComplete: !!(body.reflection_complete ?? body.reflection?.requirement_met),
              alignmentComplete: !!(body.alignment_complete ?? body.alignment?.requirement_met),
              changeComplete: !!(body.change_complete ?? body.change?.requirement_met),
              overallConfidence: Number(body.overall_confidence) || 0,
              grievanceSummary: body.grievance_summary ?? null,
            });
          }
        }
        setEntries(Array.from(entryMap.values()).sort((a, b) => a.created_at - b.created_at));
        setStates(Array.from(stateMap.values()));
      } catch (e) {
        console.error('useOwnAssessments error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { entries, states, isLoading };
};
