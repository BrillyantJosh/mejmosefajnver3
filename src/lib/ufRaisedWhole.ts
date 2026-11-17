import { ufCents } from './ufFunded';

/**
 * Unconditional Financing — what was raised ("zbrano"), shown as a whole number.
 *
 * Jasna asked, Brilly confirmed (16. 11. 2026): the raised amount on the list card, in "Moje" and
 * on the request page reads "1300 EUR", not "1300.00 EUR".
 *
 * Rounded DOWN, from the same cents the funded rule compares (ufCents in ./ufFunded): 1299.60
 * raised reads "1299", never "1300" next to a goal of 1300 while the request is not funded. For a
 * whole-number goal, the whole number reaches the goal exactly when the request reads
 * "Financiran" — scripts/testUfFunded.ts checks that, cent by cent, around the goal.
 *
 * The pages show it with a thousands separator ("1.300", 17. 11. 2026) through ufRaisedText in
 * ./ufMainFigures — the same whole number, only grouped.
 *
 * DISPLAY ONLY. "Financiran", what is still missing, the contribute form, everything signed or
 * sent, repayments and LANA amounts keep their exact values and never go through this.
 */
export function ufRaisedWhole(totalFunded: unknown): string {
  return String(Math.floor(ufCents(totalFunded) / 100));
}
