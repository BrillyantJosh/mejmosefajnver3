/**
 * Duplicate detection for unconditional payments — the ONE matcher shared by
 * the ConfirmPayment page (pre-broadcast guard) and the server's
 * /send-unconditional-payment route (chokepoint guard for stale bundles).
 *
 * An obligation is one SUBSCRIPTION MONTH of one service. The generator
 * (lana-subscriptions) bills at most once per (subscriber, service,
 * billing_month) — so two proposals in the same month are the same debt, and
 * proposals in different months are different debts, however alike they look.
 *
 * That month identity is what the rules key on. Things that look tempting and
 * are NOT usable:
 *  - `billing_day` is the day-of-month of the generator RUN (the 2026-07 set
 *    carries "19", the 2026-08 set "9"), so it identifies neither cycle nor
 *    obligation, and collides across months;
 *  - LANA amounts are recomputed from fiat at pay time and are user-editable,
 *    so amount equality breaks on rate drift or a rounded custom amount;
 *  - "paid recently" is wrong in both directions: a payer who settles LAST
 *    month's bill late, hours before this month's bill is minted, is making
 *    two legitimate payments (this is exactly what payer 9b1267aa did on
 *    2026-08-08/09 and must never be blocked).
 *
 * Verified against the relays (14 108 proposals / 8 157 confirmations, 377
 * payers): the real double payments are one obligation-month settled twice —
 * either the same proposal paid by two transactions 31 minutes apart, or two
 * duplicate proposals for one month paid separately. Both are caught here.
 */

export interface SelectedObligation {
  /** 90900 event id of the selected proposal. */
  proposalId: string;
  /** 90900 d-tag of the selected proposal. */
  proposalDTag: string;
  /** to_wallet the payment would go to. */
  recipientWallet: string;
  service: string;
  /** created_at of the 90900 — the mint time of this proposal set. */
  proposalCreatedAt: number;
}

/** Minimal KIND 90901 shape — structurally compatible with a nostr Event. */
export interface ConfirmationEvent {
  id: string;
  created_at: number;
  tags: string[][];
}

export interface DuplicateMatch {
  obligation: SelectedObligation;
  txId: string;
  via: string;
  confirmationId: string;
}

const tagOf = (ev: ConfirmationEvent, name: string): string =>
  ev.tags.find((t) => t[0] === name)?.[1] || '';

/** "YYYY-MM" of an epoch-seconds timestamp, in UTC. */
export function billingMonthOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 7);
}

/**
 * The subscription month a proposal d-tag belongs to. Two shapes:
 *
 *  - `sub:lana:<YYYY-MM>:<payer8>:<service12>` — current lana-subscriptions,
 *    where the month is stated outright;
 *  - `sub:lana:<ms>:<payer8>` / `pay:lana:<ms>:<payer8>` — the older
 *    timestamp form (lana-subscriptions before the deterministic d-tag, and
 *    the self-responsibility generator), where it is the epoch-ms of the run.
 *
 * Returns "" for anything else (e.g. `registrar:subscription:…`), which makes
 * Rule B stand down for it — Rule A still covers those exactly.
 */
export function billingMonthOfDTag(dTag: string): string {
  const stated = /^(?:sub|pay):lana:(\d{4}-\d{2}):/.exec(dTag || '')?.[1];
  if (stated) return stated;

  const ms = /^(?:sub|pay):lana:(\d{12,14}):/.exec(dTag || '')?.[1];
  if (!ms) return '';
  const seconds = Math.floor(Number(ms) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? billingMonthOf(seconds) : '';
}

/**
 * The true payment time of a 90901: the timestamp_paid tag when present and
 * sane, else created_at. RetryEvents re-signs queued confirmations with a
 * fresh created_at, so created_at alone can postdate the payment by days.
 */
export function confirmationPaidAt(ev: ConfirmationEvent): number {
  const stamped = Number.parseInt(tagOf(ev, 'timestamp_paid'), 10);
  return Number.isFinite(stamped) && stamped > 0 ? stamped : ev.created_at;
}

/**
 * Which of the selected obligations does an existing 90901 already settle?
 *
 *  Rule A (exact): the confirmation references the selected proposal's d-tag
 *  (`proposal` tag) or event id (`e` tag with marker "proposal") — that
 *  proposal is paid, whatever a pending list says.
 *
 *  Rule B (duplicate proposal): the confirmation settles a DIFFERENT proposal
 *  for the same service, same to_wallet and the same subscription month. The
 *  generator has produced two proposals for one month before (17 times across
 *  the fleet), and paying both is a real double payment.
 *
 * Different months never match: last month's bill paid late, hours before this
 * month's is minted, is two legitimate payments.
 */
export function findDuplicateConfirmations(
  selected: SelectedObligation[],
  confirmations: ConfirmationEvent[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const obligation of selected) {
    const obligationMonth = obligation.proposalCreatedAt
      ? billingMonthOf(obligation.proposalCreatedAt)
      : billingMonthOfDTag(obligation.proposalDTag);

    for (const ev of confirmations) {
      const proposalRef = tagOf(ev, 'proposal');
      const eventRef = ev.tags.find((t) => t[0] === 'e' && t[3] === 'proposal')?.[1] || '';

      if (
        (proposalRef && proposalRef === obligation.proposalDTag) ||
        (eventRef && eventRef === obligation.proposalId)
      ) {
        matches.push({ obligation, txId: tagOf(ev, 'tx'), via: 'proposal reference', confirmationId: ev.id });
        break;
      }

      if (!obligation.service || !obligation.recipientWallet || !obligationMonth) continue;
      if (tagOf(ev, 'service') !== obligation.service) continue;
      if (tagOf(ev, 'to_wallet') !== obligation.recipientWallet) continue;
      // Only a confirmation whose own proposal is datable to the same month
      // counts; an undatable d-tag stands down rather than block a real bill.
      if (billingMonthOfDTag(proposalRef) !== obligationMonth) continue;
      matches.push({
        obligation,
        txId: tagOf(ev, 'tx'),
        via: 'duplicate proposal for the same subscription month',
        confirmationId: ev.id,
      });
      break;
    }
  }

  return matches;
}

/* ─── How the browser reads the confirmations this matcher needs ───────────
 *
 * The guard is fail-closed: no answer from any relay means we do not pay. That
 * is right, and it stays. What was wrong is how little it took to get no
 * answer. On 2026-09-15 a payer on an iPhone was refused on a 66.41 LANA batch
 * while all four relays were healthy — measured the same day at 356–912 ms to
 * EOSE for exactly her filter.
 *
 * Hence: several attempts, each on a fresh pool (see readFromRelaysWithRetry),
 * and a per-attempt budget with real headroom over the healthy case.
 *
 * Retries did not help her: on 2026-09-17 all three failed, because her
 * network blocks WebSocket connections to every relay. So when the browser
 * gets no answer at all, it no longer refuses by itself — the server route
 * runs this same matcher over the same read, from a network that reaches the
 * relays, and refuses on its own when it cannot verify (see
 * unconditionalPaymentFlow.ts). Fail-closed is kept end to end; it is decided
 * by the check that can actually be made.
 */

/**
 * Per-attempt wall clock, covering connect AND EOSE for every relay in
 * parallel. Healthy is under 1 s; 12 s is ~13× that and still ~3× a pessimistic
 * mobile round, so a slow relay is waited for instead of being called dead.
 */
export const GUARD_READ_BUDGET_MS = 12_000;

/**
 * Attempts including the first. Attempt 2 recovers a socket that died while
 * the page was suspended; attempt 3 covers a network still re-associating.
 */
export const GUARD_READ_ATTEMPTS = 3;

/** Pause between attempts — retrying into a still-suspended stack wastes one. */
export const GUARD_READ_PAUSE_MS = 1_200;

/**
 * Worst case before the page gives up on its own read and lets the server's
 * check decide: 3 × 12 s + 2 × 1.2 s ≈ 38 s. Bounded on purpose — the user is
 * shown which attempt is running while it runs.
 */
export const GUARD_READ_WORST_CASE_MS =
  GUARD_READ_ATTEMPTS * GUARD_READ_BUDGET_MS + (GUARD_READ_ATTEMPTS - 1) * GUARD_READ_PAUSE_MS;

/**
 * What we say when the check could not be made. Someone who has just typed a
 * private key and pressed a payment button must not have to wonder whether the
 * money went: the first sentence answers that, before the reason.
 *
 * It is shown when the SERVER's check fails (its 503), which is the last word
 * since the browser defers to it — so it does not send the payer off to fix an
 * internet connection that just reached our server fine.
 */
export const GUARD_UNVERIFIABLE_MESSAGE =
  'Nothing was sent — no LANA has left your wallet. ' +
  'Our server could not reach any relay to check whether these payments were already made, ' +
  'and we never pay without that check. ' +
  'Please try again in a few minutes.';

/** Same promise first, for the case where the relay list itself never loaded. */
export const GUARD_NO_RELAY_LIST_MESSAGE =
  'Nothing was sent — no LANA has left your wallet. ' +
  'The list of relays is not loaded, so we cannot check whether these payments were already made. ' +
  'Reload the page and try again.';
