/**
 * TEMPORARY CAMPAIGN — the "Mejmo se f*cking fajn" invitation (21. 11. 2026): dates,
 * countdown words, once a day, quiet pages. Delete together with src/campaigns/mejmoSeFajn2026.
 *   npx tsx scripts/testMejmoInvite.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  EVENT_DTAG, EVENT_START_MS, FLYER_URL, IN_APP_EVENT_PATH, campaignIsOn, countdownBadge, daysUntilEvent, dueToday, ljubljanaDay, quietPage, timeLeftToChange,
} from '../src/campaigns/mejmoSeFajn2026/invite.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const at = (iso: string) => new Date(iso).getTime();

console.log('— the date —');
check('the event starts 21. 11. 2026 at 16.00 in Ljubljana', new Date(EVENT_START_MS).toISOString() === '2026-11-21T15:00:00.000Z');
check('days are counted in Ljubljana: 11. 11. → 10', daysUntilEvent(at('2026-11-11T12:00:00Z')) === 10);
check('…late evening in Ljubljana is already the next day (23.30 UTC on 19. 11. = 00.30 on 20. 11.) → 1', daysUntilEvent(at('2026-11-19T23:30:00Z')) === 1);
check('on the day: 0', daysUntilEvent(at('2026-11-21T08:00:00Z')) === 0);
check('on until 16.00 on the day, off from then on', campaignIsOn(at('2026-11-21T14:59:59Z')) && !campaignIsOn(at('2026-11-21T15:00:00Z')) && !campaignIsOn(at('2026-12-01T00:00:00Z')));

console.log('— once a day —');
{
  const now = at('2026-11-12T09:00:00Z');
  check('never shown → shown', dueToday(now, null));
  check('already shown today (Ljubljana day) → not again', !dueToday(now, ljubljanaDay(now)));
  check('shown yesterday → shown today', dueToday(now, '2026-11-11'));
  check('after the event → never', !dueToday(at('2026-11-22T09:00:00Z'), null));
}

console.log('— the words —');
{
  check('Slovenian: 10 → "Še 10 dni"', countdownBadge(10, true).startsWith('Še 10 dni'));
  check('Slovenian: 2 → "Še 2 dneva", 3 and 4 → "dnevi", 5 → "dni"',
    countdownBadge(2, true).startsWith('Še 2 dneva') && countdownBadge(3, true).startsWith('Še 3 dnevi') && countdownBadge(4, true).startsWith('Še 4 dnevi') && countdownBadge(5, true).startsWith('Še 5 dni'));
  check('1 → tomorrow, 0 → today at 16.00', /JUTRI/.test(countdownBadge(1, true)) && /DANES ob 16\.00/.test(countdownBadge(0, true)));
  check('"imaš še X …, da se premisliš": 1 dan, 2 dneva, 3 dni, 10 dni',
    timeLeftToChange(1, true) === 'imaš še 1 dan' && timeLeftToChange(2, true) === 'imaš še 2 dneva' && timeLeftToChange(3, true) === 'imaš še 3 dni' && timeLeftToChange(10, true) === 'imaš še 10 dni');
  check('English too', countdownBadge(10, false).startsWith('10 days to go') && timeLeftToChange(10, false) === 'you still have 10 days');
}

console.log('— where it never interrupts —');
for (const p of ['/send-lana/private-key', '/send-lana', '/wallet/consolidate/Lx', '/events/donate-private-key/x', '/unconditional-financing/contribute/uf:1/private-key', IN_APP_EVENT_PATH, '/events/detail/event:1794396674815-ptvmzd', '/login']) {
  check(`quiet: ${p}`, quietPage(p));
}
for (const p of ['/', '/wallet', '/events/online', '/unconditional-financing/requests']) check(`shown on: ${p}`, !quietPage(p));

console.log('— the pieces —');
{
  check('the flyer is in the app’s public files', existsSync(new URL('../public' + FLYER_URL, import.meta.url)));
  const ui = readFileSync(new URL('../src/campaigns/mejmoSeFajn2026/MejmoInvite.tsx', import.meta.url), 'utf8');
  check('"Pridem!" registers exactly like "I\'m Going" on the event page (KIND 53333, this event, going)',
    /kind: 53333/.test(ui) && /\["event", EVENT_DTAG\], \["status", "going"\], \["p", hex\], \["seats", "1"\], \["source", "Lana\.app"\]/.test(ui) && EVENT_DTAG === 'event:1794396674815-ptvmzd');
  check('"Ne grem" is remembered, and the next day teases instead of invites', /write\(key\(hex, "declined"\), "1"\)/.test(ui) && /read\(key\(hex, "declined"\)\) \? "declined" : "invite"/.test(ui));
  check('built for a phone: fits the screen and scrolls, thumb-sized buttons', /max-h-\[92dvh\] overflow-y-auto/.test(ui) && /max-h-\[40dvh\]/.test(ui) && /h-12 text-base/.test(ui));
  const layout = readFileSync(new URL('../src/components/layout/MainLayout.tsx', import.meta.url), 'utf8');
  check('mounted once, in the signed-in layout, marked temporary', (layout.match(/<MejmoInvite \/>/g) || []).length === 1 && /TEMPORARY campaign \(21\. 11\. 2026\)/.test(layout));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
