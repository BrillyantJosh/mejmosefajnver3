// Copied byte for byte into mejmosefajnver3/src/lib/bef/vendor — after changing, run scripts/syncBef.ts there.
/** Formatting helpers — one voice for numbers across the site.
 *
 * The locale follows the language the reader picked: a German reader expects
 * 1.000,50 and a French one 1 000,50, and a number typeset the wrong way is
 * read wrong. The language provider sets it; everything here reads it. */

let FORMAT_LOCALE = 'en-GB';

export function setFormatLocale(locale: string): void {
  FORMAT_LOCALE = locale;
}

const SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$' };

export function currencySymbol(currency: string): string {
  return SYMBOL[currency] ?? currency + ' ';
}

export function fmtMoney(amount: number | null | undefined, currency: string, decimals = 0): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `${currencySymbol(currency)}${amount.toLocaleString(FORMAT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** A plain decimal in the reader's locale. toFixed always writes a dot, and
 * "2.1 Monate" is wrong in a language that separates decimals with a comma. */
export function fmtDecimal(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(FORMAT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Per-LANA prices need more precision than totals. */
export function fmtPrice(price: number | null | undefined, currency: string): string {
  if (price == null || !Number.isFinite(price)) return '—';
  const decimals = price >= 100 ? 0 : price >= 1 ? 2 : 4;
  return fmtMoney(price, currency, decimals);
}

export function fmtLana(qty: number | null | undefined): string {
  if (qty == null || !Number.isFinite(qty)) return '—';
  return Math.round(qty).toLocaleString(FORMAT_LOCALE);
}

export function fmtSignedMoney(amount: number, currency: string): string {
  const sign = amount < 0 ? '−' : '+';
  return `${sign}${fmtMoney(Math.abs(amount), currency)}`;
}

export function fmtSignedPercent(percent: number | null | undefined, decimals = 0): string {
  if (percent == null || !Number.isFinite(percent)) return '—';
  const sign = percent < 0 ? '−' : '+';
  return `${sign}${fmtDecimal(Math.abs(percent), decimals)}%`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') || value.includes(' ') ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  // Date-only values are calendar days, not instants: format in UTC so a
  // viewer west of UTC does not see the previous day.
  return d.toLocaleDateString(FORMAT_LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** An instant — unix seconds, unix milliseconds or an ISO string — as a date and
 * time in the reader's locale and time zone. */
export function fmtDateTime(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  let d: Date;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    d = new Date(value < 1e11 ? value * 1000 : value);
  } else {
    // SQLite's datetime('now') has no zone and means UTC.
    d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  }
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(FORMAT_LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** ISO country code → emoji flag. */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '🌐';
  const base = 0x1f1e6;
  const upper = code.toUpperCase();
  return String.fromCodePoint(base + upper.charCodeAt(0) - 65, base + upper.charCodeAt(1) - 65);
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
