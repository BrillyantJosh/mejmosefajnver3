import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// Reads ALL active OWN process records (KIND 37044) — not just the current
// user's — deduped to the newest per d-tag. Powers the public-style OWN Matrix,
// where you browse every active process and inspect the beings' assessments
// (KIND 87047/37045 are public plaintext, so no keys are needed anywhere here).

export interface OwnProcessRecord {
  /** The case root id used as the #e reference by messages + being assessments. */
  caseEventId: string;
  dTag: string;
  title: string;
  phase: string;
  status: string;
  initiator: string;
  facilitator: string;
  participants: string[];
  guests: string[];
  openedAt: number;
  createdAt: number;
}

const parse = (ev: Event): OwnProcessRecord => {
  const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] || '';
  const dTag = tag('d') || ev.id;
  // Mirrors being3's own-matrix.js caseEventId derivation so the #e assessment
  // filter matches exactly what the beings published against.
  const caseEventId = dTag.startsWith('own:') ? dTag.slice(4) : (tag('e') || ev.id);
  // Lowercase every pubkey read from tags — assessment lookups key on
  // lowercased hex, so an uppercase p-tag would silently render "—".
  const roleAll = (role: string) =>
    ev.tags.filter((t) => t[0] === 'p' && (t[2] === role || t[3] === role)).map((t) => (t[1] || '').toLowerCase());
  return {
    caseEventId: caseEventId.toLowerCase(),
    dTag,
    title: tag('title') || 'Untitled',
    phase: tag('phase') || 'opening',
    status: tag('status') || 'open',
    initiator: roleAll('initiator')[0] || '',
    facilitator: roleAll('facilitator')[0] || ev.pubkey.toLowerCase(),
    participants: roleAll('participant'),
    guests: roleAll('guest'),
    openedAt: parseInt(tag('opened_at')) || ev.created_at,
    createdAt: ev.created_at,
  };
};

const isActive = (r: OwnProcessRecord) => r.status !== 'closed' && r.phase !== 'resolution';

export const useAllOwnProcesses = () => {
  const { parameters } = useSystemParameters();
  const [processes, setProcesses] = useState<OwnProcessRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!parameters?.relays?.length) { setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    const relays = parameters.relays;
    const pool = new SimplePool();
    (async () => {
      try {
        const evs = await pool.querySync(relays, { kinds: [37044], limit: 500 });
        if (cancelled) return;
        const byD = new Map<string, Event>();
        for (const ev of evs) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1] || ev.id;
          const cur = byD.get(d);
          if (!cur || ev.created_at > cur.created_at) byD.set(d, ev);
        }
        const recs = Array.from(byD.values()).map(parse)
          .filter(isActive)
          .sort((a, b) => b.openedAt - a.openedAt);
        setProcesses(recs);
      } catch (e) {
        console.error('useAllOwnProcesses error:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; pool.close(relays); };
  }, [parameters?.relays]);

  return { processes, isLoading };
};
