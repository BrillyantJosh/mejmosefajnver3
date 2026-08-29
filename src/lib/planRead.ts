/**
 * Did the relays say this holder has no plan, or did they say nothing at all?
 *
 * The two look identical to `pool.querySync`: in nostr-tools 2.17.0 a relay
 * that fails to CONNECT is counted as though it had sent EOSE, so a total
 * outage resolves to `[]` in milliseconds and reads as a completed, empty,
 * successful query. `src/lib/relayRead.ts` exists to tell them apart; this is
 * the rule for what a page may then DO about it.
 *
 * The distinction is not cosmetic. A holder's Lana8Wonder page swaps to a
 * "check which of your wallets are eligible" screen when it believes there is
 * no plan — so a silent network turns a plan holder into a non-holder, and
 * takes the entry SPLIT card with it. Nothing on screen says the relays were
 * unreachable, so the page looks like an answer.
 *
 * So: only a relay that actually answered may retire a plan.
 */
import type { Event } from 'nostr-tools';

export interface PlanReadLike {
  /** Relays that sent a real EOSE within the budget. */
  answered: string[];
  /** Merged events from every relay that delivered. */
  events: Event[];
}

export type PlanReadOutcome =
  /** A plan event came back — use it. */
  | { status: 'found'; event: Event }
  /** Relays answered and none of them holds a plan for this holder. */
  | { status: 'none' }
  /** No relay answered. Say nothing about the holder; keep what we had. */
  | { status: 'unreachable' };

/**
 * A KIND 88888 plan is re-published whenever it changes and relays replace the
 * old copy, but two relays can still be a moment apart — so the newest
 * `created_at` wins, exactly as the page has always done.
 */
export function choosePlanEvent(read: PlanReadLike | null | undefined): PlanReadOutcome {
  const events = Array.isArray(read?.events) ? read!.events : [];
  if (events.length > 0) {
    // An event in hand is proof a relay delivered, whether or not its EOSE
    // arrived inside the budget. Never discard money data over a missing EOSE.
    const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
    return { status: 'found', event: newest };
  }
  const answered = Array.isArray(read?.answered) ? read!.answered : [];
  return answered.length > 0 ? { status: 'none' } : { status: 'unreachable' };
}
