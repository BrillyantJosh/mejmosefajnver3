/**
 * "A member of Lana8Wonder for at least four COMPLETED Splits" — counted from
 * the signed calendar, not from a table that only started at Split 8.
 *   npx tsx scripts/testUfSplitCount.ts
 *
 * Brilly asked on 5. 10. 2026 whether the 4-Splits rule is really checked. It
 * was not: the count came from a server table holding two rows (Splits 8 and
 * 9), nobody could reach four, and every requester passed through the
 * "long-time member" exception. The calendar below is the one production
 * publishes in its signed KIND 38888, tag for tag, so these checks are about
 * the real thing.
 */
import { readFileSync } from 'node:fs';
import { completedSplitsSince, COUNT_RUNNING_SPLIT, readSplitCalendar } from '../server/lib/ufSplitCount.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 220)}`);
  if (!cond) failures++;
};

/** KIND 38888 as published on 14. 9. 2026 (event 57309bebcb…, author 9eb71bf1…): only what the count reads. */
const LIVE_TAGS: string[][] = [
  ['split', '9'],
  ['split_started_at', '1788904800'],
  ['split_history', '9', '1788912000'], // 2026-09-09
  ['split_history', '8', '1782950400'], // 2026-07-02
  ['split_history', '7', '1780272000'], // 2026-06-01
  ['split_history', '6', '1776211200'], // 2026-04-15
  ['split_history', '5', '1775001600'], // 2026-04-01
  ['split_history', '4', '1766620800'], // 2025-12-25
  ['split_history', '3', '1757894400'], // 2025-09-15
  ['split_history', '2', '1752537600'], // 2025-07-15
  ['split_history', '1', '1751328000'], // 2025-07-01
  ['version', '9'],
];
const live = (extra: string[][] = [], drop: (t: string[]) => boolean = () => false) => ({
  tags: [...LIVE_TAGS.filter((t) => !drop(t)), ...extra],
  content: '{}',
});
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** The four people who have published a request, with the date of their first plan record. */
const REQUESTERS = {
  'Evolution Health and Wellness (7. 1. 2026)': { enrolledAt: 1767810091, expect: 4 },
  'Dokapitalizacija Lana Discount (26. 10. 2025)': { enrolledAt: 1761484769, expect: 5 },
  'Reševanje moje osebne stiske (26. 10. 2025)': { enrolledAt: 1761486472, expect: 5 },
  'LanaFund.Me test (26. 10. 2025)': { enrolledAt: 1761484769, expect: 5 },
};

const reading = readSplitCalendar(live());
if (!reading.ok) throw new Error('the live calendar must be readable: ' + reading.reason);
const calendar = reading.calendar;

console.log('— the calendar production publishes —');
{
  check('it is readable', reading.ok);
  check('the running Split is 9, begun 8. 9. 2026 22:00 UTC', calendar.current === 9 && calendar.currentStartedAt === 1788904800, calendar);
  check('all nine Splits, oldest first, each with its day', calendar.past.length === 9 && calendar.past.every((r, i) => r.split === i + 1), calendar.past);
  check('the same calendar read from the event as JSON', JSON.stringify(readSplitCalendar(JSON.stringify(live()))) === JSON.stringify(reading));
}

console.log('— the four people who published —');
{
  for (const [who, { enrolledAt, expect }] of Object.entries(REQUESTERS)) {
    const n = completedSplitsSince(enrolledAt, calendar);
    check(`${who}: ${expect} completed Splits — enough, for real`, n === expect && n >= 4, n);
  }
  check('Evolution had exactly four — the running Split 9 is not one of them',
    completedSplitsSince(1767810091, calendar) === 4 && completedSplitsSince(1767810091, calendar, { countRunning: true }) === 5);
}

console.log('— what the real rule does that the old table could not —');
{
  const eligible = (enrolledAt: number) => completedSplitsSince(enrolledAt, calendar) >= 4;
  // Splits 5, 6, 7, 8 are the last four that are over: enrol before 1. 4. and you have them all.
  check('enrolled 31. 3. 2026: Splits 5-8, four, passes', eligible(at('2026-03-31T12:00:00Z')));
  check('enrolled 2. 4. 2026: Splits 6-8, three, does not', !eligible(at('2026-04-02T12:00:00Z')) && completedSplitsSince(at('2026-04-02T12:00:00Z'), calendar) === 3);
  check('enrolled the afternoon of 1. 6. 2026: only Split 8 is over since', completedSplitsSince(at('2026-06-01T12:00:00Z'), calendar) === 1);
  check('someone who enrolled in July 2026 has none', completedSplitsSince(at('2026-07-15T12:00:00Z'), calendar) === 0);
  check('someone enrolled long before the first Split has all eight that are over', completedSplitsSince(at('2025-01-01T00:00:00Z'), calendar) === 8);
  check('nobody gains a Split by enrolling after it', completedSplitsSince(at('2027-01-01T00:00:00Z'), calendar) === 0);
}

console.log('— the edges —');
{
  const split5 = 1775001600;
  check('enrolled the very second Split 5 happened: it does not count (it did not happen after)', completedSplitsSince(split5, calendar) === 3, completedSplitsSince(split5, calendar));
  check('one second before: it counts', completedSplitsSince(split5 - 1, calendar) === 4);
  check('a time that is not a number counts nothing', completedSplitsSince(Number.NaN, calendar) === 0 && completedSplitsSince(Number.POSITIVE_INFINITY, calendar) === 0);
  check('the running Split is not counted unless the one switch says so', COUNT_RUNNING_SPLIT === false);

  // The moment Split 10 begins, Split 9 is over and counts for everybody enrolled before it.
  const next = readSplitCalendar({
    tags: [...LIVE_TAGS.filter((t) => t[0] !== 'split' && t[0] !== 'split_started_at'), ['split', '10'], ['split_started_at', '1793990000'], ['split_history', '10', '1794000000']],
    content: '{}',
  });
  check('when Split 10 begins, Split 9 becomes completed: Evolution has five', next.ok && completedSplitsSince(1767810091, next.calendar) === 5, next);

  // The running Split's own row is not required: its start is published as split_started_at.
  const noRow = readSplitCalendar(live([], (t) => t[0] === 'split_history' && t[1] === '9'));
  check('the running Split need not be listed in the history', noRow.ok && completedSplitsSince(1767810091, noRow.calendar) === 4);
  check('…and when counted anyway it falls back to the moment it began', noRow.ok && completedSplitsSince(1767810091, noRow.calendar, { countRunning: true }) === 5);

  const fromFive = readSplitCalendar({ tags: [['split', '9'], ...LIVE_TAGS.filter((t) => t[0] === 'split_history' && Number(t[1]) >= 5)], content: '' });
  check('a history that starts at Split 5 is still read, and its count can only be too low', fromFive.ok && completedSplitsSince(1761484769, fromFive.calendar) === 4);
}

console.log('— a calendar that cannot be trusted is not counted from —');
{
  const refuses = (name: string, source: any) => {
    const r = readSplitCalendar(source);
    check(name, !r.ok && typeof r.reason === 'string' && r.reason.length > 0, r);
  };
  refuses('nothing stored', null);
  refuses('stored text that is not JSON', 'not json');
  refuses('no running Split named', { tags: LIVE_TAGS.filter((t) => t[0] !== 'split'), content: '{}' });
  refuses('a running Split that is not a number', { tags: [['split', 'nine'], ...LIVE_TAGS.filter((t) => t[0] !== 'split')], content: '{}' });
  refuses('no Split history at all', { tags: [['split', '9']], content: '{}' });
  refuses('a history row that cannot be read', live([['split_history', 'ten', 'soon']]));
  refuses('a history row with no date', live([['split_history', '10']]));
  refuses('a zero or negative date', { tags: [['split', '2'], ['split_history', '1', '-5']], content: '' });
  refuses('the same Split with two different dates', live([['split_history', '4', '1766620801']]));
  refuses('a Split dated no later than the one before it', { tags: [...LIVE_TAGS.filter((t) => !(t[0] === 'split_history' && t[1] === '6')), ['split_history', '6', '1775001600']], content: '' });
  refuses('a hole in the middle (Split 3 missing)', live([], (t) => t[0] === 'split_history' && t[1] === '3'));
  refuses('the newest finished Split missing (8 is not listed while 9 runs)', live([], (t) => t[0] === 'split_history' && (t[1] === '8' || t[1] === '9')));
  check('the same row twice with the same date is not a contradiction', readSplitCalendar(live([['split_history', '4', '1766620800']])).ok);

  const both = readSplitCalendar({
    tags: LIVE_TAGS,
    content: JSON.stringify({ split: 3, split_started_at: 5, split_history: [{ split: 1, happened_at: 7 }] }),
  });
  check('when tags and content disagree, the tags win', both.ok && both.calendar.current === 9 && both.calendar.past.length === 9);

  const fromContent = readSplitCalendar({
    tags: [],
    content: JSON.stringify({ split: 9, split_started_at: 1788904800, split_history: LIVE_TAGS.filter((t) => t[0] === 'split_history').map((t) => ({ split: Number(t[1]), happened_at: Number(t[2]) })) }),
  });
  check('with no tags, the content carries the same calendar', fromContent.ok && JSON.stringify(fromContent.calendar) === JSON.stringify(calendar));
}

console.log('— the old count, for the record —');
{
  // What the table the server fills as it WATCHES Splits held on 5. 10. 2026.
  const watched = [{ split: 8, startedAt: 1782943200 }, { split: 9, startedAt: 1788904800 }];
  const oldCount = (enrolledAt: number) => watched.filter((r) => r.startedAt > enrolledAt).length;
  check('it held two Splits, so nobody could ever count four', Math.max(...Object.values(REQUESTERS).map((r) => oldCount(r.enrolledAt))) === 2);
  check('the real calendar gives the same people four or five', Object.values(REQUESTERS).every((r) => completedSplitsSince(r.enrolledAt, calendar) >= 4));
}

console.log('— where it is used —');
{
  const lib = readFileSync(new URL('../server/lib/ufSplitCount.ts', import.meta.url), 'utf8');
  const elig = readFileSync(new URL('../server/lib/ufEligibility.ts', import.meta.url), 'utf8');
  const code = elig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // what runs, not what is said about it

  check('eligibility counts from the signed calendar', /from '\.\/ufSplitCount\.js'/.test(code) && /completedSplitsSince\(enrolledAt, reading\.calendar\)/.test(code));
  check('it does not read the table the server fills as it watches Splits (two rows on 5. 10. 2026)', !/split_history/i.test(code));
  check('there is no exception for long-time members', !/grandfather/i.test(code) && !/earliestRecorded/.test(code));
  check('a calendar that cannot be read is an error (503), never "not eligible"', /if \(reading\.ok === false\) \{\s*return \{ error:/.test(code));
  check('a Split that is not over is not "completed" (one named switch, off)', /export const COUNT_RUNNING_SPLIT = false;/.test(lib));
  check('only Splits before the running one are counted by default', /row\.split < calendar\.current && row\.happenedAt > enrolledAt/.test(lib));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
