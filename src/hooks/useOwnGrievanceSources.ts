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
// Decrypted body:
//   { schema: 'lana-own-grievance-source-v1', being_pubkey, being_name,
//     case_root, prompt_rev, updated_at,
//     sources: { "<grievance_id>": [ {msg_id, sender_pubkey, created_at,
//                                     quote, truncated} ] } }
// grievance_id matches the `id` on each grievance already rendered.

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

// grievance_id -> list of source excerpts (merged across all beings, deduped
// by msg_id).
export type GrievanceSourceMap = Map<string, GrievanceSource[]>;

export const useOwnGrievanceSources = (caseRoot: string | null): {
  sources: GrievanceSourceMap;
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

  const [sources, setSources] = useState<GrievanceSourceMap>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseRoot || !groupKey || !parameters?.relays?.length) {
      setSources(new Map());
      return;
    }
    let cancelled = false;
    setSources(new Map());
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

        // grievance_id -> msg_id -> source (dedupe by msg_id across beings).
        const merged = new Map<string, Map<string, GrievanceSource>>();
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
          for (const [grievanceId, arr] of Object.entries<any>(srcMap)) {
            if (!Array.isArray(arr)) continue;
            let bucket = merged.get(grievanceId);
            if (!bucket) { bucket = new Map(); merged.set(grievanceId, bucket); }
            for (const s of arr) {
              if (!s || typeof s !== 'object') continue;
              const msgId = String(s.msg_id || '');
              if (!msgId || bucket.has(msgId)) continue;
              bucket.set(msgId, {
                msgId,
                senderPubkey: String(s.sender_pubkey || '').toLowerCase(),
                createdAt: Number(s.created_at) || 0,
                quote: String(s.quote || ''),
                truncated: !!s.truncated,
              });
            }
          }
        }

        const out: GrievanceSourceMap = new Map();
        for (const [grievanceId, bucket] of merged) {
          const list = Array.from(bucket.values()).sort((a, b) => a.createdAt - b.createdAt);
          if (list.length) out.set(grievanceId, list);
        }
        if (!cancelled) setSources(out);
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

  return { sources, isLoading, fetchOriginal };
};
