/**
 * Signing in from a public event page returns you to that event (Brilly, 11. 11. 2026),
 * and the "next" address can never send anyone off this app.
 *   npx tsx scripts/testLoginReturn.ts
 */
import { readFileSync } from 'node:fs';
import { loginReturningTo, safeReturnPath } from '../src/lib/loginReturn.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— there and back —');
{
  const event = '/event/event%3A1794396674815-ptvmzd';
  const link = loginReturningTo(event);
  check('the event page sends you to /login with itself as "next"', link === '/login?next=%2Fevent%2Fevent%253A1794396674815-ptvmzd', link);
  const next = new URLSearchParams(link.split('?')[1]).get('next');
  check('…and sign-in reads back exactly that page', safeReturnPath(next) === event, next);
  check('a page with a query keeps it', safeReturnPath('/event/x?tab=1') === '/event/x?tab=1');
}

console.log('— never anywhere else —');
{
  for (const [name, v] of [
    ['nothing', null], ['empty', ''], ['another site', 'https://evil.example/'], ['protocol-relative', '//evil.example/x'],
    ['backslash trick', '/\\evil.example'], ['javascript:', 'javascript:alert(1)'], ['no leading slash', 'event/x'],
    ['back to sign-in', '/login'], ['sign-in with a query', '/login?next=/x'], ['a control character', '/event/x\n//evil'],
    ['absurdly long', '/' + 'a'.repeat(5000)],
  ] as const) {
    check(`${name} → home`, safeReturnPath(v as string | null) === '/', v);
  }
}

console.log('— the pages —');
{
  const login = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8');
  const event = readFileSync(new URL('../src/pages/PublicEvent.tsx', import.meta.url), 'utf8');
  check('sign-in goes to the checked "next", not always home',
    /const returnTo = safeReturnPath\(searchParams\.get\('next'\)\);/.test(login) && /navigate\(returnTo\);/.test(login) && !/navigate\('\/'\);/.test(login));
  check('every sign-in button on the event page comes back to it',
    !/navigate\('\/login'\)/.test(event) && (event.match(/onClick=\{signInHere\}/g) || []).length === 3
      && /const signInHere = \(\) => navigate\(loginReturningTo\(location\.pathname\)\);/.test(event));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
