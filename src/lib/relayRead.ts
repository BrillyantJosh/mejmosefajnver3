/**
 * One honest read across N relays — it reports WHICH relays actually answered.
 *
 * `pool.querySync` cannot tell you that. In the installed nostr-tools (2.17.0)
 * it is `new Promise(async (resolve) => …)` with no `reject` anywhere, so a
 * dead network and a genuinely empty relay both produce exactly `[]`, and a
 * caller's `catch` never runs. Worse, `subscribeMany`'s `handleClose(i)` calls
 * `handleEose(i)` first, so a relay that fails to CONNECT is counted as though
 * it had sent EOSE — with no connection at all, the whole query resolves empty
 * in milliseconds and looks like a completed, successful, empty read.
 *
 * That is why this reads each relay on its own:
 *  - `pool.ensureRelay()` rejects on ws error, ws close and connect timeout —
 *    the only genuine per-relay failure signal the library exposes.
 *  - `relay.subscribe()` fires `oneose` from a real ["EOSE"] frame, or from its
 *    own `eoseTimeout`. That timeout is set ABOVE our budget, so any `oneose`
 *    we observe in time is a real frame off the wire, never a synthesised one.
 *
 * Never rejects: a total outage returns `answered: []`, which is the point.
 */
import type { SimplePool, Event, Filter } from 'nostr-tools';

export interface RelayReadResult {
  /** Merged and deduplicated by event id across every relay that delivered. */
  events: Event[];
  /** Relays that sent a real EOSE within the budget. */
  answered: string[];
  /** Relays that rejected, closed, or ran out of budget. */
  failed: { url: string; reason: string }[];
}

export interface RelayReadOptions {
  /** Hard per-relay wall clock; relays run in parallel, each on its own timer. */
  budgetMs: number;
  /** Shared abort flag, checked before anything state-visible happens. */
  cancelled?: { value: boolean };
  /**
   * Fired once per relay as it settles, with the union so far — lets a caller
   * paint a fast relay's answer without waiting for a slow one. One call per
   * relay, so there is no per-event render storm.
   */
  onRelayDone?: (partial: RelayReadResult) => void;
}

export async function readFromRelays(
  pool: SimplePool,
  relays: string[],
  filter: Filter,
  opts: RelayReadOptions,
): Promise<RelayReadResult> {
  const byId = new Map<string, Event>();
  const answered: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  const snapshot = (): RelayReadResult => ({
    events: [...byId.values()],
    answered: [...answered],
    failed: [...failed],
  });

  const readOne = (url: string) =>
    new Promise<void>((resolve) => {
      let settled = false;
      let sub: { close: (reason?: string) => void } | null = null;

      const done = (ok: boolean, reason = '') => {
        // Closing re-enters our own onclose, and a late eoseTimeout can still
        // fire afterwards — so this latch is set before anything else.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { sub?.close(); } catch { /* socket already gone */ }
        if (ok) answered.push(url);
        else failed.push({ url, reason });
        if (!opts.cancelled?.value) opts.onRelayDone?.(snapshot());
        resolve();
      };

      // Armed before the connect, so a hung DNS or TLS handshake is bounded by
      // OUR clock. This is why no path here can hang.
      const timer = setTimeout(() => done(false, 'timeout'), opts.budgetMs);

      pool
        .ensureRelay(url, { connectionTimeout: Math.max(2000, opts.budgetMs - 500) })
        .then((relay) => {
          if (settled || opts.cancelled?.value) { done(false, 'cancelled'); return; }
          sub = relay.subscribe([filter], {
            // Above budgetMs on purpose: the library must never synthesise an
            // EOSE inside our window, or a silent relay would look answered.
            eoseTimeout: Math.min(opts.budgetMs + 5000, 20_000),
            // Cross-relay duplicates are dropped BEFORE the library parses and
            // schnorr-verifies them — with N relays serving the same events
            // this cuts verification work roughly N-fold.
            alreadyHaveEvent: (id: string) => byId.has(id),
            onevent: (e: Event) => { if (!byId.has(e.id)) byId.set(e.id, e); },
            oneose: () => done(true),
            onclose: (reason?: string) => done(false, reason || 'closed'),
          });
        })
        .catch((err: unknown) => {
          // Covers connect rejection and a malformed relay URL alike, so one
          // bad entry in KIND 38888 costs one relay rather than the whole read.
          done(false, err instanceof Error ? err.message : String(err));
        });
    });

  await Promise.all(relays.map(readOne));
  return snapshot();
}

/**
 * The same honest read, retried — for the one caller that cannot be allowed to
 * refuse over a blip: the pre-payment duplicate guard.
 *
 * A phone is not a server. iOS suspends the page while the camera sheet is up
 * (scanning a WIF is the usual reason on the confirm screen), and the sockets
 * around that moment can be gone without the page being told. One attempt then
 * reports "no relay answered" for a network that is perfectly fine a second
 * later, and a fail-closed guard turns that into a refused payment.
 *
 * Each attempt gets its OWN pool, and that is the whole point. nostr-tools does
 * not re-dial a relay it already has: `ensureRelay` hands back the cached
 * AbstractRelay and `connect()` returns immediately while `_connected` is still
 * true — so on a half-open socket the REQ goes into a black hole and every
 * retry on that pool burns its budget the same way. A fresh pool, with the old
 * one closed first, is the only way to actually get a new connection.
 *
 * Stops at the FIRST attempt that gets a real answer: one relay answering is
 * enough, exactly as for a single read. Exhausting the attempts returns the
 * last result with `answered: []` — it never throws, so the caller's
 * fail-closed check stays the only thing that decides.
 */
export interface RelayReadRetryOptions extends RelayReadOptions {
  /** Total attempts, INCLUDING the first. */
  attempts: number;
  /** Pause between attempts — room for a resumed network stack to settle. */
  pauseMs: number;
  /** Fired before each attempt with its 1-based number, for a progress line. */
  onAttempt?: (attempt: number, attempts: number) => void;
}

export async function readFromRelaysWithRetry(
  newPool: () => SimplePool,
  relays: string[],
  filter: Filter,
  opts: RelayReadRetryOptions,
): Promise<RelayReadResult> {
  const attempts = Math.max(1, opts.attempts);
  let last: RelayReadResult = { events: [], answered: [], failed: [] };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.cancelled?.value) return last;
    opts.onAttempt?.(attempt, attempts);

    const pool = newPool();
    try {
      last = await readFromRelays(pool, relays, filter, opts);
    } finally {
      // Torn down before the next attempt: a retry that reuses the sockets it
      // just failed on is not a retry.
      try { pool.close(relays); } catch { /* sockets already gone */ }
    }

    if (last.answered.length > 0) return last;
    if (attempt < attempts && !opts.cancelled?.value) {
      await new Promise<void>((r) => setTimeout(r, opts.pauseMs));
    }
  }

  return last;
}
