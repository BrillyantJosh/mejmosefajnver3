import { ufRaisedWhole } from './ufRaisedWhole';

/**
 * Unconditional Financing — the MAIN figures with a thousands separator: what was raised (the big
 * number) and the goal ("Cilj …", "od …", "/ …"), on the list card, the request page and "Moje".
 *
 * Jasna asked, Brilly said to do it (17. 11. 2026): "100.000", "1.300" — not "100000", "1300".
 *
 * The separators follow the module's language: the pages speak Slovenian when the interface is
 * Slovenian and English otherwise (`sl = useLang() === "sl"`), so the numbers do too —
 *   sl: 100.000 · 1.300 · 1.300,50      otherwise: 100,000 · 1,300 · 1,300.50
 * Written out here, not left to Intl: Intl.NumberFormat('sl-SI') does not group four digits
 * ("1300", CLDR minimum grouping digits = 2), and `useGrouping: 'always'` is too new for every
 * phone (older engines read it as `true` and still print "1300"). This prints the same everywhere.
 *
 * • raised — yesterday's rule exactly (src/lib/ufRaisedWhole.ts): a whole number, rounded DOWN
 *   from the exact cents; only the grouping is new;
 * • goal — exactly as it is, never rounded up or down: whole when it has no cents ("1.300"),
 *   with its cents when it has them ("1.300,50").
 *
 * DISPLAY ONLY. "Financiran", the percent, what is still missing, the contribute form, everything
 * signed or sent, repayments (also the "Poplačano X / zbrano Y" line) and LANA amounts never go
 * through this. scripts/testUfFunded.ts pins it.
 */

/** Groups a run of whole digits by three: "100000" → "100.000" (sl) or "100,000". */
export function ufGroupThousands(wholeDigits: string, sl: boolean): string {
  if (!/^-?\d+$/.test(wholeDigits)) return wholeDigits;
  return wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sl ? '.' : ',');
}

/** What was raised, as a whole number rounded down (ufRaisedWhole), grouped: "100.000". */
export function ufRaisedText(totalFunded: unknown, sl: boolean): string {
  return ufGroupThousands(ufRaisedWhole(totalFunded), sl);
}

/** "1e+21" / "1.5e-7" → the same value written out in plain digits, no digit changed. */
function plainDigits(s: string): string {
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (!m) return s;
  const digits = m[1] + (m[2] ?? '');
  const point = m[1].length + Number(m[3]);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * The goal, exactly: "1.300" when it has no cents, "1.300,50" when it has them (sl). It is the
 * number as it was published (the shortest form that reads back as the same number), so nothing
 * is ever rounded; one decimal is written as two ("1300.5" → "1.300,50"). Anything that is not a
 * number reads "0", as an unreadable goal does everywhere else in the module.
 */
export function ufGoalText(fiatGoal: unknown, sl: boolean): string {
  const n = typeof fiatGoal === 'number' ? fiatGoal : Number(fiatGoal);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const [whole, fraction = ''] = plainDigits(String(Math.abs(n))).split('.');
  const grouped = sign + ufGroupThousands(whole, sl);
  if (fraction === '') return grouped;
  return `${grouped}${sl ? ',' : '.'}${fraction.padEnd(2, '0')}`;
}
