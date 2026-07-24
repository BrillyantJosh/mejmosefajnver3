import { useState, useEffect, useCallback } from 'react';
import { SimplePool, nip44 } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrGroupKey } from '@/hooks/useNostrGroupKey';

const GROUP_MESSAGE_KIND = 87046;
const OWN_API_URL = import.meta.env.VITE_API_URL ?? '';
const DM_AUDIO_BUCKET = 'dm-audio';

// The original chat message a source points to, decrypted from its 87046 event.
export interface OriginalMessage {
  senderPubkey: string;
  createdAt: number;
  transcript: string;      // full message text / audio transcript (never capped)
  audioUrl?: string;       // present when the source message was a voice note
  audioDuration?: number;
}

// Parse the raw 87046 payload text into transcript + optional audio, exactly as
// the OWN chat (Own.tsx) does: "audio:<path>|dur:<n>|transcript:<text>".
function parseMessagePayload(text: string): { transcript: string; audioUrl?: string; audioDuration?: number } {
  const t = String(text || '').trim();
  if (t.startsWith('audio:')) {
    const raw = t.slice('audio:'.length).trim();
    let before = raw;
    let transcript = '';
    const ti = raw.indexOf('|transcript:');
    if (ti !== -1) { transcript = raw.slice(ti + '|transcript:'.length); before = raw.slice(0, ti); }
    let path = before;
    let audioDuration: number | undefined;
    const dm = before.match(/^(.+)\|dur:(\d+)$/);
    if (dm) { path = dm[1]; audioDuration = parseInt(dm[2], 10); }
    const audioUrl = path.startsWith('http') ? path : `${OWN_API_URL}/api/storage/${DM_AUDIO_BUCKET}/${path}`;
    return { transcript, audioUrl, audioDuration };
  }
  // Legacy: a full audio URL embedded in the text.
  if (t.includes('supabase.co/storage/v1/object/public/dm-audio')) {
    const m = t.match(/https:\/\/[^\s]+/);
    return { transcript: '', audioUrl: m ? m[0] : t };
  }
  return { transcript: t };
}

// PARTICIPANT-ONLY "source of grievance" reader.
//
// Each being publishes KIND 37050 (param-replaceable, d = caseRoot) whose
// `content` is NIP-44 encrypted with the per-process GROUP KEY — the SAME key
// the 87046 chat uses. We reuse the exact group-key path (useNostrGroupKey,
// which fetches KIND 87045 for the logged-in user and decrypts it). If the
// viewer is NOT a participant they never obtain the group key, so decryption
// fails and we simply return nothing — that IS the privacy gate, no UI-only
// hiding is added anywhere.
//
// Decrypted body — TWO schemas coexist on relays:
//   v1 ('lana-own-grievance-source-v1'):
//     sources: { "<grievance_id>": [ {msg_id, sender_pubkey, created_at,
//                                     quote, truncated} ] }   (bare array)
//   v2 ('lana-own-grievance-source-v2'):
//     sources: { "<grievance_id>": { from_pubkey, to_pubkey, summary_snapshot,
//                                    support: null|{deed,target}, unsourced,
//                                    attempts, entries: [ ...same shape... ] } }
// grievance_id matches the `id` on each grievance already rendered — but ONLY
// within the SAME being's ledger: ids (g1..gN) are per-being sequential, so
// sources are keyed by (being, grievance_id) and NEVER merged across beings.

const GRIEVANCE_SOURCE_KIND = 37050;

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export interface GrievanceSource {
  msgId: string;
  senderPubkey: string;
  createdAt: number;
  quote: string;
  truncated: boolean;
}

// One being's source record for ONE of its own grievance ids. v2 bodies carry
// the full record; v1 bodies are a bare entries array → wrapped with
// null/false metadata so both render through the same path.
export interface SourceRecord {
  fromPubkey: string | null;   // giver, as the being recorded it (v2 only)
  toPubkey: string | null;     // target, as the being recorded it (v2 only)
  support: { deed: boolean; target: boolean } | null;   // v2 verdict; null = unknown (v1)
  unsourced: boolean;          // true = the being found NO message voicing this
  entries: GrievanceSource[];
}

// beingPubkeyLower -> grievance_id -> record. NEVER merged across beings —
// grievance ids (g1..gN) are per-being sequential, so a bare-gid merge renders
// being A's g8 sources under being B's completely different g8.
export type BeingSourceMap = Map<string, Map<string, SourceRecord>>;

// beingPubkeyLower -> "from|to" pair -> the msg_ids that being's sources cite
// for that directed pair. Built ONCE per page (cheap) for the corroboration
// chip: a source only "corroborates" across beings when another being records
// the SAME (from,to) grievance citing ≥1 of the same messages.
export type PairMsgIdMap = Map<string, Map<string, Set<string>>>;

export function buildPairMsgIdMap(
  ledgers: { beingPubkey: string; grievances: { id: string; fromPubkey: string; toPubkey: string }[] }[],
  sourcesByBeing: BeingSourceMap,
): PairMsgIdMap {
  const out: PairMsgIdMap = new Map();
  for (const l of ledgers) {
    const being = (l.beingPubkey || '').toLowerCase();
    const gidMap = sourcesByBeing.get(being);
    if (!gidMap) continue;
    let pairMap = out.get(being);
    for (const g of l.grievances) {
      const rec = gidMap.get(g.id);
      if (!rec || rec.entries.length === 0) continue;
      const key = `${g.fromPubkey}|${g.toPubkey}`;
      if (!pairMap) { pairMap = new Map(); out.set(being, pairMap); }
      let set = pairMap.get(key);
      if (!set) { set = new Set(); pairMap.set(key, set); }
      for (const e of rec.entries) set.add(e.msgId);
    }
  }
  return out;
}

// Entries parser shared by v1 (bare array) and v2 (record.entries) — dedupe by
// msg_id WITHIN one being's record, oldest first.
const parseEntries = (arr: any[]): GrievanceSource[] => {
  const byMsg = new Map<string, GrievanceSource>();
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const msgId = String(s.msg_id || '');
    if (!msgId || byMsg.has(msgId)) continue;
    byMsg.set(msgId, {
      msgId,
      senderPubkey: String(s.sender_pubkey || '').toLowerCase(),
      createdAt: Number(s.created_at) || 0,
      quote: String(s.quote || ''),
      truncated: !!s.truncated,
    });
  }
  return Array.from(byMsg.values()).sort((a, b) => a.createdAt - b.createdAt);
};

export const useOwnGrievanceSources = (caseRoot: string | null): {
  sourcesByBeing: BeingSourceMap;
  beingsWithSources: number;
  isLoading: boolean;
  fetchOriginal: (msgId: string) => Promise<OriginalMessage | null>;
} => {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  // Reuse the exact group-key plumbing used by the process chat. caseRoot is
  // the process root event id (same value fed to useNostrGroupKey as
  // processEventId for KIND 87045 / the 87046 chat).
  const { groupKey } = useNostrGroupKey(
    caseRoot,
    session?.nostrHexId || null,
    session?.nostrPrivateKey || null,
  );

  const [sourcesByBeing, setSourcesByBeing] = useState<BeingSourceMap>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !groupKey || !parameters?.relays?.length) {
      setSourcesByBeing(new Map());
      return;
    }
    let cancelled = false;
    setSourcesByBeing(new Map());
    setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();
    const groupKeyBytes = hexToBytes(groupKey);

    (async () => {
      try {
        const evs = await pool.querySync(relays, {
          kinds: [GRIEVANCE_SOURCE_KIND],
          '#e': [caseRoot],
          limit: 500,
        });
        if (cancelled) return;

        // Newest replaceable event per being wins.
        const latestPerBeing = new Map<string, { created_at: number; content: string; pubkey: string }>();
        for (const ev of evs) {
          const being = ev.pubkey.toLowerCase();
          const cur = latestPerBeing.get(being);
          if (cur && cur.created_at >= ev.created_at) continue;
          latestPerBeing.set(being, { created_at: ev.created_at, content: ev.content, pubkey: ev.pubkey });
        }

        // (being, grievance_id) -> record. The 37050 author (ev.pubkey) IS the
        // being — sources are keyed per being and NEVER merged across beings.
        const byBeing: BeingSourceMap = new Map();
        for (const { content, pubkey } of latestPerBeing.values()) {
          let body: any;
          try {
            const convKey = nip44.v2.utils.getConversationKey(groupKeyBytes, pubkey);
            body = JSON.parse(nip44.v2.decrypt(content, convKey));
          } catch {
            // Not a participant / undecryptable / malformed → skip silently.
            continue;
          }
          const srcMap = body?.sources;
          if (!srcMap || typeof srcMap !== 'object') continue;
          const gidMap = new Map<string, SourceRecord>();
          for (const [grievanceId, raw] of Object.entries<any>(srcMap)) {
            if (Array.isArray(raw)) {
              // v1: a bare entries array, no verdict metadata.
              gidMap.set(grievanceId, {
                fromPubkey: null, toPubkey: null, support: null,
                unsourced: false, entries: parseEntries(raw),
              });
            } else if (raw && typeof raw === 'object') {
              // v2: full record — kept even with zero entries so the
              // "unsourced" verdict can still render a badge.
              gidMap.set(grievanceId, {
                fromPubkey: raw.from_pubkey ? String(raw.from_pubkey).toLowerCase() : null,
                toPubkey: raw.to_pubkey ? String(raw.to_pubkey).toLowerCase() : null,
                support: raw.support && typeof raw.support === 'object'
                  ? { deed: !!raw.support.deed, target: !!raw.support.target }
                  : null,
                unsourced: !!raw.unsourced,
                entries: parseEntries(Array.isArray(raw.entries) ? raw.entries : []),
              });
            }
          }
          // Even an empty gidMap counts: this being's 37050 DID decrypt, which
          // is what beingsWithSources measures for the corroboration gate.
          byBeing.set(pubkey.toLowerCase(), gidMap);
        }
        if (!cancelled) setSourcesByBeing(byBeing);
      } catch (e) {
        console.error('useOwnGrievanceSources error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; pool.close(relays); };
  }, [caseRoot, groupKey, parameters?.relays]);

  // Open the ORIGINAL message a source points to: fetch the 87046 event by id,
  // decrypt it with the same group key, and return its full transcript + audio.
  // Same privacy gate — no group key (non-participant) → null.
  const fetchOriginal = useCallback(async (msgId: string): Promise<OriginalMessage | null> => {
    const relays = parameters?.relays;
    if (!groupKey || !relays?.length || !/^[0-9a-f]{64}$/i.test(msgId)) return null;
    const pool = new SimplePool();
    try {
      const evs = await pool.querySync(relays, { ids: [msgId], kinds: [GROUP_MESSAGE_KIND] });
      const ev = evs[0];
      if (!ev) return null;
      const convKey = nip44.v2.utils.getConversationKey(hexToBytes(groupKey), ev.pubkey);
      const payload = JSON.parse(nip44.v2.decrypt(ev.content, convKey));
      const parsed = parseMessagePayload(payload?.text || '');
      return {
        senderPubkey: ev.pubkey.toLowerCase(),
        createdAt: ev.created_at,
        transcript: parsed.transcript,
        audioUrl: parsed.audioUrl,
        audioDuration: parsed.audioDuration,
      };
    } catch {
      return null;   // undecryptable / not found / malformed
    } finally {
      pool.close(relays);
    }
  }, [groupKey, parameters?.relays]);

  return { sourcesByBeing, beingsWithSources: sourcesByBeing.size, isLoading, fetchOriginal };
};
