/**
 * What "Express interest" carries from the Explorer to the Interest page:
 * /bef/interest?split=&currency=&round=&amount= — the same query BEF
 * Explorer's calculator links to its own /interest with. A link shared or
 * typed by hand is read the same careful way: anything that is not a clean
 * value is left out, never guessed.
 */
import { INTEREST_CURRENCIES, type InterestCurrency } from './vendor/server/lib/interestEvent.ts';

export interface InterestPrefill {
  split: number | null;
  currency: InterestCurrency | null;
  round: number | null;
  amount: number | null;
}

/**
 * A typed amount in whole units: null when empty, NaN when it is not a whole
 * number. Grouping as people type it ("5,000", "5.000", "5 000") is read as
 * thousands; anything with a decimal part is refused, never rounded.
 * Port of bef-explorer src/components/person/InterestForm.tsx:93 parseWholeAmount.
 */
export function parseWholeAmount(text: string): number | null {
  const compact = text.replace(/[\s'\u2019\u00a0\u202f]/g, '');
  if (!compact) return null;
  const digits = /^\d{1,3}([.,]\d{3})+$/.test(compact) ? compact.replace(/[.,]/g, '') : compact;
  if (!/^\d{1,12}$/.test(digits)) return NaN;
  return Number(digits);
}

/** Port of bef-explorer src/pages/InterestPage.tsx:33-44 readPrefill. */
export function readPrefill(params: URLSearchParams): InterestPrefill {
  const split = Number(params.get('split'));
  const round = Number(params.get('round'));
  const currency = String(params.get('currency') ?? '').toUpperCase();
  const amount = parseWholeAmount(String(params.get('amount') ?? '').split(/[.]\d{1,2}$/)[0]);
  return {
    split: Number.isInteger(split) && split > 0 ? split : null,
    currency: (INTEREST_CURRENCIES as readonly string[]).includes(currency) ? (currency as InterestCurrency) : null,
    round: Number.isInteger(round) && round >= 1 && round <= 3 ? round : null,
    amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : null,
  };
}

/** The query for a prefill, with only the values that are set — what the
 * Explorer's "Express interest" navigates to. */
export function prefillQuery(prefill: Partial<InterestPrefill>): string {
  const q = new URLSearchParams();
  if (prefill.split != null) q.set('split', String(prefill.split));
  if (prefill.currency) q.set('currency', prefill.currency);
  if (prefill.round != null) q.set('round', String(prefill.round));
  if (prefill.amount != null && Number.isFinite(prefill.amount) && prefill.amount >= 1) q.set('amount', String(Math.floor(prefill.amount)));
  return q.toString();
}
