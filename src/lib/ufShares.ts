/**
 * Unconditional Financing — proportional repayment split (pure math, no I/O).
 *
 * A repayment is one multi-output LANA transaction distributed among all
 * financiers of a request, proportionally to the FIAT value each contributed.
 * Invariants (unit-tested in scripts/testUfShares.ts):
 *  - the lanoshi outputs sum EXACTLY to totalLanoshis
 *  - the fiat outputs sum EXACTLY to totalFiat (2-decimal money)
 *  - flooring remainders go to the largest shareholder
 *  - dust outputs (<= dustThreshold lanoshis) are folded into the largest
 *    shareholder instead of creating un-spendable on-chain outputs
 */

export interface UfFinancierShare {
  pubkey: string;
  wallet: string;
  /** Total FIAT this financier contributed to the request (the % basis). */
  contributedFiat: number;
}

export interface UfRepaymentOutput {
  pubkey: string;
  wallet: string;
  lanoshis: number;
  fiat: number;
  /** Contribution share of the request total, in percent (informational). */
  sharePercent: number;
}

/** Default network dust threshold in lanoshis (mirrors BatchFunding's guard). */
export const UF_DUST_THRESHOLD = 546;

/**
 * Split a repayment of `totalLanoshis` (= `totalFiat`) among financiers,
 * proportionally to their contributed FIAT.
 */
export function splitRepayment(
  totalLanoshis: number,
  totalFiat: number,
  financiers: UfFinancierShare[],
  dustThreshold: number = UF_DUST_THRESHOLD,
): UfRepaymentOutput[] {
  if (!Number.isFinite(totalLanoshis) || totalLanoshis <= 0) return [];
  const eligible = financiers.filter(
    (f) => Number.isFinite(f.contributedFiat) && f.contributedFiat > 0 && !!f.wallet,
  );
  if (eligible.length === 0) return [];

  const totalContributed = eligible.reduce((s, f) => s + f.contributedFiat, 0);
  const totalFiatCents = Math.round((Number.isFinite(totalFiat) ? totalFiat : 0) * 100);

  // Floor-share each financier; remainders are assigned to the largest below.
  const outputs = eligible.map((f) => ({
    pubkey: f.pubkey,
    wallet: f.wallet,
    lanoshis: Math.floor((totalLanoshis * f.contributedFiat) / totalContributed),
    fiatCents: Math.floor((totalFiatCents * f.contributedFiat) / totalContributed),
    sharePercent: (f.contributedFiat / totalContributed) * 100,
    contributedFiat: f.contributedFiat,
  }));

  // Largest shareholder (ties → first in list) absorbs remainders and dust.
  let largest = outputs[0];
  for (const o of outputs) {
    if (o.contributedFiat > largest.contributedFiat) largest = o;
  }

  const lanoshiRemainder = totalLanoshis - outputs.reduce((s, o) => s + o.lanoshis, 0);
  largest.lanoshis += lanoshiRemainder;
  const fiatRemainder = totalFiatCents - outputs.reduce((s, o) => s + o.fiatCents, 0);
  largest.fiatCents += fiatRemainder;

  // Fold dust outputs into the largest so we never create un-spendable outputs.
  const kept: typeof outputs = [];
  for (const o of outputs) {
    if (o !== largest && o.lanoshis <= dustThreshold) {
      largest.lanoshis += o.lanoshis;
      largest.fiatCents += o.fiatCents;
    } else {
      kept.push(o);
    }
  }

  return kept.map((o) => ({
    pubkey: o.pubkey,
    wallet: o.wallet,
    lanoshis: o.lanoshis,
    fiat: o.fiatCents / 100,
    sharePercent: o.sharePercent,
  }));
}
