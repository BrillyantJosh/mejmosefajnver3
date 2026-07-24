import { useState, useEffect } from 'react';
import { SimplePool, nip44 } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrGroupKey } from '@/hooks/useNostrGroupKey';

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

  return { sources, isLoading };
};
