import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';

/**
 * Reading a long list off the relays without the phone doing the collecting.
 *
 * A browser that subscribes to the relays itself receives the events one
 * WebSocket message at a time, checks each signature and hands each one on —
 * and nostr-tools gives that subscription 4.4 seconds before it decides, on
 * its own, that the relay has sent everything, closes the subscription and
 * DISCARDS every message still waiting in its queue. A laptop drains the queue
 * inside that window; a phone does not. The same Eco Point catalogue showed
 * 140 offers on a desktop and 20, 35 or 73 on an iPhone, a different number on
 * every load (Brilly, 21. 9. 2026).
 *
 * So the app's own server collects instead: one HTTPS request per kind group,
 * one JSON answer, nothing for the phone to keep up with. The server reads the
 * same relays over its own pooled sockets, merges them and keeps the newest of
 * each replaceable event. Signatures are still checked here, on what arrives —
 * about 0.7 s for 280 events — so the server is not trusted for more than
 * delivering the post.
 *
 * Where a caller must know WHICH relays answered (money decisions), this is
 * not the tool: use readFromRelays in ./relayRead.ts, which says.
 */

/** Same origin in the app; the test scripts import this file outside Vite. */
const apiBase = (): string => import.meta.env?.VITE_API_URL ?? '';

/** What paging needs of an event. */
export interface PagedEvent {
  id: string;
  created_at: number;
}

/** strfry's max_limit, which this app's endpoint enforces as well. */
export const RELAY_PAGE_SIZE = 500;

export interface PagedRead<E> {
  events: E[];
  /** False when the read stopped at the page cap: this is a newest-first prefix, not everything. */
  complete: boolean;
  pages: number;
  /** Events thrown away because the signature did not check out. */
  forged: number;
}

/**
 * Every event a filter matches, page by page, newest first.
 *
 * `fetchPage(until)` asks for one page ending at `until` (created_at seconds,
 * inclusive). A short page is the end. Hitting `maxPages` says so through
 * `complete: false` instead of quietly returning half a catalogue. Pages
 * overlap on the second they are cut at, so events are deduplicated by id.
 */
export async function readAllPages<E extends PagedEvent>(
  fetchPage: (until?: number) => Promise<E[]>,
  { pageSize = RELAY_PAGE_SIZE, maxPages = 6 }: { pageSize?: number; maxPages?: number } = {},
): Promise<Omit<PagedRead<E>, 'forged'>> {
  const byId = new Map<string, E>();
  let until: number | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await fetchPage(until);
    pages++;
    const usable = Array.isArray(page) ? page.filter((e) => e && typeof e.id === 'string' && typeof e.created_at === 'number') : [];
    for (const event of usable) if (!byId.has(event.id)) byId.set(event.id, event);

    if (usable.length < pageSize) return { events: [...byId.values()], complete: true, pages };

    const oldest = usable.reduce((min, e) => (e.created_at < min ? e.created_at : min), usable[0].created_at);
    // A full page written within one second cannot be paged past — asking
    // again would fetch the same page for ever.
    if (until !== undefined && oldest >= until) return { events: [...byId.values()], complete: false, pages };
    until = oldest;
  }

  return { events: [...byId.values()], complete: false, pages };
}

/** One page from this app's server, which reads the relays named in KIND 38888. */
export async function fetchRelayPage<E extends PagedEvent>(
  filter: Record<string, unknown>,
  { timeout = 15000, signal }: { timeout?: number; signal?: AbortSignal } = {},
): Promise<E[]> {
  const res = await fetch(`${apiBase()}/api/functions/query-nostr-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, timeout }),
    signal,
  });
  if (!res.ok) throw new Error(`Relay read failed (${res.status})`);
  const body = await res.json();
  return Array.isArray(body?.events) ? (body.events as E[]) : [];
}

export interface RelayReadViaServerOptions {
  timeout?: number;
  signal?: AbortSignal;
  pageSize?: number;
  maxPages?: number;
  /** Off only where a test supplies its own events; a real read always checks. */
  verify?: boolean;
}

/** Everything the filter matches, read through this app's server, signatures checked. */
export async function readRelayEventsViaServer<E extends PagedEvent>(
  filter: Record<string, unknown>,
  { timeout, signal, verify = true, ...paging }: RelayReadViaServerOptions = {},
): Promise<PagedRead<E>> {
  // A caller's `limit` is a number they meant, in both directions.
  //
  // `limit: 50` means fifty, in one page — not five hundred because that is
  // what a page holds, and not "page through everything fifty at a time". A
  // read moved onto this path must not fetch more than pool.querySync did.
  // `limit: 1000` means a thousand, so it is read as two pages of five hundred
  // rather than the six the default allows: a phone asked for a thousand
  // should not be handed three. Only a caller who names no limit at all is
  // asking for everything the filter matches.
  const asked = Number((filter as { limit?: unknown }).limit);
  const bounded = Number.isFinite(asked) && asked > 0;
  const pageSize = paging.pageSize ?? Math.min(bounded ? asked : RELAY_PAGE_SIZE, RELAY_PAGE_SIZE);
  const maxPages = paging.maxPages ?? (bounded ? Math.ceil(asked / pageSize) : undefined);
  const read = await readAllPages<E>(
    (until) =>
      fetchRelayPage<E>({ ...filter, limit: pageSize, ...(until === undefined ? {} : { until }) }, { timeout, signal }),
    { ...paging, pageSize, ...(maxPages === undefined ? {} : { maxPages }) },
  );
  // `complete` means "everything the filter asked for". A read that stopped
  // because it had delivered the caller's own limit is complete, so a
  // `limit: 1` lookup does not warn about a list cut short and bury the reads
  // that really were cut short.
  if (bounded && read.events.length >= Math.min(asked, maxPages! * pageSize)) read.complete = true;
  if (!verify) return { ...read, forged: 0 };

  const genuine = read.events.filter((event) => {
    try {
      return verifyEvent(event as never);
    } catch {
      return false;
    }
  });
  return { ...read, events: genuine, forged: read.events.length - genuine.length };
}

/**
 * The two drop-ins the sweep uses in place of `pool.querySync` / `pool.get`.
 *
 * They exist so that replacing a client-side read is a one-line change at the
 * call site: same shape in, same shape out. What they add over the raw
 * `readRelayEventsViaServer` is that a read which did NOT return everything
 * says so in the console instead of returning a plausible-looking short list —
 * the failure mode this whole change is about.
 *
 * `label` is what that line names, so a truncated list can be traced back to
 * the screen it feeds without a stack trace.
 */
export interface ServerReadOptions extends RelayReadViaServerOptions {
  label?: string;
}

/** Same in and out as `pool.querySync(relays, filter)`, read through our server. */
export async function queryEventsViaServer<E extends PagedEvent = NostrEvent>(
  filter: Record<string, unknown>,
  { label, ...opts }: ServerReadOptions = {},
): Promise<E[]> {
  const read = await readRelayEventsViaServer<E>(filter, opts);
  const what = label ?? `kinds ${JSON.stringify((filter as { kinds?: unknown }).kinds ?? '?')}`;
  if (!read.complete) {
    console.warn(
      `📄 ${what}: stopped at the page cap after ${read.pages} pages (${read.events.length} events) — this list is the newest part, not all of it.`,
    );
  }
  if (read.forged > 0) {
    console.warn(`🚫 ${what}: ${read.forged} event(s) dropped, the signature did not check out.`);
  }
  return read.events;
}

/**
 * Same in and out as `pool.get(relays, filter)`: the newest single match, or
 * null. `pool.get` takes whichever relay answered first; this takes the newest
 * across all of them, which is what every caller here actually meant.
 */
export async function getEventViaServer<E extends PagedEvent = NostrEvent>(
  filter: Record<string, unknown>,
  opts: ServerReadOptions = {},
): Promise<E | null> {
  const events = await queryEventsViaServer<E>(filter, { maxPages: 1, ...opts });
  if (events.length === 0) return null;
  return events.reduce((newest, e) => (e.created_at > newest.created_at ? e : newest));
}
