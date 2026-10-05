/**
 * Unconditional Financing — how many Splits has a member COMPLETED since enrolling?
 *
 * The rule is "a member of Lana8Wonder for at least four completed Splits", and
 * the app tells people so in their own words: "Tvoji zaključeni Spliti od
 * včlanitve: 2 / 4". It was never counted that way. The count came from a
 * table this server fills as it WATCHES a Split begin, and the watching only
 * started with Split 8 — so on 5. 10. 2026 the table held two rows, no one could
 * possibly reach four, and every requester got in through a "long-time member"
 * exception instead (anyone with a plan older than the table). 371 of the 499
 * Lana8Wonder members were allowed to submit; counted for real, 288 are.
 *
 * The real calendar is already published and signed: KIND 38888, whose author
 * the server pins, lists every Split that has happened and the day it happened
 * (`["split_history", "<n>", "<unix seconds>"]`, UTC midnight of that day),
 * names the Split that is running now (`split`) and when it began
 * (`split_started_at`). This file reads that calendar and counts from it — the
 * calendar is parsed and checked HERE, in one pure place, so it can be tested
 * against the very tags production publishes.
 *
 * Three decisions, each with a reason:
 *
 *  - The running Split is not counted. A Split that has not finished is not
 *    "completed", and the wording of the rule and of the screen both say so.
 *    COUNT_RUNNING_SPLIT is the one switch if that ever has to change; counted,
 *    11 more members would pass (72 refused instead of 83).
 *
 *  - A calendar that contradicts itself, or has a hole in it, is NOT counted
 *    from. It answers "unavailable" and the route answers 503: "I cannot tell"
 *    must never read as "you are not a member" (people refused with no
 *    explanation) or, worse, as "you are one". What is checked (readSplitCalendar):
 *    every number readable; every date a real moment (after 2020, not in the
 *    future); dates rising with the Split number; no Split listed that has not
 *    begun; the newest N finished Splits all listed, N being the number the rule
 *    asks for (those N dates ARE the decision: a member passes exactly when they
 *    enrolled before the Nth newest, so without them a count is meaningless, not
 *    just low); the running Split's start published, after the last finished
 *    Split, and within a day of its own row.
 *
 *  - A Split counts only if the member enrolled BEFORE IT BEGAN. The calendar
 *    dates a Split by its UTC day, but a Split begins at midnight in Slovenia —
 *    22:00 or 23:00 UTC the evening before — so a row is one or two hours LATER
 *    than the beginning it stands for (Split 9: began 8. 9. 22:00 UTC, row dated
 *    9. 9. 00:00 UTC). Compared as published, someone who enrolled in those first
 *    hours would be counted for a Split they joined halfway through. A row is
 *    therefore read as CALENDAR_DAY_SKEW_SECONDS earlier than it says: exact in
 *    summer time, an hour too strict in winter time — wrong only towards "not
 *    yet", never towards "already".
 */

/** Whether the Split that is running now counts as completed. It does not. */
export const COUNT_RUNNING_SPLIT = false;

/**
 * A row is dated at UTC midnight of the day its Split began in Slovenia, so it is
 * at most this much later than the real beginning (2 h in summer time, 1 h in winter).
 */
export const CALENDAR_DAY_SKEW_SECONDS = 2 * 3600;

/** No Split happened before this (2020-01-01 UTC) — a smaller number is a typo, not a date. */
const EARLIEST_PLAUSIBLE = 1_577_836_800;
/** The clock is not trusted to the second: a date this far ahead of now is still "now". */
const FUTURE_SLACK_SECONDS = 24 * 3600;
/** The running Split's row and its `split_started_at` describe the same day. */
const ROW_VS_START_TOLERANCE_SECONDS = 24 * 3600;
/**
 * How long the last sound calendar may stand in for one that cannot be read. Finished
 * Splits are only ever added, so an older calendar can only count FEWER Splits than the
 * real one — it can refuse somebody a little too long, never admit somebody too early.
 */
export const STALE_CALENDAR_MAX_AGE_SECONDS = 7 * 24 * 3600;

/** One published `split_history` row: the day that Split happened. */
export interface SplitRow {
  split: number;
  /** Unix seconds — UTC midnight of the day it happened. */
  happenedAt: number;
}

export interface SplitCalendar {
  /** The Split that is running now (KIND 38888 `split`). */
  current: number;
  /** When it began (`split_started_at`). */
  currentStartedAt: number;
  /** Every published Split, oldest first. Includes the running one once it is listed. */
  past: SplitRow[];
}

export type CalendarReading =
  | { ok: true; calendar: SplitCalendar; /** Set when this is the last sound calendar standing in for one that could not be read now. */ staleBecause?: string }
  | { ok: false; reason: string };

export interface ReadOptions {
  /** Unix seconds; the wall clock unless a test says otherwise. */
  now?: number;
  /** How many of the newest FINISHED Splits must be listed (the rule's N). Default 1. */
  finishedNeeded?: number;
}

type EventLike = { tags?: unknown; content?: unknown };

const asPositiveInt = (raw: unknown): number | null => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const firstTag = (tags: string[][], name: string): string | undefined =>
  tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];

/**
 * The Split calendar out of a signed KIND 38888 (the parsed event, or its JSON).
 * Tags first, content as the fallback — the authority publishes both, and the
 * app's own reader (SystemParametersContext) has always preferred the tags.
 */
export function readSplitCalendar(source: EventLike | string | null | undefined, options: ReadOptions = {}): CalendarReading {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const finishedNeeded = Math.max(1, Math.floor(options.finishedNeeded ?? 1));
  const latest = now + FUTURE_SLACK_SECONDS;
  const isMoment = (t: number) => t >= EARLIEST_PLAUSIBLE && t <= latest;

  let event: EventLike;
  try {
    event = typeof source === 'string' ? JSON.parse(source) : (source as EventLike);
  } catch {
    return { ok: false, reason: 'the stored system parameters are not readable' };
  }
  if (!event || typeof event !== 'object') return { ok: false, reason: 'no system parameters are stored' };

  const tags: string[][] = Array.isArray(event.tags) ? (event.tags as string[][]) : [];
  let content: Record<string, any> = {};
  if (typeof event.content === 'string' && event.content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) content = parsed;
    } catch {
      /* the tags may still carry everything */
    }
  }

  const current = asPositiveInt(firstTag(tags, 'split') ?? content.split);
  if (current === null) return { ok: false, reason: 'the published parameters name no running Split' };

  const currentStartedAt = asPositiveInt(firstTag(tags, 'split_started_at') ?? content.split_started_at);
  if (currentStartedAt === null) return { ok: false, reason: `the published parameters do not say when Split ${current} began` };
  if (!isMoment(currentStartedAt)) return { ok: false, reason: `the published beginning of Split ${current} cannot be a real moment` };

  // Every row is read, and a row that cannot be read stops the whole reading:
  // skipping it would quietly lower somebody's count.
  const raw: { split: unknown; at: unknown }[] = [];
  const tagRows = tags.filter((t) => Array.isArray(t) && t[0] === 'split_history');
  if (tagRows.length > 0) {
    for (const t of tagRows) raw.push({ split: t[1], at: t[2] });
  } else if (Array.isArray(content.split_history)) {
    for (const row of content.split_history) raw.push({ split: row?.split, at: row?.happened_at });
  }
  if (raw.length === 0) return { ok: false, reason: 'the published parameters carry no Split history' };

  const bySplit = new Map<number, number>();
  for (const { split, at } of raw) {
    const n = asPositiveInt(split);
    const happenedAt = asPositiveInt(at);
    if (n === null || happenedAt === null) return { ok: false, reason: 'the published Split history has a row that cannot be read' };
    if (n > current) return { ok: false, reason: `the published Split history lists Split ${n}, which has not begun (Split ${current} is running)` };
    if (!isMoment(happenedAt)) return { ok: false, reason: `the published Split history gives Split ${n} a date that cannot be real` };
    const known = bySplit.get(n);
    if (known !== undefined && known !== happenedAt) return { ok: false, reason: `the published Split history gives Split ${n} two different dates` };
    bySplit.set(n, happenedAt);
  }

  const past = [...bySplit.entries()].map(([split, happenedAt]) => ({ split, happenedAt })).sort((a, b) => a.split - b.split);

  for (let i = 1; i < past.length; i++) {
    if (past[i].happenedAt <= past[i - 1].happenedAt) {
      return { ok: false, reason: `the published Split history has Split ${past[i].split} no later than Split ${past[i - 1].split}` };
    }
    if (past[i].split !== past[i - 1].split + 1) {
      return { ok: false, reason: `the published Split history skips Split ${past[i - 1].split + 1}` };
    }
  }
  // The newest finished Split is the one a new Split turns into "completed", and the
  // newest N together are what the rule is decided on: they must all be there.
  for (let n = current - 1; n >= Math.max(1, current - finishedNeeded); n--) {
    if (!bySplit.has(n)) return { ok: false, reason: `the published Split history does not list Split ${n}` };
  }

  // The running Split's two published facts must agree with the history around them.
  const lastFinished = bySplit.get(current - 1);
  if (lastFinished !== undefined && lastFinished >= currentStartedAt) {
    return { ok: false, reason: `the published Split history dates Split ${current - 1} no earlier than the beginning of Split ${current}` };
  }
  const ownRow = bySplit.get(current);
  if (ownRow !== undefined && Math.abs(ownRow - currentStartedAt) > ROW_VS_START_TOLERANCE_SECONDS) {
    return { ok: false, reason: `the published Split history and split_started_at give Split ${current} two different days` };
  }

  return { ok: true, calendar: { current, currentStartedAt, past } };
}

/**
 * The Splits that have happened AND are over since the member enrolled — a Split
 * counts when the member enrolled before it began (see the header on the two hours).
 * `enrolledAt` is unix seconds; anything that is not a number counts nothing.
 */
export function completedSplitsSince(
  enrolledAt: number,
  calendar: SplitCalendar,
  { countRunning = COUNT_RUNNING_SPLIT }: { countRunning?: boolean } = {},
): number {
  if (!Number.isFinite(enrolledAt)) return 0;

  let completed = calendar.past.filter(
    (row) => row.split < calendar.current && row.happenedAt - CALENDAR_DAY_SKEW_SECONDS > enrolledAt,
  ).length;

  if (countRunning && calendar.currentStartedAt > enrolledAt) completed += 1;
  return completed;
}

/**
 * Remembers the last calendar that read soundly. When the stored one cannot be read
 * (someone mid-edit, a tag renamed), a recent sound one answers instead of "unavailable"
 * for every request until it is mended — and the answer can only be too cautious (see
 * STALE_CALENDAR_MAX_AGE_SECONDS). After that long, or on a fresh process, it is
 * "unavailable": nothing is guessed.
 */
export class LastGoodCalendar {
  private good: { calendar: SplitCalendar; at: number } | null = null;

  settle(reading: CalendarReading, nowSeconds: number): CalendarReading {
    if (reading.ok === false) {
      const age = this.good ? nowSeconds - this.good.at : -1;
      if (this.good && age >= 0 && age <= STALE_CALENDAR_MAX_AGE_SECONDS) {
        return { ok: true, calendar: this.good.calendar, staleBecause: reading.reason };
      }
      return reading;
    }
    if (!reading.staleBecause) this.good = { calendar: reading.calendar, at: nowSeconds };
    return reading;
  }
}
