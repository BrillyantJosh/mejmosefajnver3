import { useState, useEffect, useMemo } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

// KIND 87055 — "Self-Responsibility Exit / Re-enter".
// Regular, NON-replaceable (history accumulates — a participant may exit and
// re-enter repeatedly), PUBLIC/unencrypted (the registrar and all participants
// must read it without the group key), signed by the participant themselves.
export const PROCESS_EXIT_KIND = 87055;

export type ProcessExitAction = 'exit' | 'enter';

export interface ProcessExitEvent {
  id: string;
  authorPubkey: string;
  action: ProcessExitAction;
  statement: string;
  createdAt: number;
}

/**
 * Reads KIND 87055 exit/re-enter events for a single OWN process (by its
 * processEventId), live. Returns:
 *  - exitEvents: ALL events (any author), de-duped by id, sorted ascending by
 *    created_at — used to render the "X has exited / re-entered" system lines.
 *  - isExited: whether the CURRENT user's latest-wins action is 'exit'.
 */
export const useNostrProcessExitState = (
  processEventId: string | null,
  currentUserPubkey: string | null,
) => {
  const [exitEvents, setExitEvents] = useState<ProcessExitEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();

  useEffect(() => {
    if (!processEventId) {
      setExitEvents([]);
      setIsLoading(false);
      return;
    }

    const relays = parameters?.relays || [];
    if (relays.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setExitEvents([]);

    const pool = new SimplePool();

    const parse = (event: Event): ProcessExitEvent | null => {
      const actionTag = event.tags.find((t) => t[0] === 'action')?.[1];
      if (actionTag !== 'exit' && actionTag !== 'enter') return null;
      return {
        id: event.id,
        authorPubkey: event.pubkey,
        action: actionTag,
        statement: event.content || '',
        createdAt: event.created_at,
      };
    };

    const sub = pool.subscribeMany(
      relays,
      { kinds: [PROCESS_EXIT_KIND], '#e': [processEventId], limit: 2000 } as any,
      {
        onevent(event: Event) {
          const parsed = parse(event);
          if (!parsed) return;
          setExitEvents((prev) => {
            if (prev.some((e) => e.id === parsed.id)) return prev;
            const next = [...prev, parsed];
            next.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
            return next;
          });
        },
        oneose() {
          setIsLoading(false);
        },
      },
    );

    return () => {
      sub.close();
      pool.close(relays);
    };
  }, [processEventId, parameters?.relays]);

  // Current user's latest-wins action → exited?
  const isExited = useMemo(() => {
    if (!currentUserPubkey) return false;
    const mine = exitEvents.filter((e) => e.authorPubkey === currentUserPubkey);
    if (mine.length === 0) return false;
    // exitEvents is already sorted ascending (createdAt, then id) → last is latest.
    return mine[mine.length - 1].action === 'exit';
  }, [exitEvents, currentUserPubkey]);

  return { exitEvents, isExited, isLoading };
};
