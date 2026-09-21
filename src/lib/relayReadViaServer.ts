import { verifyEvent } from 'nostr-tools';

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
  const pageSize = paging.pageSize ?? RELAY_PAGE_SIZE;
  const read = await readAllPages<E>(
    (until) =>
      fetchRelayPage<E>({ ...filter, limit: pageSize, ...(until === undefined ? {} : { until }) }, { timeout, signal }),
    { ...paging, pageSize },
  );
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
