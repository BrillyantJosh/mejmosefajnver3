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
