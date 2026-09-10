import { SimplePool } from 'nostr-tools';
import type { Event } from 'nostr-tools';

/**
 * Who is EXCLUDED by a commission gross-violation report (KIND 87058).
 *
 * Exclusion is not the same thing as a freeze, and the two must not wear the
 * same word. A KIND 87057 freeze is one facilitator pausing one person inside
 * one process; an exclusion is a commission of three deciding that someone is
 * out of the community. Calling both "frozen" made the heavier decision read
 * like the lighter one.
 *
 * Only the LanaSelfResponsibility signer named in KIND 38888 is honoured. The
 * publishing key is a voice, not a warrant — but a browser cannot verify the
 * ring proof, so this is a display-level check: it decides what WORD appears
 * next to a name, never whether anyone's access or money is touched. Those
 * come from the registrar.
 */

export const VIOLATION_KIND = 87058;

export interface Exclusion {
  personHex: string;
  /** The commission's own words. */
  reason: string;
  /** Unix seconds the decision took effect. */
  since: number;
  /** The SPLIT round it runs to, or null when there is no end. */
  untilSplit: number | null;
  eventId: string;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

const parseUntil = (raw?: string): number | null => {
  const t = (raw ?? '').trim();
  // Absent or non-positive means no end — never an expiry already passed.
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
};

/** Reached its round, so it no longer stands. An open one never lapses. */
export const hasLapsed = (untilSplit: number | null, currentSplit: number | null): boolean => {
  if (untilSplit == null) return false;
  if (currentSplit == null || !Number.isFinite(currentSplit) || currentSplit <= 0) return false;
  return currentSplit >= untilSplit;
};

async function trustedPublishers(pool: SimplePool, relays: string[]): Promise<string[]> {
  try {
    const evs = (await withTimeout(pool.querySync(relays, { kinds: [38888], limit: 5 }), 8000)) as Event[];
    evs.sort((a, b) => b.created_at - a.created_at);
    const named = JSON.parse(evs[0]?.content || '{}')?.trusted_signers?.LanaSelfResponsibility;
    return (Array.isArray(named) ? named : named ? [named] : []).map((k: string) => String(k).toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Every exclusion that still stands.
 *
 * Latest event per violation wins, so a withdrawal lifts the report it names
 * and nothing else. Fails to EMPTY rather than guessing: showing nobody as
 * excluded is a missing badge, while inventing one would put a word next to a
 * name that nobody decided.
 */
export async function listActiveExclusions(
  relays: string[],
  currentSplit: number | null,
): Promise<Exclusion[]> {
  if (!relays?.length) return [];
  const pool = new SimplePool();
  try {
    const publishers = await trustedPublishers(pool, relays);
    if (publishers.length === 0) return [];

    const evs = (await withTimeout(
      pool.querySync(relays, { kinds: [VIOLATION_KIND], limit: 300 }),
      9000,
    )) as Event[];

    const byViolation = new Map<string, Event>();
    for (const e of evs) {
      if (!publishers.includes(e.pubkey.toLowerCase())) continue;
      const d = e.tags.find((t) => t[0] === 'd')?.[1];
      if (!d) continue;
      const prev = byViolation.get(d);
      if (!prev || e.created_at > prev.created_at) byViolation.set(d, e);
    }

    const out: Exclusion[] = [];
    for (const e of byViolation.values()) {
      if (e.tags.find((t) => t[0] === 'status')?.[1] !== 'active') continue;

      const p = e.tags.find((t) => t[0] === 'p' && t[2] === 'subject')?.[1];
      if (!p) continue;

      const untilSplit = parseUntil(e.tags.find((t) => t[0] === 'until_split')?.[1]);
      if (hasLapsed(untilSplit, currentSplit)) continue;

      let reason = '';
      try {
        const c = JSON.parse(e.content || '{}');
        if (typeof c.subject === 'string') reason = c.subject.trim();
      } catch { /* an unreadable report still excludes */ }

      out.push({
        personHex: p.toLowerCase(),
        reason,
        since: Number(e.tags.find((t) => t[0] === 'effective_at')?.[1]) || e.created_at,
        untilSplit,
        eventId: e.id,
      });
    }
    return out.sort((a, b) => b.since - a.since);
  } catch {
    return [];
  } finally {
    try { pool.close(relays); } catch { /* already closed */ }
  }
}
