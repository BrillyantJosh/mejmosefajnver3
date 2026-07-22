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
// pride is ARMOR (Hawkins 175 — below courage) → heavy side.
export const HEAVY_EMOTIONS = [
  'anger', 'rage', 'sadness', 'hurt', 'fear', 'anxiety', 'shame', 'guilt',
  'disappointment', 'helplessness', 'loneliness', 'resentment', 'contempt',
  'disgust', 'envy', 'despair', 'pride',
] as const;
export const LIGHT_EMOTIONS = [
  'relief', 'gratitude', 'joy', 'warmth', 'compassion', 'hope',
  'enthusiasm', 'peace', 'connection',
] as const;

// Hawkins-calibrated consciousness levels (mirrors being3) — courage = 200.
export const EMOTION_HAWKINS_LEVELS: Record<string, number> = {
  shame: 20, guilt: 30, despair: 50, helplessness: 50, loneliness: 60,
  sadness: 75, hurt: 75, disappointment: 75, fear: 100, anxiety: 100,
  envy: 125, resentment: 140, anger: 150, rage: 150, disgust: 155,
  contempt: 175, pride: 175,
  relief: 250, hope: 310, enthusiasm: 350,
  compassion: 500, warmth: 500, connection: 500, gratitude: 510,
  joy: 540, peace: 600,
};
export const COURAGE_LEVEL = 200;
const MODE_W: Record<string, number> = { held: 0.2, named: 0.6, expressed: 1.0 };

export function levelToPolarity(level: number | null): number | null {
  if (level == null || !Number.isFinite(level)) return null;
  const L = Math.max(20, Math.min(600, level));
  const pol = L <= 200 ? 50 * (Math.log(L / 20) / Math.log(10)) : 50 + 50 * (Math.log(L / 200) / Math.log(3));
  return Math.round(Math.max(0, Math.min(100, pol)));
}
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
  score: number;        // 0-100, DEPTH of entry — computed by the being's CODE
  breadth: number;      // distinct emotions
  vulnerability: number;
  embodiment: number;
  intensity: number;
  swing: boolean;       // pendulum: a light emotion arrived AFTER a heavy peak
  polarity: number | null; // 0 … 100, log-mapped Hawkins level — courage(200) = 50
  level: number | null;    // Hawkins-calibrated consciousness level 20-600
}

// Client-side fallback for palettes published before level/polarity existed —
// same Hawkins formula as being3: wave- AND mode-weighted level, log-mapped.
export function computeLevelFallback(emotions: EmotionEntry[]): number | null {
  const es = emotions.filter((e) => EMOTION_HAWKINS_LEVELS[e.key] !== undefined);
  if (!es.length) return null;
  const weigh = (pick: (e: EmotionEntry) => number) => {
    let wsum = 0, lsum = 0;
    for (const e of es) {
      const w = Math.max(0, Math.min(1, pick(e))) * (MODE_W[e.mode] ?? 0.6);
      wsum += w; lsum += w * EMOTION_HAWKINS_LEVELS[e.key];
    }
    return wsum > 0 ? lsum / wsum : null;
  };
  const level = weigh((e) => e.lastIntensity) ?? weigh((e) => e.peakIntensity);
  return level == null ? null : Math.round(level);
}
export function computePolarityFallback(emotions: EmotionEntry[]): number | null {
  return levelToPolarity(computeLevelFallback(emotions));
}

export interface JourneyPoint { at: string; polarity: number; depth: number; }

// POT PREDAJE EGA — the station on the ego-surrender path. Lightness LEFT of
// the humility gate is the ego's surface; only past it is it earned.
export type EgoStation = 'ego' | 'razpoka' | 'poniznost' | 'v-sebi' | 'lahkotnost';
export interface EgoPath {
  station: EgoStation;
  passedHumility: boolean;
  felt: number;               // 0-1 dared depth into the exposing emotions
  surrender: number | null;   // 0-1 of the chances actually taken (null = no ledger)
  yielded: number; chances: number;
  lightNow: number;
  brightButUnyielded: boolean; // warm tone while the ego is still whole
}
export interface PathExtremes { heaviest: { polarity: number; at: string } | null; lightest: { polarity: number; at: string } | null; }
export interface EmotionPathVerdict { walked: boolean; stuck: 'dark' | 'light' | null; amplitude: number; heaviest: number | null; lightest: number | null; }

export interface EmotionPalette {
  beingPubkey: string;
  beingName: string;
  participantPubkey: string;
  caseRoot: string;
  processPhase: string;
  created_at: number;
  emotions: EmotionEntry[];
  depth: EmotionDepth;
  journey: JourneyPoint[];
  extremes: PathExtremes | null;
  path: EmotionPathVerdict | null;
  egoPath: EgoPath | null;
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
              // Prefer the published Hawkins level; recompute client-side for
              // bodies from before the calibration (their stored polarity was
              // the old binary balance — misleading, e.g. pride counted light).
              level: typeof d.level === 'number' ? Math.round(d.level) : computeLevelFallback(emotions),
              polarity: typeof d.level === 'number' ? levelToPolarity(d.level) : computePolarityFallback(emotions),
            },
            journey: (Array.isArray(body.journey) ? body.journey : [])
              .filter((p: any) => p && typeof p.at === 'string' && Number.isFinite(Number(p.polarity)))
              .map((p: any) => ({ at: p.at, polarity: Math.max(0, Math.min(100, Math.round(Number(p.polarity)))), depth: Math.max(0, Math.min(100, Math.round(Number(p.depth) || 0))) })),
            extremes: body.extremes && typeof body.extremes === 'object' ? {
              heaviest: body.extremes.heaviest && Number.isFinite(Number(body.extremes.heaviest.polarity)) ? { polarity: Math.round(Number(body.extremes.heaviest.polarity)), at: String(body.extremes.heaviest.at || '') } : null,
              lightest: body.extremes.lightest && Number.isFinite(Number(body.extremes.lightest.polarity)) ? { polarity: Math.round(Number(body.extremes.lightest.polarity)), at: String(body.extremes.lightest.at || '') } : null,
            } : null,
            egoPath: body.ego_path && typeof body.ego_path === 'object' ? {
              station: (['ego','razpoka','poniznost','v-sebi','lahkotnost'].includes(body.ego_path.station) ? body.ego_path.station : 'ego') as EgoStation,
              passedHumility: body.ego_path.passed_humility === true,
              felt: Math.max(0, Math.min(1, Number(body.ego_path.felt) || 0)),
              surrender: Number.isFinite(Number(body.ego_path.surrender)) ? Number(body.ego_path.surrender) : null,
              yielded: Number(body.ego_path.yielded) || 0,
              chances: Number(body.ego_path.chances) || 0,
              lightNow: Math.max(0, Math.min(1, Number(body.ego_path.light_now) || 0)),
              brightButUnyielded: body.ego_path.bright_but_unyielded === true,
            } : null,
            path: body.path && typeof body.path === 'object' ? {
              walked: body.path.walked === true,
              stuck: body.path.stuck === 'dark' || body.path.stuck === 'light' ? body.path.stuck : null,
              amplitude: Number(body.path.amplitude) || 0,
              heaviest: Number.isFinite(Number(body.path.heaviest)) ? Number(body.path.heaviest) : null,
              lightest: Number.isFinite(Number(body.path.lightest)) ? Number(body.path.lightest) : null,
            } : null,
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
