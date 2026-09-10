/**
 * OWN process records (KIND 37044) — reading the relays' pile of records down
 * to the one list a person should see, and deciding who may pause a process.
 *
 * Pure on purpose: the relays hand out several records for the SAME process and
 * the rules for choosing between them are where the mistakes happen, so they
 * live here where a test can hold them (scripts/testOpenProcessList.ts,
 * scripts/testFacilitatorPause.ts) instead of inside a React hook.
 */
import type { Event } from 'nostr-tools';

export interface OpenProcess {
  id: string;
  processEventId: string;
  title: string;
  status: string;
  phase: string;
  openedAt: number;
  initiator: string;
  /** The OPENING facilitator — the one who authored the record. */
  facilitator: string;
  /**
   * Every facilitator, in tag order, opening one first. A process can be
   * co-led (e.g. a human together with a being), and each co-facilitator
   * carries the same ['p',hex,'facilitator'] tag and the same standing.
   */
  facilitators: string[];
  participants: string[];
  guests: string[];
  language: string;
  topic?: string;
  /**
   * What the process was opened ABOUT, from the event's `content`. Nothing
   * read this before, so an opened process showed only its title. Kept raw
   * here; processDescription() decides what of it is worth reading.
   */
  description?: string;
  userRole?: string;
  /** Set when a facilitator has offered to hand this process over (cross-app: selfresponsible.life). */
  handoverTo?: string;
  createdAt?: number;
}

/**
 * A process is still RUNNING while it is open or paused — and only then.
 *
 * A PAUSED process is still the person's process. Filtering to 'open' only made
 * a facilitator's pause look like deletion: on 30.8.2026 the Mojca case went to
 * status 'paused' at 05:47 and the whole community saw it vanish from /own. A
 * pause is shown (amber badge), never hidden.
 *
 * Everything else has ENDED. selfresponsible.life writes two different endings
 * — 'closed' when a process runs its course and 'terminated' when a facilitator
 * stops it — so this is an allowlist, not a list of endings to remember.
 *
 * A record with NO status tag counts as running. Only an ending somebody
 * actually wrote may take a process off a person's screen; a missing tag is not
 * one, and the ordering below means the answer now rests on a single record.
 */
export const isRunningStatus = (status: string): boolean =>
  status === 'open' || status === 'paused' || status === '';

/** Parse one KIND 37044 event, resolving the reader's role in it. */
const parseRecord = (event: Event, userPubkey: string): OpenProcess => {
  const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id;
  const status = event.tags.find(t => t[0] === 'status')?.[1] || '';
  const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
  const phase = event.tags.find(t => t[0] === 'phase')?.[1] || 'opening';
  const openedAt = parseInt(event.tags.find(t => t[0] === 'opened_at')?.[1] || '0');
  const language = event.tags.find(t => t[0] === 'lang')?.[1] || 'en';
  const topic = event.tags.find(t => t[0] === 'topic')?.[1];

  // Find process event reference (root event)
  // Priority: 1) e-tag with 'process'/'root' marker, 2) d-tag (should equal KIND 87044 ID), 3) event.id
  const eTagProcessId = event.tags.find(t => t[0] === 'e' && (t[3] === 'root' || t[2] === 'process'))?.[1];
  const processEventId = eTagProcessId || dTag;

  // Extract roles - check both index 2 and 3 for compatibility.
  // Lowercase all pubkeys from tags — downstream assessment lookups
  // key on lowercased hex, and role checks must be case-insensitive.
  const initiator = (event.tags.find(t => t[0] === 'p' && (t[2] === 'initiator' || t[3] === 'initiator'))?.[1] || '').toLowerCase();
  // ALL facilitators — a co-led process has more than one, and
  // reading only the first would leave the co-facilitator with no
  // role at all, so the .filter below would hide the process from
  // the very person who leads it.
  const facilitators = event.tags.filter(t => t[0] === 'p' && (t[2] === 'facilitator' || t[3] === 'facilitator')).map(t => (t[1] || '').toLowerCase()).filter(Boolean);
  const facilitator = facilitators[0] || '';
  const participants = event.tags.filter(t => t[0] === 'p' && (t[2] === 'participant' || t[3] === 'participant')).map(t => (t[1] || '').toLowerCase());
  const guests = event.tags.filter(t => t[0] === 'p' && (t[2] === 'guest' || t[3] === 'guest')).map(t => (t[1] || '').toLowerCase());

  // Check if user is in any role. FIRST match wins, so somebody who is both
  // the initiator and a facilitator is tagged 'initiator' — which is why
  // nothing about LEADING a process may be decided from userRole alone
  // (see canPauseProcess).
  const userPk = (userPubkey || '').toLowerCase();
  let userRole: string | undefined;
  if (initiator === userPk) userRole = 'initiator';
  else if (facilitators.includes(userPk)) userRole = 'facilitator';
  else if (participants.includes(userPk)) userRole = 'participant';
  else if (guests.includes(userPk)) userRole = 'guest';

  return {
    id: dTag,
    processEventId,
    title,
    status,
    phase,
    openedAt,
    initiator,
    facilitator,
    facilitators,
    participants,
    guests,
    language,
    topic,
    description: event.content || '',
    userRole,
    handoverTo: event.tags.find(t => t[0] === 'handover_to')?.[1],
    createdAt: event.created_at,
  };
};

/**
 * Relay events → the processes this person is still in.
 *
 * ORDER MATTERS, and getting it wrong is what kept ended processes on screen:
 * the relays hold one record per author for the same `d`, so a process that has
 * changed hands has several, and only ONE of them is current. Choose that one
 * FIRST, then ask whether it is still running.
 *
 * Filtering by status first drops the authoritative record before the choice is
 * made — an ending never carries `handover_to`, so it was the first thing
 * thrown away — and leaves the choice to be made among superseded records. That
 * is how `own:6025c260…` ("Boštjan in Primož"), closed by its facilitator on
 * 6.9.2026, went on showing as an open process in phase `change` under a
 * facilitator who had handed it on a month earlier.
 */
export function toOpenProcesses(events: Event[], userPubkey: string): OpenProcess[] {
  return events
    .map((event: Event) => parseRecord(event, userPubkey))
    // A facilitator handover (selfresponsible.life) leaves TWO same-d records:
    // the outgoing facilitator's (carries handover_to) and the new one's
    // (authoritative). Order them so the authoritative + newest wins the
    // dedup below — otherwise which facilitator shows is relay-arrival luck.
    .sort((a, b) => (a.handoverTo ? 1 : 0) - (b.handoverTo ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0))
    // Deduplicate by id - keep the preferred (first after the sort above) occurrence
    .filter((process, index, self) =>
      self.findIndex(p => p.id === process.id) === index
    )
    // Only NOW: is the process that survived still running, and is this person
    // in it? Asked of the authoritative record, never of a superseded one.
    .filter(process => isRunningStatus(process.status) && process.userRole !== undefined)
    .sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * May this person pause the process?
 *
 * The facilitator LEADING a process can pause it. That is the whole rule, and
 * it was not what the page asked: it tested `userRole === 'facilitator'`, and
 * userRole is a first-match-wins chain that checks `initiator` before
 * `facilitator`. A facilitator who opened the case himself therefore came back
 * tagged 'initiator' and got no Pause button at all — only Exit, which accepts
 * 'initiator'.
 *
 * Live case: Jure Pirc leads "Sum zlorabe cashout-a Lana8Wonder iz drugih
 * računov" and is tagged BOTH initiator and facilitator on it. He could not
 * pause it, and worked around the missing button by adding Tanja Hruševar — a
 * facilitator and nothing else, so she passed the test — as co-facilitator.
 * Handing over a share of the leadership is far too high a price for a button.
 *
 * So ask the roster, not the label: every co-facilitator counts (co-leading is
 * unchanged), and nobody who is not on it — participant, initiator-only, guest
 * — gains anything.
 */
export function canPauseProcess(
  process: Pick<OpenProcess, 'facilitator' | 'facilitators'> | null | undefined,
  pubkey: string | null | undefined,
): boolean {
  const me = (pubkey || '').toLowerCase();
  if (!process || !me) return false;
  const leaders = process.facilitators?.length ? process.facilitators : [process.facilitator];
  return leaders.some(f => (f || '').toLowerCase() === me);
}

/**
 * The newest record per `d`, for the callers that only need to know whether a
 * person is in a running process (the header warning) and do not build a list.
 *
 * They read the same pile and made the same mistake in its simplest form —
 * `status === 'open'` on EVERY record, with no dedup at all — so an ended
 * process kept the warning lit through whichever of its older records still
 * said 'open'.
 */
export function newestPerProcess<T extends { id: string; tags: string[][]; created_at: number }>(
  events: T[],
): T[] {
  const byD = new Map<string, T>();
  for (const ev of events) {
    const d = ev.tags?.find(t => t[0] === 'd')?.[1] || ev.id;
    const cur = byD.get(d);
    if (!cur || ev.created_at > cur.created_at) byD.set(d, ev);
  }
  return [...byD.values()];
}
