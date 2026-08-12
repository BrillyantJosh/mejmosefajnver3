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
