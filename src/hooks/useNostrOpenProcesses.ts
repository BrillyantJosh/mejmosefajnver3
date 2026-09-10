import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { readFromRelays } from '@/lib/relayRead';
import { toOpenProcesses } from '@/lib/ownProcessRecords';
import type { OpenProcess } from '@/lib/ownProcessRecords';

export type { OpenProcess };

/** Whether the app has actually heard from a relay yet. */
export type OpenProcessStatus = 'loading' | 'ready' | 'unreachable';

/** Growing per-attempt budgets: ~33s of genuine trying before it stops. */
const ATTEMPT_BUDGETS_MS = [6_000, 10_000, 15_000];
const BACKOFF_MS = [2_000, 4_000];
/** Even if system parameters never arrive, resolve rather than spin forever. */
const PARAMS_DEADLINE_MS = 12_000;

/**
 * The user's OPEN processes (KIND 37044), read from the relays.
 *
 * The rule this hook exists to enforce: "I could not reach the relays" is NOT
 * "you have no open processes". They used to be indistinguishable, for three
 * separate reasons, each of which produced the reported false empty screen:
 *
 *  1. `parameters` starts as null, so the old effect hit its guard, set
 *     isLoading=false BEFORE any query began, and the page rendered
 *     "No open processes found" as the default view of every cold load.
 *  2. `pool.querySync` cannot fail — it resolves `[]` on a dead network, so the
 *     old `catch` was dead code and the empty result flowed down the happy path.
 *  3. In `subscribeMany`, a relay that fails to CONNECT is counted as though it
 *     had sent EOSE, so a total outage completed instantly and looked like a
 *     successful empty read.
 *
 * Now: it waits for parameters, reads each relay honestly (see lib/relayRead),
 * retries with growing budgets, and accumulates events across attempts — so a
 * failed or partial refresh can only ever ADD, never blank what is on screen.
 * `status` is only 'ready' once a relay has genuinely answered; nothing else
 * licenses the empty state.
 */
export const useNostrOpenProcesses = (userPubkey: string | null) => {
  const [processes, setProcesses] = useState<OpenProcess[]>([]);
  const [status, setStatus] = useState<OpenProcessStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const { parameters } = useSystemParameters();

  // By VALUE, so the SSE heartbeat re-minting parameters.relays with a new
  // array identity cannot restart a read that is already in flight.
  const relayKey = (parameters?.relays || []).join(',');
  const relays = useMemo(() => (relayKey ? relayKey.split(',') : []), [relayKey]);

  /** Union of everything any relay has ever given us this mount. */
  const seenRef = useRef<Map<string, Event>>(new Map());

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!userPubkey) { setStatus('ready'); return; }

    const cancelled = { value: false };
    let paramsTimer: ReturnType<typeof setTimeout> | null = null;

    // Parameters have not arrived yet: stay in 'loading' — never claim the user
    // has nothing before we are even able to ask.
    if (relays.length === 0) {
      setStatus('loading');
      paramsTimer = setTimeout(() => {
        if (!cancelled.value) setStatus('unreachable');
      }, PARAMS_DEADLINE_MS);
      return () => { cancelled.value = true; if (paramsTimer) clearTimeout(paramsTimer); };
    }

    const pool = new SimplePool();
    setStatus((s) => (seenRef.current.size > 0 ? s : 'loading'));

    const absorb = (events: Event[]) => {
      let added = false;
      for (const e of events) {
        if (!seenRef.current.has(e.id)) { seenRef.current.set(e.id, e); added = true; }
      }
      if (added && !cancelled.value) {
        setProcesses(toOpenProcesses([...seenRef.current.values()], userPubkey));
      }
    };

    const run = async () => {
      const filter: Filter = { kinds: [37044], limit: 500 };
      let heardFromAnyone = false;

      for (let i = 0; i < ATTEMPT_BUDGETS_MS.length && !cancelled.value; i++) {
        const result = await readFromRelays(pool, relays, filter, {
          budgetMs: ATTEMPT_BUDGETS_MS[i],
          cancelled,
          // Paint the fast relay's answer without waiting for the slow one.
          onRelayDone: (partial) => absorb(partial.events),
        });
        if (cancelled.value) return;
        absorb(result.events);

        if (result.answered.length > 0) {
          heardFromAnyone = true;
          // Every relay spoke — this is a complete read and the only thing that
          // may license "you have none".
          if (result.failed.length === 0) break;
        }
        if (i < BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
        }
      }

      if (cancelled.value) return;
      // Anything already on screen counts: a stale-but-real list beats claiming
      // the network is down.
      setStatus(heardFromAnyone || seenRef.current.size > 0 ? 'ready' : 'unreachable');
    };

    run();

    return () => {
      cancelled.value = true;
      if (paramsTimer) clearTimeout(paramsTimer);
      try { pool.close(relays); } catch { /* already gone */ }
    };
  }, [userPubkey, relayKey, relays, attempt]);

  // Re-check when the device comes back online or the tab is looked at again,
  // but only while we have nothing to show — never disturb a good list.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      if (seenRef.current.size === 0) retry();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [retry]);

  return {
    processes,
    /** Kept for existing callers: true only while nothing can be shown yet. */
    isLoading: status === 'loading' && processes.length === 0,
    status,
    retry,
  };
};
