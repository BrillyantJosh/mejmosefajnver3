import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads the beings' OWN-process EMOTION PALETTES for one case root (Steber 3
// — ČUSTVA): how much each participant allowed themselves to feel, as each
// being records it. PUBLIC plaintext JSON — no key needed.
//   37047 = param-replaceable Being Emotion Palette (d = <participant>:<caseRoot>)
// Divergence between beings is BY DESIGN — one palette per being per
// participant, never merged across beings.

const EMOTION_PALETTE_KIND = 37047;

// The canonical taxonomy — mirrors being3 src/own-emotion-palette.js. The
// UI lists ALL of these so it is visible which were triggered and which not.
export const HEAVY_EMOTIONS = [
  'anger', 'rage', 'sadness', 'hurt', 'fear', 'anxiety', 'shame', 'guilt',
  'disappointment', 'helplessness', 'loneliness', 'resentment', 'contempt',
  'disgust', 'envy', 'despair',
] as const;
export const LIGHT_EMOTIONS = [
  'relief', 'gratitude', 'joy', 'warmth', 'compassion', 'hope', 'pride',
  'enthusiasm', 'peace', 'connection',
] as const;
export const EMOTION_LABELS: Record<string, { sl: string; en: string }> = {
  anger: { sl: 'jeza', en: 'anger' }, rage: { sl: 'bes', en: 'rage' },
  sadness: { sl: 'žalost', en: 'sadness' }, hurt: { sl: 'prizadetost', en: 'hurt' },
  fear: { sl: 'strah', en: 'fear' }, anxiety: { sl: 'tesnoba', en: 'anxiety' },
  shame: { sl: 'sram', en: 'shame' }, guilt: { sl: 'krivda', en: 'guilt' },
  disappointment: { sl: 'razočaranje', en: 'disappointment' }, helplessness: { sl: 'nemoč', en: 'helplessness' },
  loneliness: { sl: 'osamljenost', en: 'loneliness' }, resentment: { sl: 'zamera', en: 'resentment' },
  contempt: { sl: 'prezir', en: 'contempt' }, disgust: { sl: 'gnus', en: 'disgust' },
  envy: { sl: 'zavist', en: 'envy' }, despair: { sl: 'obup', en: 'despair' },
  relief: { sl: 'olajšanje', en: 'relief' }, gratitude: { sl: 'hvaležnost', en: 'gratitude' },
  joy: { sl: 'veselje', en: 'joy' }, warmth: { sl: 'toplina', en: 'warmth' },
  compassion: { sl: 'sočutje', en: 'compassion' }, hope: { sl: 'upanje', en: 'hope' },
  pride: { sl: 'ponos', en: 'pride' }, enthusiasm: { sl: 'navdušenje', en: 'enthusiasm' },
  peace: { sl: 'mir', en: 'peace' }, connection: { sl: 'povezanost', en: 'connection' },
};

export interface EmotionEntry {
  key: string;
  peakIntensity: number;
  lastIntensity: number;
  mode: 'expressed' | 'named' | 'held';
  evidence: string;
  firstSeenAt: string | null;
  peakAt: string | null;
}

export interface EmotionDepth {
  score: number;        // 0-100, computed by the being's CODE
  breadth: number;      // distinct emotions
  vulnerability: number;
  embodiment: number;
  intensity: number;
  swing: boolean;       // pendulum: a light emotion arrived AFTER a heavy peak
}

export interface EmotionPalette {
  beingPubkey: string;
  beingName: string;
  participantPubkey: string;
  caseRoot: string;
  processPhase: string;
  created_at: number;
  emotions: EmotionEntry[];
  depth: EmotionDepth;
}

export const useOwnEmotions = (caseRoot: string | null) => {
  const { parameters } = useSystemParameters();
  const [palettes, setPalettes] = useState<EmotionPalette[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !parameters?.relays?.length) { setPalettes([]); return; }
    let cancelled = false;
    setPalettes([]); setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();

    (async () => {
      try {
        const evs = await pool.querySync(relays, { kinds: [EMOTION_PALETTE_KIND], '#e': [caseRoot], limit: 500 });
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
        const out: EmotionPalette[] = [];
        for (const { at, ev, body } of newest.values()) {
          const emotions: EmotionEntry[] = (Array.isArray(body.emotions) ? body.emotions : [])
            .filter((e: any) => e && typeof e.key === 'string' && EMOTION_LABELS[e.key])
            .map((e: any) => ({
              key: e.key,
              peakIntensity: Math.max(0, Math.min(1, Number(e.peak_intensity) || 0)),
              lastIntensity: Math.max(0, Math.min(1, Number(e.last_intensity) || 0)),
              mode: e.mode === 'expressed' || e.mode === 'held' ? e.mode : 'named',
              evidence: String(e.evidence_abstract || ''),
              firstSeenAt: e.first_seen_at || null,
              peakAt: e.peak_at || null,
            }));
          const d = body.depth || {};
          out.push({
            beingPubkey: ev.pubkey.toLowerCase(),
            beingName: body.being_name || '',
            participantPubkey: String(body.participant_pubkey || '').toLowerCase(),
            caseRoot: String(body.case_root || caseRoot).toLowerCase(),
            processPhase: body.process_phase || '',
            created_at: at,
            emotions,
            depth: {
              score: Math.max(0, Math.min(100, Number(d.score) || 0)),
              breadth: Number(d.breadth) || emotions.length,
              vulnerability: Number(d.vulnerability) || 0,
              embodiment: Number(d.embodiment) || 0,
              intensity: Number(d.intensity) || 0,
              swing: d.swing === true,
            },
          });
        }
        setPalettes(out.sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)));
      } catch (e) {
        console.error('useOwnEmotions error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, parameters?.relays]);

  return { palettes, isLoading };
};
