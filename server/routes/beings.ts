/**
 * Beings registry proxy — the canonical list of digital beings that power the
 * /being page. The source of truth is the monitor at https://monitor.lana.is
 * (aka "Lana.is"), the same feed theLana.Life uses. That API sends no CORS
 * headers, and each being's Nostr pubkey (needed to chat with it in-app) lives
 * on the being's OWN site at https://<domain>/api/identity — so we resolve and
 * merge both here, server-side, and cache the result. New beings appearing on
 * the monitor therefore show up on /being automatically.
 */

import { Router } from 'express';

const router = Router();

const DASHBOARD_URL = 'https://monitor.lana.is/api/dashboard';
const CACHE_TTL = 3 * 60 * 1000; // 3 min
const HEX64 = /^[0-9a-f]{64}$/i;

interface RegistryBeing {
  pubkey: string;
  name: string;
  domain: string;
  displayName: string;
  picture: string | null;
  about: string;
  website: string;
  status: string;
  lastSeenAt: number;
  creatorPubkey: string | null;
  creatorName: string;
}

let cache: { data: { count: number; beings: RegistryBeing[] }; at: number } | null = null;

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(tm);
  }
}

router.get('/', async (_req, res) => {
  try {
    if (cache && Date.now() - cache.at < CACHE_TTL) return res.json(cache.data);

    const dash = await fetchJson(DASHBOARD_URL, 12_000);
    const list: any[] = Array.isArray(dash?.beings) ? dash.beings : [];

    // Resolve each being's own Nostr pubkey from its site identity (parallel).
    const resolved = await Promise.all(
      list.map(async (b): Promise<RegistryBeing | null> => {
        const domain = typeof b?.domain === 'string' ? b.domain : '';
        if (!domain) return null;
        const id = await fetchJson(`https://${domain}/api/identity`, 8_000);
        const pubkey = String(id?.pubkey || '').toLowerCase();
        if (!HEX64.test(pubkey)) return null; // no chattable being pubkey → skip
        const creatorPk = String(id?.creator_pubkey || '').toLowerCase();
        return {
          pubkey,
          name: id?.name || b?.name || domain,
          domain,
          displayName: id?.display_name || id?.title_en || id?.name || b?.name || domain,
          picture: id?.picture || null,
          about: id?.about || '',
          website: id?.website || `https://${domain}`,
          status: b?.status || 'unknown',
          lastSeenAt: b?.last_seen_at || 0,
          creatorPubkey: HEX64.test(creatorPk) ? creatorPk : null,
          creatorName: id?.creator_display_name || id?.creator_name || '',
        };
      }),
    );

    const beings = resolved.filter((b): b is RegistryBeing => b !== null);
    // Stable order: online beings first, then alphabetical.
    beings.sort((a, b) => {
      const au = a.status === 'up' ? 0 : 1;
      const bu = b.status === 'up' ? 0 : 1;
      if (au !== bu) return au - bu;
      return a.displayName.localeCompare(b.displayName);
    });

    const data = { count: beings.length, beings };
    cache = { data, at: Date.now() };
    console.log(`[beings] resolved ${beings.length}/${list.length} beings with pubkeys`);
    res.json(data);
  } catch (e: any) {
    console.error('[beings] fetch failed:', e?.message ?? e);
    // Serve stale cache on failure rather than an empty list.
    res.json(cache?.data ?? { count: 0, beings: [] });
  }
});

export default router;
