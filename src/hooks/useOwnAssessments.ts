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
  /**
   * Does the publishing being LEAD this case? Stamped by the being itself, so
   * it is an honest self-report and never proof — the roster allowlist is what
   * actually decides. Kept as a second, independent lock: a guest being that
   * correctly stamps `false` cannot close a composer even if a surface forgets
   * to narrow its allowlist. Absent on records published before the rule
   * existed, which must keep behaving as they did.
   */
  binding?: boolean;
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
// Expiry is applied here too, on the SAME predicate the gate uses. Two
// definitions of "in silence" on one screen is its own defect: the composer
// would come back while the matrix beside it still announced that the beings
// were waiting, and the reader has no way to tell which one to believe.
// A guest being's silence is left OUT of this on purpose. What the notice says
// — "the beings are waiting … before the process continues", "the verdict below
// is not updated while it holds" — is a statement about the PROCESS, and only a
// being that leads the case can make the process wait. Counting an opinion here
// froze a participant on every board while the composer beside it was open:
// two answers on one screen, and no way for the reader to tell which is true.
export const silenceRollup = (states: PhaseState[], now: number = Date.now()): SilenceRollup => {
  const waiting = states.filter((s) => s.silence?.binding !== false && silenceActiveAt(s.silence, now));
  let resumeAt: string | null = null;
  let openEnded = false;
  for (const s of waiting) {
    const stated = isoMs(s.silence?.resume_at);
    if (stated === null) { openEnded = true; continue; }   // no end date the being itself named
    if (resumeAt === null || stated > Date.parse(resumeAt)) resumeAt = s.silence?.resume_at ?? null;
  }
  return { waiting: waiting.length, total: states.length, any: waiting.length > 0, resumeAt, openEnded };
};

// Is THIS being's silence still running at `now`?
//
// `silenceRollup` above answers "did a being declare silence?" — right for a
// display that reports the beings' standing position. This answers the narrower
// question a GATE has to ask: "is that silence still in force this second?".
//
// An expired record never keeps anyone quiet. 37045 is replaceable, so a being
// that stops publishing (crash, key rotation, case moved on) leaves its last
// state standing forever, and reading it literally would mute a person for
// good. Wrongly silencing someone is the worse error, so a resume_at in the
// PAST fails OPEN.
//
// Missing or unparseable `resume_at` is NOT an expiry — the being named no end.
// But "no end named" must never become "no end at all": the protocol's own hard
// cap is 10 days after onset, so an undated silence falls back to
// `since + 10 days`. Without that, one record with a null date — or a publisher
// that emits unix seconds by mistake — mutes a person for the rest of time.
// If `since` is unusable too there is nothing left to bound it with, and the
// only safe answer is to let them speak.
// (`typeof === 'string'` matters: these two are ISO 8601 while every other
// timestamp here is unix seconds, and `Date.parse(<number>)` would not save
// us — see formatResumeDate below.)
const MAX_SILENCE_MS = 10 * 24 * 60 * 60 * 1000;

/** ISO string → ms, or null for anything else (including a number). */
const isoMs = (raw: unknown): number | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
};

/** When this silence stops holding, or null when nothing can bound it. */
export const silenceEndsAt = (s: SilenceState | null | undefined): number | null => {
  const stated = isoMs(s?.resume_at);
  if (stated !== null) return stated;
  const since = isoMs(s?.since);
  return since === null ? null : since + MAX_SILENCE_MS;
};

const silenceActiveAt = (s: SilenceState | null | undefined, now: number): boolean => {
  if (!isSilenced(s)) return false;
  const ends = silenceEndsAt(s);
  if (ends === null) return false;   // unbounded and unanchored — never a life sentence
  return ends > now;
};

export interface ActiveSilence {
  blocked: boolean;         // at least one being is silent toward this person RIGHT NOW
  waiting: number;          // how many of them
  resumeAt: string | null;  // the LATEST resume_at among the still-running silences
  openEnded: boolean;       // at least one of them named no usable end
}

// The beings' silence toward ONE participant, as of `now`. Per-being divergence
// is structural — one being may be waiting while another speaks — so ANY being
// still in silence holds the gate, and the end date shown is the LAST one to
// lapse (releasing at the earliest date would speak for beings that have not
// released anyone).
//
// Blocking requires a POSITIVE, still-running record: an empty `states` (not
// fetched yet, fetch failed, being never published) yields blocked = false.
// That is what makes it impossible to silence someone the beings never named.
// SPOOF PROTECTION. 37045 is public plaintext and unauthenticated — anyone can
// sign one naming any case and any subject. That was harmless while this kind
// only fed a display (a bogus row was an obviously bogus extra column), but a
// gate is access control: without an allowlist any stranger could take away a
// named person's ability to speak, and the state map keys on the author, so a
// forgery never even has to outrace a real being's record.
// `allowedAuthors` is the process's LEADERSHIP — the pubkeys tagged
// `facilitator` in KIND 37044, which is where standing in a case comes from.
// Guest beings belong in the display but NOT here: they publish an opinion,
// and an opinion must never cost someone their voice. Exactly the discipline
// useNostrProcessPauseState already applies to 87056.
// Pass an EMPTY/undefined list only where no gate depends on the answer: an
// empty allowlist blocks nobody, which is the safe direction.
export const activeSilenceFor = (
  states: PhaseState[],
  participantPubkey: string | null | undefined,
  now: number = Date.now(),
  allowedAuthors?: Iterable<string> | null,
): ActiveSilence => {
  const me = (participantPubkey || '').toLowerCase();
  const none: ActiveSilence = { blocked: false, waiting: 0, resumeAt: null, openEnded: false };
  if (!me) return none;
  const allowed = allowedAuthors
    ? new Set(Array.from(allowedAuthors, (a) => String(a || '').toLowerCase()).filter(Boolean))
    : null;
  if (allowed && allowed.size === 0) return none;
  const running = states.filter(
    (s) => s.participantPubkey === me
      && (!allowed || allowed.has(String(s.beingPubkey || '').toLowerCase()))
      // Second lock: a being that says of itself "I do not lead this case"
      // is taken at its word in the SAFE direction only. Older records carry
      // no `binding` at all and keep their previous behaviour; the allowlist
      // above is what actually keeps a guest being out of the gate.
      && s.silence?.binding !== false
      && silenceActiveAt(s.silence, now),
  );
  if (running.length === 0) return none;
  let latest: number | null = null;
  let resumeAt: string | null = null;
  let openEnded = false;
  for (const s of running) {
    const stated = isoMs(s.silence?.resume_at);
    // A being that named no end is still bounded by the 10-day cap, but we do
    // not print that derived date as if the being had promised it.
    if (stated === null) { openEnded = true; continue; }
    if (latest === null || stated > latest) { latest = stated; resumeAt = s.silence?.resume_at ?? null; }
  }
  return { blocked: true, waiting: running.length, resumeAt, openEnded };
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
  // WITH THE TIME OF DAY. A silence that runs out at 09:04 read as "until
  // 3 August" tells someone their whole day is gone, and they wait it out for
  // nothing. The resume moment is exact — a rolling window from their last
  // message — so print it exactly, in the reader's own timezone.
  const hm = d.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'sl-SI', { hour: '2-digit', minute: '2-digit' });
  if (lang === 'en') {
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} at ${hm}`;
  }
  return `${d.getDate()}. ${SL_MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()} ob ${hm}`;
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
        // TWO queries, never one. KIND 87047 is append-only and grows without
        // bound; KIND 37045 is replaceable and stays tiny — at most one per
        // (being, participant). A relay applies `limit` PER FILTER and returns
        // the NEWEST, so asking for both together lets a long case's history
        // crowd the states out: on 2026-08-01 a case with ~490 messages showed
        // "Še ni ocene" for the two participants whose verdicts were oldest
        // (24 and 30 July), while the two assessed that morning came through.
        // The data was on the relays the whole time. own-matrix.js already
        // carries this exact fix; this hook never got it.
        const [entryEvs, stateEvs] = await Promise.all([
          pool.querySync(relays, { kinds: [ASSESSMENT_ENTRY_KIND], '#e': [caseRoot], limit: 5000 }),
          pool.querySync(relays, { kinds: [ASSESSMENT_STATE_KIND], '#e': [caseRoot], limit: 500 }),
        ]);
        const evs = [...entryEvs, ...stateEvs];
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
