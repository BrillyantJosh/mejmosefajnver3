/**
 * The re-entry form opens three months after the commission's decision, never before.
 * Brilly, 25. 10. 2026: "Ta forma se prikaze šele po 3 mesecih potem ko je bil izključen".
 *   npx tsx scripts/testReentryWindow.ts
 */
import { readFileSync } from 'node:fs';
import { REENTRY_WAIT_MONTHS, reentryIsOpen, reentryOpensAt } from '../src/lib/reentryWindow.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());

console.log('— three calendar months —');
{
  check('the wait is three months', REENTRY_WAIT_MONTHS === 3);
  check('excluded 25. 10. 2026 10:30 UTC → opens 25. 1. 2027 10:30 UTC (over the new year)',
    iso(reentryOpensAt(at('2026-10-25T10:30:00Z'))) === '2027-01-25T10:30:00.000Z', iso(reentryOpensAt(at('2026-10-25T10:30:00Z'))));
  check('15. 3. → 15. 6.', iso(reentryOpensAt(at('2026-03-15T00:00:00Z'))) === '2026-06-15T00:00:00.000Z');
  check('31. 1. → 30. 4. (April has no 31st — never into May)', iso(reentryOpensAt(at('2026-01-31T12:00:00Z'))) === '2026-04-30T12:00:00.000Z');
  check('30. 11. 2026 → 28. 2. 2027', iso(reentryOpensAt(at('2026-11-30T08:00:00Z'))) === '2027-02-28T08:00:00.000Z');
  check('30. 11. 2027 → 29. 2. 2028 (leap year)', iso(reentryOpensAt(at('2027-11-30T08:00:00Z'))) === '2028-02-29T08:00:00.000Z');
  check('31. 8. → 30. 11.', iso(reentryOpensAt(at('2026-08-31T23:59:59Z'))) === '2026-11-30T23:59:59.000Z');
}

console.log('— open or not —');
{
  const since = at('2026-10-25T10:30:00Z');
  const opens = at('2027-01-25T10:30:00Z');
  check('the day of the decision: closed', !reentryIsOpen(since, since));
  check('a day before three months: closed', !reentryIsOpen(since, opens - 86400));
  check('one second before: closed', !reentryIsOpen(since, opens - 1));
  check('the very second: open', reentryIsOpen(since, opens));
  check('later: open', reentryIsOpen(since, opens + 30 * 86400));
}

console.log('— no readable date, no form —');
{
  for (const [name, v] of [['undefined', undefined], ['null', null], ['0', 0], ['negative', -5], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]] as const) {
    check(`${name}: no opening date, and closed even years later`, reentryOpensAt(v as never) === null && !reentryIsOpen(v as never, at('2099-01-01T00:00:00Z')));
  }
}

console.log('— the screen —');
{
  const screen = readFileSync(new URL('../src/components/FrozenOutScreen.tsx', import.meta.url), 'utf8');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  check('the opening is computed from the decision’s date', /const opensAt = reentryOpensAt\(verdict\.since\);/.test(code));
  check('…and the form is shown only once it has come', /const canApply = opensAt !== null && Math\.floor\(Date\.now\(\) \/ 1000\) >= opensAt;/.test(code)
    && /\{canApply \? \(\s*signWith && relays && relays\.length > 0 && \(\s*<ReentryRequestForm/.test(code));
  check('the form appears in exactly one place', (code.match(/<ReentryRequestForm/g) || []).length === 1);
  check('until then the screen says from which day (or that the date could not be read)',
    /t\('frozen\.waitUntil', \{ date: opensOn \}\) : t\('frozen\.waitUnknown'\)/.test(code));
  const dict = readFileSync(new URL('../src/i18n/modules/frozen.ts', import.meta.url), 'utf8');
  check('both languages say it: three months, and the date', (dict.match(/'frozen\.waitUntil':/g) || []).length === 2 && /three months after the decision — from \{date\}/.test(dict) && /tri mesece po odločitvi — od \{date\} naprej/.test(dict));
  const login = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8');
  check('sign-in uses the same screen, so the same rule (no second form anywhere)', /<FrozenOutScreen/.test(login) && !/<ReentryRequestForm/.test(login));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
