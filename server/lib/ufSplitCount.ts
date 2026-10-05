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
 * Two decisions, each with a reason:
 *
 *  - The running Split is not counted. A Split that has not finished is not
 *    "completed", and the wording of the rule and of the screen both say so.
 *    COUNT_RUNNING_SPLIT is the one switch if that ever has to change; counted,
 *    11 more members would pass (72 refused instead of 83).
 *
 *  - A calendar that contradicts itself, or has a hole in it, is NOT counted
 *    from. It answers "unavailable" and the route answers 503: "I cannot tell"
 *    must never read as "you are not a member" (people refused with no
 *    explanation) or, worse, as "you are one". Every count taken from a sound
 *    calendar can only be too LOW if a row were missing, never too high — a
 *    missing row can refuse someone, it cannot admit them — which is why a
 *    hole is a reason to stop and say so rather than to guess.
 */

/** Whether the Split that is running now counts as completed. It does not. */
export const COUNT_RUNNING_SPLIT = false;

/** One published `split_history` row: the day that Split happened. */
export interface SplitRow {
  split: number;
  /** Unix seconds — UTC midnight of the day it happened. */
  happenedAt: number;
}

export interface SplitCalendar {
  /** The Split that is running now (KIND 38888 `split`). */
  current: number;
  /** When it began (`split_started_at`), when published. */
  currentStartedAt: number | null;
  /** Every published Split, oldest first. Includes the running one once it is listed. */
  past: SplitRow[];
}

export type CalendarReading =
  | { ok: true; calendar: SplitCalendar }
  | { ok: false; reason: string };

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
export function readSplitCalendar(source: EventLike | string | null | undefined): CalendarReading {
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

  const startedRaw = firstTag(tags, 'split_started_at') ?? content.split_started_at;
  const currentStartedAt = startedRaw === undefined ? null : asPositiveInt(startedRaw);

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
    const known = bySplit.get(n);
    if (known !== undefined && known !== happenedAt) return { ok: false, reason: `the published Split history gives Split ${n} two different dates` };
    bySplit.set(n, happenedAt);
  }

  const past = [...bySplit.entries()].map(([split, happenedAt]) => ({ split, happenedAt })).sort((a, b) => a.split - b.split);

  for (let i = 1; i < past.length; i++) {
    if (past[i].happenedAt <= past[i - 1].happenedAt) {
      return { ok: false, reason: `the published Split history has Split ${past[i].split} no later than Split ${past[i - 1].split}` };
    }
    if (past[i].split !== past[i - 1].split + 1 && past[i - 1].split + 1 < current) {
      return { ok: false, reason: `the published Split history skips Split ${past[i - 1].split + 1}` };
    }
  }
  // The newest finished Split must be there: it is the one a new Split turns
  // into "completed", and the one a person enrolled just before it needs.
  if (current > 1 && !bySplit.has(current - 1)) {
    return { ok: false, reason: `the published Split history does not list Split ${current - 1}` };
  }

  return { ok: true, calendar: { current, currentStartedAt, past } };
}

/**
 * The Splits that have happened AND are over since the member enrolled.
 * `enrolledAt` is unix seconds; anything that is not a number counts nothing.
 */
export function completedSplitsSince(
  enrolledAt: number,
  calendar: SplitCalendar,
  { countRunning = COUNT_RUNNING_SPLIT }: { countRunning?: boolean } = {},
): number {
  if (!Number.isFinite(enrolledAt)) return 0;

  let completed = calendar.past.filter((row) => row.split < calendar.current && row.happenedAt > enrolledAt).length;

  if (countRunning) {
    const running =
      calendar.past.find((row) => row.split === calendar.current)?.happenedAt ?? calendar.currentStartedAt;
    if (running !== null && running !== undefined && running > enrolledAt) completed += 1;
  }
  return completed;
}
