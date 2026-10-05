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
import {
  CALENDAR_DAY_SKEW_SECONDS,
  completedSplitsSince,
  COUNT_RUNNING_SPLIT,
  LastGoodCalendar,
  readSplitCalendar,
  STALE_CALENDAR_MAX_AGE_SECONDS,
  type CalendarReading,
  type SplitCalendar,
} from '../server/lib/ufSplitCount.js';

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
const HOUR = 3600;
const DAY = 24 * HOUR;

/** "Now" for every reading below: the day this was written. */
const NOW = at('2026-10-05T12:00:00Z');
/** What the eligibility module asks for: the rule's four. */
const NEEDED = 4;
const read = (source: any, o: { now?: number; finishedNeeded?: number } = {}): CalendarReading =>
  readSplitCalendar(source, { now: NOW, finishedNeeded: NEEDED, ...o });

/** The four people who have published a request, with the date of their first plan record. */
const REQUESTERS = {
  'Evolution Health and Wellness (7. 1. 2026)': { enrolledAt: 1767810091, expect: 4 },
  'Dokapitalizacija Lana Discount (26. 10. 2025)': { enrolledAt: 1761484769, expect: 5 },
  'Reševanje moje osebne stiske (26. 10. 2025)': { enrolledAt: 1761486472, expect: 5 },
  'LanaFund.Me test (26. 10. 2025)': { enrolledAt: 1761484769, expect: 5 },
};

const reading = read(live());
if (!reading.ok) throw new Error('the live calendar must be readable: ' + reading.reason);
const calendar = reading.calendar;

console.log('— the calendar production publishes —');
{
  check('it is readable', reading.ok);
  check('the running Split is 9, begun 8. 9. 2026 22:00 UTC', calendar.current === 9 && calendar.currentStartedAt === 1788904800, calendar);
  check('all nine Splits, oldest first, each with its day', calendar.past.length === 9 && calendar.past.every((r, i) => r.split === i + 1), calendar.past);
  check('the same calendar read from the event as JSON', JSON.stringify(read(JSON.stringify(live()))) === JSON.stringify(reading));
  check('a sound reading is not marked as standing in for another', !('staleBecause' in reading));
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

console.log('— the edges: a Split counts when the member enrolled before it BEGAN —');
{
  const split5 = 1775001600;                       // the row: 2026-04-01 00:00 UTC
  const began5 = split5 - CALENDAR_DAY_SKEW_SECONDS; // read as: 2026-03-31 22:00 UTC, the latest it can have begun
  check('the skew is two hours: a Split begins at midnight in Slovenia, its row is UTC midnight', CALENDAR_DAY_SKEW_SECONDS === 2 * HOUR);
  check('and that is exactly the gap of the Split production publishes today (began 22:00 UTC, row 00:00 UTC next day)',
    1788912000 - 1788904800 === CALENDAR_DAY_SKEW_SECONDS);
  check('one second before it began: Split 5 counts (four)', completedSplitsSince(began5 - 1, calendar) === 4);
  check('the very second it began: it does not (it did not begin after)', completedSplitsSince(began5, calendar) === 3);
  check('an hour into it: it does not — you joined halfway through', completedSplitsSince(began5 + HOUR, calendar) === 3);
  check('at the row\'s own midnight: it does not', completedSplitsSince(split5, calendar) === 3);
  check('a day later: still not', completedSplitsSince(split5 + DAY, calendar) === 3);
  check('a time that is not a number counts nothing', completedSplitsSince(Number.NaN, calendar) === 0 && completedSplitsSince(Number.POSITIVE_INFINITY, calendar) === 0);
  check('the running Split is not counted unless the one switch says so', COUNT_RUNNING_SPLIT === false);

  // The decision is exactly "enrolled before the fourth-newest finished Split began" — everywhere, not at a few points.
  const rows = calendar.past.filter((r) => r.split < calendar.current);
  const fourthNewest = rows[rows.length - NEEDED].happenedAt - CALENDAR_DAY_SKEW_SECONDS;
  let mismatches = 0;
  for (let e = at('2025-01-01T00:00:00Z'); e < at('2026-12-31T00:00:00Z'); e += 1800) {
    if ((completedSplitsSince(e, calendar) >= NEEDED) !== (e < fourthNewest)) mismatches++;
  }
  check('for every half hour from 2025 to 2027: four Splits ⇔ enrolled before the fourth-newest finished Split began', mismatches === 0, mismatches);

  // The moment Split 10 begins, Split 9 is over and counts for everybody enrolled before it.
  const tenTags = [...LIVE_TAGS.filter((t) => t[0] !== 'split' && t[0] !== 'split_started_at'), ['split', '10'], ['split_started_at', '1793990000'], ['split_history', '10', '1794000000']];
  const next = read({ tags: tenTags, content: '{}' }, { now: 1794100000 });
  check('when Split 10 begins, Split 9 becomes completed: Evolution has five', next.ok && completedSplitsSince(1767810091, next.calendar) === 5, next);

  // The running Split's own row is not required: its start is published as split_started_at.
  const noRow = read(live([], (t) => t[0] === 'split_history' && t[1] === '9'));
  check('the running Split need not be listed in the history', noRow.ok && completedSplitsSince(1767810091, noRow.calendar) === 4);
  check('…and when counted anyway it counts from the moment it began', noRow.ok && completedSplitsSince(1767810091, noRow.calendar, { countRunning: true }) === 5 &&
    noRow.ok && completedSplitsSince(1788904800, noRow.calendar, { countRunning: true }) === 0);

  const fromFive = read({ tags: [['split', '9'], ['split_started_at', '1788904800'], ...LIVE_TAGS.filter((t) => t[0] === 'split_history' && Number(t[1]) >= 5)], content: '' });
  check('a history that starts at Split 5 is still read, and its count can only be too low', fromFive.ok && completedSplitsSince(1761484769, fromFive.calendar) === 4);
}

console.log('— a calendar that cannot be trusted is not counted from —');
{
  const refuses = (name: string, source: any, why: RegExp, o: { now?: number; finishedNeeded?: number } = {}) => {
    const r = read(source, o);
    check(name, !r.ok && why.test(r.reason), r);
  };
  /** The live calendar with one tag replaced / removed / added. */
  const swap = (match: (t: string[]) => boolean, to: string[] | null) => ({
    tags: [...LIVE_TAGS.flatMap((t) => (match(t) ? (to ? [to] : []) : [t]))],
    content: '{}',
  });
  const row = (n: number) => (t: string[]) => t[0] === 'split_history' && t[1] === String(n);
  const named = (name: string) => (t: string[]) => t[0] === name;

  refuses('nothing stored', null, /no system parameters/);
  refuses('stored text that is not JSON', 'not json', /not readable/);
  refuses('no running Split named', swap(named('split'), null), /no running Split/);
  refuses('a running Split that is not a number', swap(named('split'), ['split', 'nine']), /no running Split/);
  refuses('no beginning published for the running Split', swap(named('split_started_at'), null), /do not say when Split 9 began/);
  refuses('a beginning that cannot be read', swap(named('split_started_at'), ['split_started_at', 'soon']), /do not say when Split 9 began/);
  refuses('a beginning in milliseconds', swap(named('split_started_at'), ['split_started_at', '1788904800000']), /cannot be a real moment/);
  refuses('a beginning in the future', swap(named('split_started_at'), ['split_started_at', String(NOW + 10 * DAY)]), /cannot be a real moment/);
  refuses('a beginning before there was a Lana', swap(named('split_started_at'), ['split_started_at', '1500000000']), /cannot be a real moment/);
  refuses('no Split history at all', { tags: [['split', '9'], ['split_started_at', '1788904800']], content: '{}' }, /no Split history/);
  refuses('a history row that cannot be read', live([['split_history', 'ten', 'soon']]), /cannot be read/);
  refuses('a history row with no date', live([['split_history', '10']]), /cannot be read/);
  refuses('a zero or negative date', swap(row(1), ['split_history', '1', '-5']), /cannot be read/);
  refuses('a finished Split dated in milliseconds', swap(row(8), ['split_history', '8', '1782950400000']), /cannot be real/);
  refuses('a finished Split dated in the future', swap(row(8), ['split_history', '8', String(NOW + 30 * DAY)]), /cannot be real/);
  refuses('a finished Split dated before there was a Lana', swap(row(1), ['split_history', '1', '1500000000']), /cannot be real/);
  refuses('a Split listed that has not begun (10 while 9 runs)', live([['split_history', '10', String(NOW + DAY / 2)]]), /has not begun/);
  refuses('the same Split with two different dates', live([['split_history', '4', '1766620801']]), /two different dates/);
  refuses('a Split dated no later than the one before it', swap(row(6), ['split_history', '6', '1775001600']), /no later than/);
  refuses('a hole in the middle (Split 3 missing)', live([], row(3)), /skips Split 3/);
  refuses('the newest finished Split missing while the running one is listed (8)', live([], row(8)), /skips Split 8/);
  refuses('the newest finished Split missing and the running one not listed either', live([], (t) => row(8)(t) || row(9)(t)), /does not list Split 8/);
  refuses('the history is shorter than the rule looks back over (Splits 6-8 only)', live([], (t) => t[0] === 'split_history' && Number(t[1]) <= 5), /does not list Split 5/);
  check('…yet the same short history is fine for a rule that looks back over three', read(live([], (t) => t[0] === 'split_history' && Number(t[1]) <= 5), { finishedNeeded: 3 }).ok);
  check('…and the default asks only for the newest finished Split', readSplitCalendar(live([], (t) => t[0] === 'split_history' && Number(t[1]) <= 5), { now: NOW }).ok);
  refuses('the last finished Split dated after the running one began', swap(named('split_started_at'), ['split_started_at', String(1782950400 - 60)]), /no earlier than the beginning of Split 9/);
  refuses('the running Split\'s row and its beginning three days apart', swap(row(9), ['split_history', '9', String(1788904800 + 3 * DAY)]), /two different days/);
  check('the same row twice with the same date is not a contradiction', read(live([['split_history', '4', '1766620800']])).ok);
  check('a row a few hours after the beginning is the normal case (Slovenian midnight vs UTC midnight)', read(live()).ok);
  check('…and one a day away is still read', read(swap(row(9), ['split_history', '9', String(1788904800 + DAY)])).ok);
  check('dates a clock-error ahead of now are still read (a day of slack)', read(live(), { now: 1788912000 - HOUR }).ok);

  const both = read({
    tags: LIVE_TAGS,
    content: JSON.stringify({ split: 3, split_started_at: 5, split_history: [{ split: 1, happened_at: 7 }] }),
  });
  check('when tags and content disagree, the tags win', both.ok && both.calendar.current === 9 && both.calendar.past.length === 9);

  const fromContent = read({
    tags: [],
    content: JSON.stringify({ split: 9, split_started_at: 1788904800, split_history: LIVE_TAGS.filter((t) => t[0] === 'split_history').map((t) => ({ split: Number(t[1]), happened_at: Number(t[2]) })) }),
  });
  check('with no tags, the content carries the same calendar', fromContent.ok && JSON.stringify(fromContent.calendar) === JSON.stringify(calendar));
}

console.log('— a calendar that stands in for one that cannot be read —');
{
  const keeper = new LastGoodCalendar();
  const T0 = NOW;
  const broken: CalendarReading = { ok: false, reason: 'the published Split history skips Split 3' };

  check('a fresh process with an unreadable calendar says "unavailable" (nothing is guessed)', !keeper.settle(broken, T0).ok);
  const sound = keeper.settle(reading, T0);
  check('a sound calendar is passed on as it is', sound === reading);

  const stood = keeper.settle(broken, T0 + HOUR);
  check('an hour later, unreadable: the sound one answers, and says why', stood.ok && stood.calendar === calendar && /skips Split 3/.test(stood.staleBecause || ''), stood);
  const sixDays = keeper.settle(broken, T0 + 6 * DAY);
  check('six days later: still', sixDays.ok && sixDays.calendar === calendar);
  const edge = keeper.settle(broken, T0 + STALE_CALENDAR_MAX_AGE_SECONDS);
  check('exactly a week later: still (the limit is inclusive)', edge.ok);
  const over = keeper.settle(broken, T0 + STALE_CALENDAR_MAX_AGE_SECONDS + 1);
  check('a second more than a week: "unavailable" again', !over.ok && over.reason === broken.reason, over);
  check('a stood-in answer does not refresh the clock: asking again does not extend the week', !keeper.settle(broken, T0 + STALE_CALENDAR_MAX_AGE_SECONDS + 2).ok);

  const goingBack = new LastGoodCalendar();
  goingBack.settle(reading, T0);
  check('a clock that has gone BACK is not trusted to measure a week', !goingBack.settle(broken, T0 - HOUR).ok);

  // The reason it is safe: a Split is only ever ADDED, so an older calendar counts fewer, never more.
  const ten = read({ tags: [...LIVE_TAGS.filter((t) => t[0] !== 'split' && t[0] !== 'split_started_at'), ['split', '10'], ['split_started_at', '1793990000'], ['split_history', '10', '1794000000']], content: '{}' }, { now: 1794100000 });
  let moreThanReal = 0;
  let fewerThanReal = 0;
  if (!ten.ok) throw new Error('the next calendar must be readable');
  for (let e = at('2025-01-01T00:00:00Z'); e < at('2027-06-01T00:00:00Z'); e += 3600) {
    const old = completedSplitsSince(e, calendar);
    const real = completedSplitsSince(e, ten.calendar);
    if (old > real) moreThanReal++;
    if (old < real) fewerThanReal++;
  }
  check('for every hour from 2025 to mid-2027, the calendar from before Split 10 never counts MORE than the one after it', moreThanReal === 0, moreThanReal);
  check('…and it does count fewer for those who enrolled before Split 9 (the price of standing in)', fewerThanReal > 0, fewerThanReal);
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
  const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  check('eligibility counts from the signed calendar', /from '\.\/ufSplitCount\.js'/.test(code) && /completedSplitsSince\(enrolledAt, reading\.calendar\)/.test(code));
  check('it does not read the table the server fills as it watches Splits (two rows on 5. 10. 2026)', !/split_history/i.test(code));
  check('there is no exception for long-time members', !/grandfather/i.test(code) && !/earliestRecorded/.test(code));
  check('a calendar that cannot be read is an error (503), never "not eligible"', /if \(reading\.ok === false\) \{\s*return \{ error:/.test(code));
  check('the calendar is asked for the same number of Splits the rule counts, from one constant',
    /finishedNeeded: UF_REQUIRED_COMPLETED_SPLITS/.test(code) && /eligible: completed >= UF_REQUIRED_COMPLETED_SPLITS/.test(code));
  check('the last sound calendar is kept per database, not per process', /new WeakMap<object, LastGoodCalendar>\(\)/.test(code));
  check('a Split that is not over is not "completed" (one named switch, off)', /export const COUNT_RUNNING_SPLIT = false;/.test(lib));
  check('only Splits before the running one are counted by default, and only if the member enrolled before they BEGAN',
    /row\.split < calendar\.current && row\.happenedAt - CALENDAR_DAY_SKEW_SECONDS > enrolledAt/.test(libCode));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
