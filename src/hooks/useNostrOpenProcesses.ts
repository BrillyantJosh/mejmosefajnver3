import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { readFromRelays } from '@/lib/relayRead';

export interface OpenProcess {
  id: string;
  processEventId: string;
  title: string;
  status: string;
  phase: string;
  openedAt: number;
  initiator: string;
  /** The OPENING facilitator — the one who authored the record. */
  facilitator: string;
  /**
   * Every facilitator, in tag order, opening one first. A process can be
   * co-led (e.g. a human together with a being), and each co-facilitator
   * carries the same ['p',hex,'facilitator'] tag and the same standing.
   */
  facilitators: string[];
  participants: string[];
  guests: string[];
  language: string;
  topic?: string;
  /**
   * What the process was opened ABOUT, from the event's `content`. Nothing
   * read this before, so an opened process showed only its title. Kept raw
   * here; processDescription() decides what of it is worth reading.
   */
  description?: string;
  userRole?: string;
  /** Set when a facilitator has offered to hand this process over (cross-app: selfresponsible.life). */
  handoverTo?: string;
  createdAt?: number;
}


/** Whether the app has actually heard from a relay yet. */
export type OpenProcessStatus = 'loading' | 'ready' | 'unreachable';

/** Growing per-attempt budgets: ~33s of genuine trying before it stops. */
const ATTEMPT_BUDGETS_MS = [6_000, 10_000, 15_000];
const BACKOFF_MS = [2_000, 4_000];
/** Even if system parameters never arrive, resolve rather than spin forever. */
const PARAMS_DEADLINE_MS = 12_000;

/** Pure: relay events → the user's open processes. Unchanged from before. */
function toOpenProcesses(events: Event[], userPubkey: string): OpenProcess[] {
  return events
    .map((event: Event) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
      const status = event.tags.find(t => t[0] === 'status')?.[1] || '';
      const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
      const phase = event.tags.find(t => t[0] === 'phase')?.[1] || 'opening';
      const openedAt = parseInt(event.tags.find(t => t[0] === 'opened_at')?.[1] || '0');
      const language = event.tags.find(t => t[0] === 'lang')?.[1] || 'en';
      const topic = event.tags.find(t => t[0] === 'topic')?.[1];
      
      // Find process event reference (root event)
      // Priority: 1) e-tag with 'process'/'root' marker, 2) d-tag (should equal KIND 87044 ID), 3) event.id
      const eTagProcessId = event.tags.find(t => t[0] === 'e' && (t[3] === 'root' || t[2] === 'process'))?.[1];
      const processEventId = eTagProcessId || dTag;
      

      // Extract roles - check both index 2 and 3 for compatibility
      const getRole = (tag: string[]) => tag[3] || tag[2];
      // Lowercase all pubkeys from tags — downstream assessment lookups
      // key on lowercased hex, and role checks must be case-insensitive.
      const initiator = (event.tags.find(t => t[0] === 'p' && (t[2] === 'initiator' || t[3] === 'initiator'))?.[1] || '').toLowerCase();
      // ALL facilitators — a co-led process has more than one, and
      // reading only the first would leave the co-facilitator with no
      // role at all, so the .filter below would hide the process from
      // the very person who leads it.
      const facilitators = event.tags.filter(t => t[0] === 'p' && (t[2] === 'facilitator' || t[3] === 'facilitator')).map(t => (t[1] || '').toLowerCase()).filter(Boolean);
      const facilitator = facilitators[0] || '';
      const participants = event.tags.filter(t => t[0] === 'p' && (t[2] === 'participant' || t[3] === 'participant')).map(t => (t[1] || '').toLowerCase());
      const guests = event.tags.filter(t => t[0] === 'p' && (t[2] === 'guest' || t[3] === 'guest')).map(t => (t[1] || '').toLowerCase());

      // Check if user is in any role
      const userPk = (userPubkey || '').toLowerCase();
      let userRole: string | undefined;
      if (initiator === userPk) userRole = 'initiator';
      else if (facilitators.includes(userPk)) userRole = 'facilitator';
      else if (participants.includes(userPk)) userRole = 'participant';
      else if (guests.includes(userPk)) userRole = 'guest';

      return {
        id: dTag,
        processEventId,
        title,
        status,
        phase,
        openedAt,
        initiator,
        facilitator,
        facilitators,
        participants,
        guests,
        language,
        topic,
        description: event.content || '',
        userRole,
        handoverTo: event.tags.find(t => t[0] === 'handover_to')?.[1],
        createdAt: event.created_at
      };
    })
    .filter(process =>
      // A PAUSED process is still the person's process. Filtering to 'open'
      // only made a facilitator's pause look like deletion: on 30.8.2026 the
      // Mojca case went to status 'paused' at 05:47 and the whole community
      // saw it vanish from /own. Only 'closed' leaves the list — a pause is
      // shown (amber badge), never hidden.
      (process.status === 'open' || process.status === 'paused') &&
      process.userRole !== undefined
    )
    // A facilitator handover (selfresponsible.life) leaves TWO same-d records:
    // the outgoing facilitator's (carries handover_to) and the new one's
    // (authoritative). Order them so the authoritative + newest wins the
    // dedup below — otherwise which facilitator shows is relay-arrival luck.
    .sort((a, b) => (a.handoverTo ? 1 : 0) - (b.handoverTo ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0))
    // Deduplicate by id - keep the preferred (first after the sort above) occurrence
    .filter((process, index, self) =>
      self.findIndex(p => p.id === process.id) === index
    )
    .sort((a, b) => b.openedAt - a.openedAt);
}

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
