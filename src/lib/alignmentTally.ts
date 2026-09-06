/**
 * Counting the votes on an alignment proposal.
 *
 * A vote is a KIND 38884 event:
 *   d       ack:<proposal slug>:<voter hex>
 *   ack     yes | resistance
 *   e       the proposal event it was cast against
 *   content the voter's own words, optional
 *
 * Two things about the shape of that data decide this whole file.
 *
 * The `e` tag is NOT the way to gather a proposal's votes. KIND 38883 is
 * parameterized-replaceable: every edit of a proposal is a NEW event id, while
 * the slug in the `d` tag stays. Four of the ten live proposals already carry
 * votes cast against ids that no longer exist — "Balanced Exchange Framework"
 * has votes pointing at four different versions. Counting by the current id
 * would have thrown those people's votes away. So the slug in the `d` tag is
 * what gathers them.
 *
 * The voter is the event's SIGNATURE, never the hex written inside the `d`
 * tag. Anyone can write any pubkey into a tag; only the author can sign. Both
 * are read here, and where they disagree the signature wins — which is also
 * what makes one-person-one-vote hold: a stuffer publishing a hundred events
 * under invented d tags still collapses to one vote, their own.
 */

export type AckChoice = 'yes' | 'resistance';

export interface AckEvent {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
}

export interface AlignmentVote {
  id: string;
  /** The signer. This is who voted. */
  pubkey: string;
  createdAt: number;
  choice: AckChoice;
  /** What the voter wrote alongside the vote, may be empty. */
  comment: string;
}

export type AlignmentOutcome = 'aligned' | 'resisted' | 'no_votes';

export interface AlignmentTally {
  slug: string;
  accepted: AlignmentVote[];
  resisted: AlignmentVote[];
  /** People who voted — one each, however many times they changed their mind. */
  total: number;
  outcome: AlignmentOutcome;
}

/** `awareness:alignment-x` and `alignment-x` both mean the same proposal. */
export function proposalSlug(dTag: string | null | undefined): string {
  const value = (dTag || '').trim();
  return value.startsWith('awareness:') ? value.slice('awareness:'.length) : value;
}

/** The slug a vote belongs to: `ack:<slug>:<voter hex>` → `<slug>`. */
export function slugFromAckDTag(dTag: string | null | undefined): string | null {
  const parts = (dTag || '').split(':');
  if (parts[0] !== 'ack') return null;
  // Last part is the voter's claimed hex, which this file does not trust; a
  // two-part tag has no hex at all, and the slug is still readable.
  const slug = parts.length >= 3 ? parts.slice(1, -1).join(':') : parts[1] || '';
  return slug ? slug : null;
}

function tagValue(tags: string[][], name: string): string {
  const tag = tags.find((t) => t[0] === name);
  return tag && typeof tag[1] === 'string' ? tag[1] : '';
}

export interface ParsedAck extends AlignmentVote {
  slug: string;
}

/**
 * One vote, or null. Null for anything that is not clearly a vote — an unknown
 * `ack` value is dropped rather than read as consent.
 */
export function parseAck(event: AckEvent): ParsedAck | null {
  if (!event || typeof event.pubkey !== 'string' || !event.pubkey) return null;
  const slug = slugFromAckDTag(tagValue(event.tags || [], 'd'));
  if (!slug) return null;
  const raw = tagValue(event.tags || [], 'ack');
  if (raw !== 'yes' && raw !== 'resistance') return null;
  return {
    slug,
    id: event.id,
    pubkey: event.pubkey,
    createdAt: Number(event.created_at) || 0,
    choice: raw,
    comment: typeof event.content === 'string' ? event.content.trim() : '',
  };
}

/** Newer wins; equal timestamps fall back to the id so the result is stable. */
function laterOf(a: ParsedAck, b: ParsedAck): ParsedAck {
  if (b.createdAt !== a.createdAt) return b.createdAt > a.createdAt ? b : a;
  return b.id > a.id ? b : a;
}

export function outcomeOf(accepted: number, resisted: number): AlignmentOutcome {
  if (resisted > 0) return 'resisted';
  if (accepted > 0) return 'aligned';
  return 'no_votes';
}

/**
 * All votes, grouped by proposal slug — one vote per person per proposal.
 */
export function tallyAcks(events: AckEvent[]): Map<string, AlignmentTally> {
  const latest = new Map<string, Map<string, ParsedAck>>(); // slug → pubkey → vote

  for (const event of events || []) {
    const vote = parseAck(event);
    if (!vote) continue;
    let perSlug = latest.get(vote.slug);
    if (!perSlug) {
      perSlug = new Map<string, ParsedAck>();
      latest.set(vote.slug, perSlug);
    }
    const existing = perSlug.get(vote.pubkey);
    perSlug.set(vote.pubkey, existing ? laterOf(existing, vote) : vote);
  }

  const tallies = new Map<string, AlignmentTally>();
  for (const [slug, perPubkey] of latest) {
    const accepted: AlignmentVote[] = [];
    const resisted: AlignmentVote[] = [];
    for (const vote of perPubkey.values()) {
      (vote.choice === 'yes' ? accepted : resisted).push(vote);
    }
    const byNewest = (a: AlignmentVote, b: AlignmentVote) => b.createdAt - a.createdAt;
    accepted.sort(byNewest);
    resisted.sort(byNewest);
    tallies.set(slug, {
      slug,
      accepted,
      resisted,
      total: accepted.length + resisted.length,
      outcome: outcomeOf(accepted.length, resisted.length),
    });
  }
  return tallies;
}

export const EMPTY_TALLY: AlignmentTally = {
  slug: '',
  accepted: [],
  resisted: [],
  total: 0,
  outcome: 'no_votes',
};
