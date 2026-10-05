/**
 * Unconditional Financing — when does a request open for funding?
 *
 * One place that answers it for the relay indexer, so the rule can be read,
 * tested and argued with on its own. The REST route clamps a new request the
 * same way, with the same two constants.
 *
 * THE PROBLEM. A request opens for funding `maturing days` after it was
 * published. The REST route works that out from the SERVER's clock. The relay
 * indexer cannot: all it has is an event, and every timestamp in an event — the
 * published_at tag, created_at, the funding_opens_at tag — is written by the
 * signer, and relays accept events dated years back. So a request published
 * straight to the relays with a backdated date was already "published" a month
 * ago the moment the next scan saw it, and opened for funding at once.
 *
 * WHY NOT SIMPLY CLAMP TO created_at − 1 h. Two reasons.
 *   • The signer sets created_at too, so it protects nothing.
 *   • Relays keep only the NEWEST version of an addressable event. After an
 *     edit, created_at is the edit time and the published_at tag is the only
 *     record of the real publication date. A clamp to created_at hands every
 *     edited request a fresh window, and if the database is ever rebuilt from
 *     relays (restore, fresh deploy) EVERY request restarts its review period.
 *     The contribution guard (a contribution dated before the request opened is
 *     not indexed) would then silently drop the real contributions made after
 *     the true opening.
 *
 * WHAT THE INDEXER CAN TRUST instead is its own memory, in this order:
 *   1. The row, when there is one. A known request keeps the window the
 *      database recorded: an edit can only push it later, and once it is open
 *      nothing closes it again (resolveKnownFundingOpensAt).
 *   2. The time of the last completed scan of the relays — the scan watermark.
 *      A request that was not on the relays then cannot be older than that
 *      scan, so an unknown request's published_at is never believed further
 *      back than the watermark less the hour of clock slack the REST route
 *      allows too. After a normal scan that is what REST allows; after a restore
 *      from a backup it reaches back to the backup, and no further. The
 *      funding_opens_at tag is ignored: it is the signer's own claim about its
 *      own deadline. The window is published_at + the maturing length in force
 *      NOW, restarted from the edit if the event was edited inside it.
 *   3. Nothing, when this database has never completed a scan: it is being built
 *      from scratch and the relays ARE the only record. The dates the events
 *      carry are taken as written — including funding_opens_at, which the client
 *      wrote from the window the server had announced and which is the only trace
 *      of the maturing length that was in force at the time (it was 0 when most
 *      existing requests were published; applying today's value to them would
 *      move their opening into the future and drop their contributions).
 *      Restarting everything here loses real money records; trusting a plant
 *      costs one request opening early, and only for a signer who still passes
 *      the eligibility check and the signature check.
 *      KNOWN EXCEPTION: a window an administrator corrected BY HAND lives only in
 *      the database — the owner's event on the relays still carries the old
 *      claim — so a rebuild from the relays would not know about it.
 *
 * Failing closed: wherever the answer is in doubt the window is the LATER one.
 * Not listing a request, or opening it later, is recoverable — an unknown
 * request is looked at again every scan. Opening it early is not.
 */

/** How far a request's own date may trail the reference time: a client with a slow clock. */
export const UF_PAST_SKEW_SECONDS = 3600;
/** … and how far ahead of NOW it may lie. */
export const UF_FUTURE_SKEW_SECONDS = 300;
/** The longest maturing length the admin page can save (ufSettings caps it at 365 days). */
export const UF_MAX_MATURING_SECONDS = 365 * 86400;

export interface NewRequestTimingInput {
  /** The published_at tag, else created_at — what the event CLAIMS. */
  claimedPublishedAt: number;
  /** The funding_opens_at tag; 0 when absent or unreadable. Only read when backfilling. */
  claimedFundingOpensAt: number;
  /** created_at of the (newest) event: the last edit. */
  createdAt: number;
  now: number;
  /** The maturing length in force now. */
  maturingSeconds: number;
  /** When this database last completed a scan of the relays; 0 = never. */
  lastScanAt: number;
}

export interface NewRequestTiming {
  /** 'backfill' = the database is being built from scratch; 'live' = it has been scanning. */
  mode: 'backfill' | 'live';
  publishedAt: number;
  fundingOpensAt: number;
  /** The event claimed a publication date we were not willing to believe. */
  publishedAtClamped: boolean;
}

/** published_at + maturing, pushed to created_at + maturing when the event was edited inside the window. */
function derivedOpening(publishedAt: number, createdAt: number, maturingSeconds: number): number {
  const opens = publishedAt + maturingSeconds;
  return createdAt < opens ? Math.max(opens, createdAt + maturingSeconds) : opens;
}

/**
 * The window of a request the database has NOT seen before.
 * See the header for why each branch trusts what it trusts.
 */
export function resolveNewRequestTiming(i: NewRequestTimingInput): NewRequestTiming {
  const ceiling = i.now + UF_FUTURE_SKEW_SECONDS;

  if (!(i.lastScanAt > 0)) {
    // Backfill: take the relays' record as written, capped at "not from the future".
    const publishedAt = Math.min(i.claimedPublishedAt, ceiling);
    const claimed = i.claimedFundingOpensAt;
    const plausible =
      claimed > 0 &&
      claimed >= publishedAt &&
      claimed <= Math.max(i.createdAt, publishedAt) + UF_MAX_MATURING_SECONDS;
    return {
      mode: 'backfill',
      publishedAt,
      fundingOpensAt: plausible ? claimed : derivedOpening(publishedAt, i.createdAt, i.maturingSeconds),
      publishedAtClamped: publishedAt < i.claimedPublishedAt,
    };
  }

  // Live: never further back than the last scan (less the slack), never ahead of now.
  const floor = i.lastScanAt - UF_PAST_SKEW_SECONDS;
  const publishedAt = Math.min(Math.max(i.claimedPublishedAt, floor), ceiling);
  return {
    mode: 'live',
    publishedAt,
    fundingOpensAt: derivedOpening(publishedAt, i.createdAt, i.maturingSeconds),
    publishedAtClamped: publishedAt !== i.claimedPublishedAt,
  };
}

export interface KnownRequestWindowInput {
  /** funding_opens_at as the database has it. */
  existingOpensAt: number;
  /** created_at of the event being indexed. */
  eventCreatedAt: number;
  now: number;
  maturingSeconds: number;
}

/**
 * The window of a request the database already knows.
 *
 * Decided by OUR clock, never by the date the event carries: an event can be
 * dated anything, and a backdated edit must not be able to pass for "an edit
 * made while the request was maturing" and drag an open request back into
 * review (or unpin its wallet). Mirrors the REST route.
 */
export function resolveKnownFundingOpensAt(i: KnownRequestWindowInput): number {
  // Open already: frozen.
  if (i.now >= i.existingOpensAt) return i.existingOpensAt;
  // Still maturing: refining it restarts the review from the edit, and can only
  // ever push the opening later — never sooner than already announced.
  return Math.max(i.existingOpensAt, i.eventCreatedAt + i.maturingSeconds);
}

/** Once funding is open the receiving wallet is pinned: an edit can never redirect money people are already sending. */
export function isWalletPinned(existingOpensAt: number, now: number): boolean {
  return now >= existingOpensAt;
}
