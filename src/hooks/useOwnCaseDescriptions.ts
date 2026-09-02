import { useEffect, useState } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { readFromRelays } from '@/lib/relayRead';

/**
 * The reason an OWN process was opened, as the initiator wrote it.
 *
 * It was never missing — it just lives one event away. selfresponsible.life
 * puts the initiator's text in the KIND 87044 CASE event and stamps the
 * KIND 37044 process record with "Process initiated: <title>" instead, and
 * this app only ever read the process record. So a case opened with 879
 * characters of reasoning showed as a bare title.
 *
 * Reading the case fixes every process already on the relays — twelve of the
 * thirteen live ones carry their text there — rather than only the ones
 * opened from now on.
 */

const CASE_KIND = 87044;
const BUDGET_MS = 12_000;

/** A 37044 points at its case as `own:<id>` or plain `<id>`. */
export function normaliseCaseId(id: string | undefined | null): string {
  const bare = String(id || '').replace(/^own:/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(bare) ? bare : '';
}

export function useOwnCaseDescriptions(caseIds: string[]): Map<string, string> {
  const { parameters } = useSystemParameters();
  const [byCase, setByCase] = useState<Map<string, string>>(new Map());

  const relays = parameters?.relays || [];
  const wanted = Array.from(new Set(caseIds.map(normaliseCaseId).filter(Boolean))).sort();
  const wantedKey = wanted.join(',');
  const relayKey = relays.join(',');

  useEffect(() => {
    if (!wanted.length || !relays.length) return;

    const cancelled = { value: false };
    const pool = new SimplePool();

    (async () => {
      try {
        const result = await readFromRelays(
          pool,
          relays,
          { kinds: [CASE_KIND], ids: wanted },
          { budgetMs: BUDGET_MS, cancelled },
        );
        if (cancelled.value) return;

        const next = new Map<string, string>();
        for (const ev of result.events) {
          const text = (ev.content || '').trim();
          if (text) next.set(ev.id.toLowerCase(), text);
        }
        // Merge rather than replace: a relay that went quiet on this pass must
        // not wipe a description we already have on screen.
        setByCase((prev) => {
          const merged = new Map(prev);
          for (const [k, v] of next) merged.set(k, v);
          return merged;
        });
      } catch {
        /* A missing description is a blank line, never an error the reader sees. */
      } finally {
        try { pool.close(relays); } catch { /* already gone */ }
      }
    })();

    return () => {
      cancelled.value = true;
      try { pool.close(relays); } catch { /* already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, relayKey]);

  return byCase;
}
