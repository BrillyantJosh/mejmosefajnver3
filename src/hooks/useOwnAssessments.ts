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
// the 87047 entries and 37045 states. Optional — older events don't carry it,
// and pre-1.5 bodies lack the responded/owned fields.
export interface GrievanceSummary {
  given: number;
  given_accepted_by_me?: number;
  received: number;
  received_responded?: number;
  received_accepted: number;
  apologized: boolean;
}

// The being's own statement that it is WAITING for this participant (an
// emotional outburst that damages relationships was noticed). Absent on every
// 37045 published before the feature existed — absent means NOT silenced, and
// the publisher may also emit an explicit `{ silenced: false }`, so the only
// safe gate is `silenced === true` (see isSilenced below).
//
// NOTE: `since` / `resume_at` are ISO 8601 STRINGS, unlike every other
// timestamp in this codebase (which are unix seconds). Never feed them to a
// `* 1000` helper.
export interface SilenceState {
  silenced: boolean;
  reason: string;
  since: string;
  resume_at: string | null;
}

// Steber 3 rollup mirrored from the being's 37047 palette.
export interface EmotionRollup {
  depth: number;
  breadth: number;
  top?: string[];
  swing?: boolean;
  polarity?: number | null;
  path?: { walked: boolean; stuck: 'dark' | 'light' | null; amplitude: number; heaviest: number | null; lightest: number | null } | null;
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
  emotionSummary?: EmotionRollup | null;
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
  emotionSummary?: EmotionRollup | null;
  silence?: SilenceState | null;
}

// The ONE rule for "is this being waiting?". An absent field and an explicit
// `{ silenced: false }` both mean NOT silenced — truthiness would get the
// second case wrong and put a notice on someone who is fine.
export const isSilenced = (s?: SilenceState | null): boolean => s?.silenced === true;

export interface SilenceRollup {
  waiting: number;      // how many of these beings are waiting
  total: number;        // how many beings are in the set at all
  any: boolean;
  resumeAt: string | null;  // the LATEST resume_at among the waiting ones
  openEnded: boolean;       // at least one waiting being named no end date
}

// Per-being divergence is structural: one being may be waiting while another
// is not, and their states are never merged. An aggregate view must therefore
// say HOW MANY are waiting rather than flatten it to a single yes/no.
export const silenceRollup = (states: PhaseState[]): SilenceRollup => {
  const waiting = states.filter((s) => isSilenced(s.silence));
  let resumeAt: string | null = null;
  let openEnded = false;
  for (const s of waiting) {
    const raw = s.silence?.resume_at ?? null;
    const t = raw ? Date.parse(raw) : NaN;
    if (Number.isNaN(t)) { openEnded = true; continue; }   // no end date, or unparseable
    if (resumeAt === null || t > Date.parse(resumeAt)) resumeAt = raw;
  }
  return { waiting: waiting.length, total: states.length, any: waiting.length > 0, resumeAt, openEnded };
};

// resume_at as a LOCAL DATE the reader can act on. Returns null when there is
// nothing truthful to print (missing or unparseable) — the caller then uses the
// open-ended wording instead of showing "null" or "Invalid Date".
// The date may already lie in the PAST (37045 is replaceable and a record can
// lag) — that is fine to show; never turn it into a countdown.
// Slovene needs the GENITIVE here: the sentence is "…čakajo v tišini do 31.
// JULIJA 2026…", and toLocaleDateString only ever yields the nominative
// ("31. julij 2026"), which reads as a grammatical error to every Slovene
// reader. Small thing, but this sentence is about a real person and will be
// read by the people in the process.
const SL_MONTHS_GENITIVE = [
  'januarja', 'februarja', 'marca', 'aprila', 'maja', 'junija',
  'julija', 'avgusta', 'septembra', 'oktobra', 'novembra', 'decembra',
];

export const formatResumeDate = (iso: string | null | undefined, lang: 'sl' | 'en'): string | null => {
  // MUST be a string. `new Date(<number>)` reads a number as epoch
  // MILLISECONDS, so a publisher writing unix SECONDS — the convention every
  // other timestamp in this codebase follows — would render "21. januarja
  // 1970" as a confident answer instead of falling through to the
  // open-ended wording.
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (lang === 'en') {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return `${d.getDate()}. ${SL_MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
};

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
              emotionSummary: body.emotion_summary ?? null,
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
              emotionSummary: body.emotion_summary ?? null,
              silence: body.silence ?? null,
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
