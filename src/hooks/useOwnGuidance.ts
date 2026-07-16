import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process GUIDANCE entries (KIND 87048) for one case
// root. PUBLIC plaintext JSON — anyone can read them, no key needed. Each
// being publishes independently; entries are never merged across beings.
// v1.4 (Steber 2 — SMER): an entry may nest under the exact 87047 assessment
// it was based on (based_on_state_id / second e-tag marker 'assessment') and
// carry the computed direction key + the grievance rollup it consumed.

const GUIDANCE_ENTRY_KIND = 87048;

export interface GuidanceEntry {
  id: string;
  beingPubkey: string;
  beingName: string;
  participantPubkey: string;
  created_at: number;
  processPhase: string;
  focusPhase: string;
  guidance: string;
  nextStep: string;
  guidanceType: string;   // nudge | reminder | moving-on | pause | closing-call | space | acceptance | future
  reminderNumber: number | null;
  celebration: boolean;
  // Steber 2 nesting + direction
  basedOnStateId: string | null;
  direction: string | null;
  basedOnGrievances: Record<string, unknown> | null;
}

const tagVal = (ev: Event, name: string, marker?: string): string | undefined => {
  const t = ev.tags.find((x) => x[0] === name && (marker ? x[3] === marker || x[2] === marker : true));
  return t?.[1];
};

export const useOwnGuidance = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [entries, setEntries] = useState<GuidanceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setEntries([]); return; }
    let cancelled = false;
    setEntries([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, { kinds: [GUIDANCE_ENTRY_KIND], '#e': [caseRoot], limit: 500 });
        if (cancelled) return;
        const seen = new Set<string>();
        const out: GuidanceEntry[] = [];
        for (const ev of evs) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          let body: any;
          try { body = JSON.parse(ev.content); } catch { continue; }   // public plaintext only
          if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
          out.push({
            id: ev.id,
            beingPubkey: ev.pubkey.toLowerCase(),
            beingName: body.being_name || '',
            participantPubkey: String(tagVal(ev, 'p', 'subject') || body.participant_pubkey || '').toLowerCase(),
            created_at: ev.created_at,
            processPhase: tagVal(ev, 'phase') || body.process_phase || '',
            focusPhase: body.focus_phase || '',
            guidance: typeof body.guidance === 'string' ? body.guidance : '',
            nextStep: typeof body.next_step === 'string' ? body.next_step : '',
            guidanceType: typeof body.guidance_type === 'string' ? body.guidance_type : 'nudge',
            reminderNumber: Number(body.reminder_number) || null,
            celebration: body.celebration === true,
            basedOnStateId: (typeof body.based_on_state_id === 'string' && body.based_on_state_id) || tagVal(ev, 'e', 'assessment') || null,
            direction: (typeof body.direction === 'string' && body.direction) || null,
            basedOnGrievances: (body.based_on_grievances && typeof body.based_on_grievances === 'object') ? body.based_on_grievances : null,
          });
        }
        setEntries(out.sort((a, b) => a.created_at - b.created_at));
      } catch (e) {
        console.error('useOwnGuidance error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { entries, isLoading };
};
