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


/**
 * The same distinction, asked as a permission question.
 *
 * `useNostrLana8Wonder` is not a display. It is the gate on resisting a
 * proposal, on creating a LanaCrowd project and on opening an Abundance point,
 * and it answered `exists: false` on every empty `querySync` — so one silent
 * relay told a real plan holder, on four different screens, that they are not
 * one, in the voice of a verdict. A gate must be able to say "I could not
 * check". That is what `unreachable` is for.
 *
 * The rule cuts both ways. Silence may not close the gate on someone who has a
 * plan, and it may not open it for someone who does not: only a relay that
 * actually answered may change the answer.
 */
export interface PlanGateStatus {
  exists: boolean;
  planId?: string;
  eventId?: string;
  createdAt?: number;
  /**
   * No relay answered, so this status is not an answer about the holder.
   * A screen that gates on `exists` must say "could not check", never "no".
   */
  unreachable: boolean;
}

export function planGateStatus(
  read: PlanReadLike | null | undefined,
  previous: PlanGateStatus,
): PlanGateStatus {
  const outcome = choosePlanEvent(read);

  if (outcome.status === 'unreachable') {
    // Whatever we already established stands; we only record that this
    // reading proved nothing.
    return { ...previous, unreachable: true };
  }
  if (outcome.status === 'none') {
    return { exists: false, unreachable: false };
  }

  // choosePlanEvent hands back the NEWEST re-publication. The old code took
  // `events[0]` off a merged multi-relay array, so two relays a moment apart
  // could have this reporting the superseded plan id.
  const dTag = outcome.event.tags.find((tag) => tag[0] === 'd');
  return {
    exists: true,
    planId: dTag?.[1],
    eventId: outcome.event.id,
    createdAt: outcome.event.created_at,
    unreachable: false,
  };
}

/**
 * Which screen /lana8wonder/splits is entitled to show.
 *
 * Its empty-plan screen is not neutral: it states that the holder has no
 * annuity plan, sends them to lana8wonder.com to acquire one, and prints
 * sixteen doubling price rungs that belong to nobody in particular. Shown to a
 * holder because the relays happened to be quiet, it is three false statements
 * at once — so silence gets its own screen instead.
 *
 * `lastRead: null` means nothing was ever asked (nobody signed in). That is not
 * an outage, so the page stays exactly as it was.
 */
export type PlanScreen = 'forecast' | 'no-plan' | 'unreachable';

export function choosePlanScreen(args: {
  plan: unknown;
  lastRead: 'found' | 'none' | 'unreachable' | null;
}): PlanScreen {
  // A plan in hand outranks everything: an outage never clears the screen.
  if (args.plan) return 'forecast';
  return args.lastRead === 'unreachable' ? 'unreachable' : 'no-plan';
}
