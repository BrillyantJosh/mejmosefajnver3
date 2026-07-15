import { useState, useEffect, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// KIND 87056 — "OWN ▲ Facilitator Pause / Reopen".
// Regular, NON-replaceable (history accumulates — a facilitator may pause and
// reopen repeatedly), PUBLIC/unencrypted (every participant must read it without
// the group key to know the process is paused), signed by the FACILITATOR.
// A single 'pause' with an `until` timestamp locks the process; the latest event
// wins. Reopen early with 'resume'. Auto-reopens when `until` passes (no server).
export const PROCESS_PAUSE_KIND = 87056;

export type ProcessPauseAction = 'pause' | 'resume';

export interface ProcessPauseEvent {
  id: string;
  authorPubkey: string;
  action: ProcessPauseAction;
  until: number | null; // unix seconds (only set for 'pause')
  note: string;
  createdAt: number;
}

/**
 * Reads KIND 87056 pause/reopen events for a single OWN process (by its
 * processEventId), live. Only events signed by the process facilitator are
 * honoured (spoof protection — anyone can publish a 87056, only the real
 * facilitator's counts). Returns:
 *  - pauseEvents: the facilitator's pause/reopen events, de-duped by id, sorted
 *    ascending by created_at — used to render the "paused / reopened" system lines.
 *  - isLocked: whether the latest event is a 'pause' whose `until` is still in
 *    the future (auto-flips to false the moment `until` passes).
 *  - lockedUntil: the active lock's `until` (unix seconds), or null.
 *  - pauseNote: the active lock's optional facilitator note.
 */
export const useNostrProcessPauseState = (
  processEventId: string | null,
  facilitatorPubkey: string | null,
) => {
  const [allEvents, setAllEvents] = useState<ProcessPauseEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processEventId) {
      setAllEvents([]);
      setIsLoading(false);
      return;
    }

    const relays = parameters?.relays || [];
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setAllEvents([]);

    // Safety floor: if EOSE never arrives (a slow/flaky relay), stop "loading"
    // after 5s so consumers that fail-closed on the loading state aren't locked
    // out of posting forever.
    const loadingFloor = setTimeout(() => setIsLoading(false), 5000);

    const pool = new SimplePool();

    const parse = (event: Event): ProcessPauseEvent | null => {
      const actionTag = event.tags.find((t) => t[0] === 'action')?.[1];
      if (actionTag !== 'pause' && actionTag !== 'resume') return null;
      const untilRaw = event.tags.find((t) => t[0] === 'until')?.[1];
      const until = untilRaw ? Number.parseInt(untilRaw, 10) : null;
      return {
        id: event.id,
        authorPubkey: event.pubkey,
        action: actionTag,
        until: Number.isFinite(until as number) ? (until as number) : null,
        note: event.content || '',
        createdAt: event.created_at,
      };
    };

    const sub = pool.subscribeMany(
      relays,
      { kinds: [PROCESS_PAUSE_KIND], '#e': [processEventId], limit: 2000 } as any,
      {
        onevent(event: Event) {
          const parsed = parse(event);
          if (!parsed) return;
          setAllEvents((prev) => {
            if (prev.some((e) => e.id === parsed.id)) return prev;
            const next = [...prev, parsed];
            next.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
            return next;
          });
        },
        oneose() {
          clearTimeout(loadingFloor);
          setIsLoading(false);
        },
      },
    );

    return () => {
      clearTimeout(loadingFloor);
      sub.close();
      pool.close(relays);
    };
  }, [processEventId, parameters?.relays]);

  // Only honour events signed by the real facilitator (spoof protection).
  const pauseEvents = useMemo(
    () => (facilitatorPubkey ? allEvents.filter((e) => e.authorPubkey === facilitatorPubkey) : []),
    [allEvents, facilitatorPubkey],
  );

  // Global latest-wins: the newest facilitator event decides the lock state.
  const latest = pauseEvents.length > 0 ? pauseEvents[pauseEvents.length - 1] : null;
  const lockedUntil = latest?.action === 'pause' ? latest.until : null;
  const pauseNote = latest?.action === 'pause' ? latest.note : '';

  // Auto-reopen: re-render at the moment `until` passes so the UI flips to open
  // without any new relay event. Self-reschedules in ≤~23-day chunks because
  // setTimeout delays overflow a 32-bit int past ~24.8 days (they'd fire
  // immediately and never re-arm) — each hop re-checks against a live clock.
  useEffect(() => {
    if (!lockedUntil) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const ms = lockedUntil * 1000 - Date.now();
      if (ms <= 0) {
        setNowMs(Date.now());
        return;
      }
      timer = setTimeout(tick, Math.min(ms + 500, 2_000_000_000));
    };
    tick();
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const isLocked = !!lockedUntil && lockedUntil * 1000 > nowMs;

  return { pauseEvents, isLocked, lockedUntil: isLocked ? lockedUntil : null, pauseNote, isLoading };
};
