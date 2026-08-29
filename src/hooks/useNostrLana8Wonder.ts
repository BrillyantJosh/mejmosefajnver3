import { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { readFromRelays } from '@/lib/relayRead';
import { planGateStatus, type PlanGateStatus } from '@/lib/planRead';

/**
 * Does this person hold a Lana8Wonder annuity plan (KIND 88888)?
 *
 * Four screens gate on the answer — resisting a proposal, creating a LanaCrowd
 * project, opening an Abundance point, and the My Status row — so "no" is not
 * a display detail here, it is a refusal. `unreachable` exists so that none of
 * them turns "we could not check" into "you do not have one".
 */
export type Lana8WonderStatus = PlanGateStatus;

export const useNostrLana8Wonder = () => {
  const [status, setStatus] = useState<Lana8WonderStatus>({ exists: false, unreachable: false });
  const [isLoading, setIsLoading] = useState(true);
  const { parameters } = useSystemParameters();
  const { session } = useAuth();

  // Every system-parameters refresh — including the SSE heartbeat and every
  // republished KIND 38888 — parses `relays` into a NEW array naming the very
  // same relays. Depending on the array itself re-ran this gate on each one, so
  // the gate was re-decided over and over while a person sat on the page. The
  // relay LIST is the dependency; that is what this watches.
  const relayKey = (parameters?.relays || []).join(',');

  useEffect(() => {
    const relays = relayKey ? relayKey.split(',') : [];
    const cancelled = { value: false };

    const fetchLana8WonderStatus = async () => {
      if (!session?.nostrHexId) {
        setIsLoading(false);
        return;
      }
      if (relays.length === 0) {
        // KIND 38888 has not been read, so we have no relays to ask. That is
        // not "this person has no plan" either.
        setStatus((prev) => ({ ...prev, unreachable: true }));
        setIsLoading(false);
        return;
      }

      const pool = new SimplePool();

      try {
        console.log('🌟 Fetching KIND 88888 Lana8Wonder status for user:', session.nostrHexId);

        // readFromRelays, not pool.querySync: in nostr-tools 2.17.0 a relay
        // that never connects is counted as having sent EOSE, so a total
        // outage resolves to `[]` and is indistinguishable from a relay that
        // answered "nobody by that name". This gate cannot afford to confuse
        // the two — see src/lib/planRead.ts.
        //
        // `limit: 1` stays — a gate that runs on four screens should not pull a
        // holder's whole KIND 88888 history to answer yes/no. It is each
        // relay's OWN newest, and planGateStatus takes the newest across
        // relays; the old bug was `events[0]` off the merged array, not the
        // limit.
        const read = await readFromRelays(
          pool,
          relays,
          { kinds: [88888], '#p': [session.nostrHexId], limit: 1 },
          { budgetMs: 10000, cancelled },
        );
        if (cancelled.value) return;

        console.log(
          `📋 KIND 88888: ${read.events.length} event(s) from ${read.answered.length}/${relays.length} relays`
        );

        setStatus((prev) => {
          const next = planGateStatus(read, prev);
          if (next.unreachable) {
            console.warn(
              `📡 No relay answered for KIND 88888 (${read.failed.map(f => `${f.url}: ${f.reason}`).join(' | ')}) — the Lana8Wonder gate reports UNKNOWN, not "no plan"`
            );
          }
          return next;
        });
      } catch (error) {
        // readFromRelays never rejects, so anything landing here is a fault on
        // our side — still not evidence about this person's plan.
        console.error('❌ Error fetching Lana8Wonder status:', error);
        if (!cancelled.value) setStatus((prev) => ({ ...prev, unreachable: true }));
      } finally {
        if (!cancelled.value) setIsLoading(false);
        try { pool.close(relays); } catch { /* sockets already gone */ }
      }
    };

    fetchLana8WonderStatus();
    return () => { cancelled.value = true; };
  }, [session?.nostrHexId, relayKey]);

  return { status, isLoading };
};
