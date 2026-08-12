/**
 * Duplicate detection for unconditional payments — the ONE matcher shared by
 * the ConfirmPayment page (pre-broadcast guard) and the server's
 * /send-unconditional-payment route (chokepoint guard for stale bundles).
 *
 * Why matching is time-anchored and NOT amount- or billing_day-based:
 *  - the proposal generator mints a NEW timestamp d-tag every run, so an
 *    already-paid obligation reappears under a d no 90901 references;
 *  - `billing_day` is the day-of-month OF THE RUN (the 2026-07-19 set carries
 *    "19", the 2026-08-09 set carries "9") — equality across runs proves
 *    nothing and collides across months (Feb 1 vs Mar 1);
 *  - LANA amounts are recomputed from fiat at pay time and are user-editable,
 *    so amount equality breaks on rate drift or a rounded custom amount.
 *
 * What does hold: in the observed incident the payer settled the July set at
 * 2026-08-08 15:09 and the generator re-minted the same obligations at
 * 2026-08-09 00:18 — payment BEFORE the mint, by hours. A genuinely new
 * billing cycle arrives 21–28 days after the previous run, so a payment for
 * the same service+wallet made within the margin BEFORE this proposal set was
 * minted (or any time after it) can only mean the obligation is settled.
 *
 * Known ambiguity, accepted as fail-closed: a payment made within the margin
 * before a genuinely new cycle's mint blocks that cycle's card until the NEXT
 * generator run re-mints it (≤28 days). A wrong block self-heals; a wrong
 * payment does not.
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

/** A payment this close BEFORE the mint means the mint re-issued a settled obligation. */
export const REGENERATION_MARGIN_SECONDS = 3 * 24 * 3600;

const tagOf = (ev: ConfirmationEvent, name: string): string =>
  ev.tags.find((t) => t[0] === name)?.[1] || '';

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
 *  (`proposal` tag) or event id (`e` tag with marker "proposal").
 *
 *  Rule B (obligation): same service AND same to_wallet, paid at or after
 *  `proposalCreatedAt - REGENERATION_MARGIN_SECONDS`. Service equality is
 *  required because one wallet legitimately hosts several services with
 *  equal amounts.
 */
export function findDuplicateConfirmations(
  selected: SelectedObligation[],
  confirmations: ConfirmationEvent[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const obligation of selected) {
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

      if (!obligation.service || !obligation.recipientWallet) continue;
      if (tagOf(ev, 'service') !== obligation.service) continue;
      if (tagOf(ev, 'to_wallet') !== obligation.recipientWallet) continue;
      if (confirmationPaidAt(ev) >= obligation.proposalCreatedAt - REGENERATION_MARGIN_SECONDS) {
        matches.push({
          obligation,
          txId: tagOf(ev, 'tx'),
          via: 'same service + wallet, paid since this proposal set was minted',
          confirmationId: ev.id,
        });
        break;
      }
    }
  }

  return matches;
}
