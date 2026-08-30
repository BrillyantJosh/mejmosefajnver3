/**
 * Did the relays say this person records no unregistered wallets, or did they
 * say nothing at all?
 *
 * The same `pool.querySync` flaw described in `src/lib/relayRead.ts`: in
 * nostr-tools 2.17.0 a relay that never CONNECTS is counted as having sent
 * EOSE, so a total outage resolves to `[]` in milliseconds and reads as a
 * completed, empty, successful query. No `catch` ever runs.
 *
 * On a display that is a wrong screen. Here it is destruction. KIND 30289 is
 * addressable — one event per person, republished in full every time — so
 * "add a wallet" is really "read the list, append, republish the whole list".
 * Read `[]` from a silent network and the republished event carries the new
 * wallet ALONE, and relays replace the real list with it. Every address the
 * person had recorded is gone, the toast says the wallet was added
 * successfully, and nothing anywhere reports a failure.
 *
 * So this list is fail-CLOSED, which is stricter than the plan rule in
 * `src/lib/planRead.ts`. A plan read that proves nothing may leave the screen
 * as it was; a WRITE that proves nothing may not happen at all. Only a relay
 * that actually answered can license the empty list a first-time user starts
 * from — see `src/components/unregistered-wallets/WalletCard.tsx`, whose
 * delete path has always refused to publish when it found no list to edit.
 */
import type { Event } from 'nostr-tools';

export interface UnregisteredWalletEntry {
  address: string;
  note: string;
}

export interface WalletListReadLike {
  /** Relays that sent a real EOSE within the budget. */
  answered: string[];
  /** Merged events from every relay that delivered. */
  events: Event[];
}

export type WalletListOutcome =
  /** A list came back — append to THIS. */
  | { status: 'found'; event: Event; wallets: UnregisteredWalletEntry[] }
  /** Relays answered and this person has no list yet — the first wallet. */
  | { status: 'empty' }
  /** No relay answered. We do not know what they have, so we write nothing. */
  | { status: 'unreachable' };

/**
 * `t[2]` is the note and has been written on every wallet this app has ever
 * added, but the filter is `length >= 2` on purpose: a two-element `w` tag is
 * still a wallet somebody recorded, and the old `length >= 3` would have
 * dropped it from the republished list exactly as silently as an outage did.
 * A merge that rebuilds the whole event may never be the reason an entry
 * disappears.
 */
export function readWalletTags(event: Event): UnregisteredWalletEntry[] {
  return event.tags
    .filter((t) => t[0] === 'w' && t.length >= 2 && typeof t[1] === 'string' && t[1].length > 0)
    .map((t) => ({ address: t[1], note: t[2] || '' }));
}

/**
 * KIND 30289 is republished in full on every edit and relays replace the old
 * copy, but two relays can still be a moment apart. The old code took
 * `events[0]` off the merged array — whichever copy arrived first — so a stale
 * relay could hand back a list missing the wallet added a minute ago, and the
 * republish would then delete it for good. The newest `created_at` wins.
 */
export function readWalletList(
  read: WalletListReadLike | null | undefined,
): WalletListOutcome {
  const events = Array.isArray(read?.events) ? read!.events : [];
  if (events.length > 0) {
    // An event in hand is proof a relay delivered, whether or not its EOSE
    // arrived inside the budget. Never discard a wallet list over a late EOSE.
    const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
    return { status: 'found', event: newest, wallets: readWalletTags(newest) };
  }
  const answered = Array.isArray(read?.answered) ? read!.answered : [];
  return answered.length > 0 ? { status: 'empty' } : { status: 'unreachable' };
}

/**
 * The permission question, asked separately from the reading so that the one
 * place it is decided is the one place it can be tested.
 *
 * `found` and `empty` are both a relay speaking, and both may be published.
 * `unreachable` is silence, and silence may not become an empty list.
 */
export function mayPublishWalletList(outcome: WalletListOutcome): boolean {
  return outcome.status !== 'unreachable';
}

/**
 * What to append to. Never called for `unreachable` — `mayPublishWalletList`
 * gates that — but it returns `null` rather than `[]` there, so a caller that
 * forgets the gate cannot accidentally publish a one-wallet list.
 */
export function baseWalletsFor(outcome: WalletListOutcome): UnregisteredWalletEntry[] | null {
  if (outcome.status === 'found') return outcome.wallets;
  if (outcome.status === 'empty') return [];
  return null;
}
