import WebSocket from 'ws';

/**
 * One persistent WebSocket per relay, shared by every request.
 *
 * Before this, each relay query opened its own socket and closed it again.
 * Measured against the live relays: the handshake alone costs 255ms
 * (relay.lanavault.space) and 364ms (relay.lanacoin-eternity.com), while the
 * same query over an already-open socket takes 52ms and 129ms. So roughly
 * three quarters of every relay call was TLS setup, paid again and again.
 *
 * The socket count mattered even more than the latency. `/fetch-user-wallets`
 * issues three filters against two relays — six fresh handshakes for ONE
 * request. At a thousand concurrent users that is six thousand handshakes
 * against two relays we own, from a single Node process on a four-core box
 * shared with 43 other containers.
 *
 * Two mechanisms:
 *   1. POOLING — subscriptions are multiplexed over one long-lived socket per
 *      relay, so the handshake is paid once and sockets stay at two.
 *   2. SINGLE-FLIGHT — identical filters already in flight to the same relay
 *      attach to the running subscription instead of issuing another REQ. A
 *      thousand users opening the same page produce one query, not a thousand.
 *
 * Single-flight is safe precisely because it is concurrent-only: everyone who
 * attaches would have asked the same relay the same question at the same
 * moment. Nothing is remembered between requests, so no reader is ever handed
 * a stale answer — that would be a different mechanism, and a money-bearing
 * read must not have one added quietly.
 *
 * Failure semantics are unchanged from the per-socket implementation, and that
 * is deliberate: callers already treat a silent relay as unverified rather than
 * as an all-clear. A subscription that reaches EOSE is answered; a timeout, a
 * socket error, or a close before EOSE is a failure that reports what it
 * managed to collect.
 */

export interface PoolQueryResult {
  events: any[];
  ok: boolean;
  reason: string;
}

/** A relay that keeps failing is retried, but not on every single request. */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];
/**
 * Both relays are strfry and declare `max_subscriptions: 200` over NIP-11
 * (checked, not assumed). 160 leaves headroom.
 *
 * The number matters less than what happens AT it. An earlier draft of this
 * file REFUSED past the cap, which looks conservative and is the opposite: a
 * refusal leaves `answered` empty, callers read that as an unverifiable relay,
 * and the unconditional-payment path fails closed — a payments outage caused by
 * our own throttle rather than by anything upstream. So a caller at the cap now
 * WAITS for a slot, bounded by the timeout it already asked for. If it runs
 * out it reports a timeout: true, and indistinguishable from any other slow
 * relay, instead of inventing a verdict.
 */
const MAX_INFLIGHT_PER_RELAY = Number(process.env.RELAY_MAX_SUBSCRIPTIONS || 160);
const CONNECT_TIMEOUT_MS = 8_000;

interface Waiter {
  resolve: (r: PoolQueryResult) => void;
  events: any[];
  timer: NodeJS.Timeout;
}

interface Subscription {
  subId: string;
  filterKey: string;
  events: any[];
  waiters: Waiter[];
}

interface Queued {
  start: () => void;
  cancel: () => void;
}

interface RelayConn {
  url: string;
  ws: WebSocket | null;
  connecting: Promise<WebSocket | null> | null;
  subs: Map<string, Subscription>;      // subId -> subscription
  byFilter: Map<string, Subscription>;  // filterKey -> subscription (single-flight)
  queue: Queued[];                      // callers waiting for a subscription slot
  failures: number;
  nextAttemptAt: number;
}

const conns = new Map<string, RelayConn>();
let subCounter = 0;

function connFor(url: string): RelayConn {
  let c = conns.get(url);
  if (!c) {
    c = { url, ws: null, connecting: null, subs: new Map(), byFilter: new Map(), queue: [], failures: 0, nextAttemptAt: 0 };
    conns.set(url, c);
  }
  return c;
}

/** A slot came free — hand it to whoever has been waiting longest. */
function drainQueue(c: RelayConn) {
  while (c.queue.length > 0 && c.subs.size < MAX_INFLIGHT_PER_RELAY) {
    c.queue.shift()?.start();
  }
}

/** Fail every subscription riding this socket — the answer is unknown, not empty. */
function failAll(c: RelayConn, reason: string) {
  for (const sub of c.subs.values()) {
    for (const w of sub.waiters) {
      clearTimeout(w.timer);
      w.resolve({ events: sub.events.slice(), ok: false, reason });
    }
  }
  c.subs.clear();
  c.byFilter.clear();
  for (const q of c.queue.splice(0)) q.cancel();   // queued callers are in the same position
}

function connect(c: RelayConn): Promise<WebSocket | null> {
  if (c.ws && c.ws.readyState === WebSocket.OPEN) return Promise.resolve(c.ws);
  if (c.connecting) return c.connecting;
  if (Date.now() < c.nextAttemptAt) return Promise.resolve(null);

  c.connecting = new Promise<WebSocket | null>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(c.url);
    } catch {
      c.failures++;
      c.nextAttemptAt = Date.now() + RECONNECT_BACKOFF_MS[Math.min(c.failures - 1, RECONNECT_BACKOFF_MS.length - 1)];
      c.connecting = null;
      resolve(null);
      return;
    }

    const giveUp = setTimeout(() => {
      try { ws.close(); } catch { /* already gone */ }
      c.failures++;
      c.nextAttemptAt = Date.now() + RECONNECT_BACKOFF_MS[Math.min(c.failures - 1, RECONNECT_BACKOFF_MS.length - 1)];
      c.ws = null;
      c.connecting = null;
      resolve(null);
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(giveUp);
      c.ws = ws;
      c.failures = 0;
      c.nextAttemptAt = 0;
      c.connecting = null;
      resolve(ws);
    });

    ws.on('message', (data: Buffer) => {
      let m: any;
      try { m = JSON.parse(data.toString()); } catch { return; }
      const kind = m[0];
      if (kind !== 'EVENT' && kind !== 'EOSE' && kind !== 'CLOSED') return;

      const sub = c.subs.get(m[1]);
      if (!sub) return;

      if (kind === 'EVENT') {
        sub.events.push(m[2]);
        return;
      }

      // EOSE: the relay has sent everything it stored. CLOSED: it refused.
      const ok = kind === 'EOSE';
      const reason = ok ? '' : (typeof m[2] === 'string' ? m[2] : 'closed by relay');
      c.subs.delete(sub.subId);
      c.byFilter.delete(sub.filterKey);
      if (ok) { try { ws.send(JSON.stringify(['CLOSE', sub.subId])); } catch { /* socket gone */ } }
      for (const w of sub.waiters) {
        clearTimeout(w.timer);
        w.resolve({ events: sub.events.slice(), ok, reason });
      }
      drainQueue(c);
    });

    const drop = (reason: string) => {
      clearTimeout(giveUp);
      if (c.ws === ws) c.ws = null;
      c.connecting = null;
      failAll(c, reason);
      resolve(null);
    };
    ws.on('error', (e: any) => drop(e?.message || 'socket error'));
    ws.on('close', () => drop('closed before EOSE'));
  });

  return c.connecting;
}

/**
 * Ask one relay for one filter. Resolves with what was collected and whether
 * the relay actually finished answering.
 */
export async function poolQuery(
  relayUrl: string,
  filter: Record<string, any>,
  timeoutMs: number
): Promise<PoolQueryResult> {
  const c = connFor(relayUrl);
  const ws = await connect(c);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { events: [], ok: false, reason: 'connect failed' };
  }

  const filterKey = JSON.stringify(filter);

  return new Promise<PoolQueryResult>((resolve) => {
    const attach = (sub: Subscription) => {
      const waiter: Waiter = {
        resolve,
        events: sub.events,
        timer: setTimeout(() => {
          // Only this caller gives up. The socket is shared, so it is never
          // closed here — that would abort everyone else's subscriptions.
          sub.waiters = sub.waiters.filter((w) => w !== waiter);
          if (sub.waiters.length === 0) {
            c.subs.delete(sub.subId);
            c.byFilter.delete(sub.filterKey);
            try { ws.send(JSON.stringify(['CLOSE', sub.subId])); } catch { /* socket gone */ }
            drainQueue(c);
          }
          resolve({ events: sub.events.slice(), ok: false, reason: 'timeout' });
        }, timeoutMs),
      };
      sub.waiters.push(waiter);
    };

    // Single-flight: an identical filter already in flight answers this too.
    const running = c.byFilter.get(filterKey);
    if (running) { attach(running); return; }

    const begin = () => {
      const subId = `q${++subCounter}`;
      const sub: Subscription = { subId, filterKey, events: [], waiters: [] };
      c.subs.set(subId, sub);
      c.byFilter.set(filterKey, sub);
      attach(sub);

      try {
        ws.send(JSON.stringify(['REQ', subId, filter]));
      } catch (e: any) {
        c.subs.delete(subId);
        c.byFilter.delete(filterKey);
        for (const w of sub.waiters) clearTimeout(w.timer);
        resolve({ events: [], ok: false, reason: e?.message || 'send failed' });
        drainQueue(c);
      }
    };

    if (c.subs.size >= MAX_INFLIGHT_PER_RELAY) {
      // Wait for a slot rather than refuse. The caller's own timeout still
      // governs the total wait, so a queue that never drains reports a
      // timeout — never a false "this relay had nothing to say".
      let entry: Queued;
      const waitTimer = setTimeout(() => {
        c.queue = c.queue.filter((q) => q !== entry);
        resolve({ events: [], ok: false, reason: 'timeout' });
      }, timeoutMs);
      entry = {
        start: () => { clearTimeout(waitTimer); begin(); },
        cancel: () => { clearTimeout(waitTimer); resolve({ events: [], ok: false, reason: 'closed before EOSE' }); },
      };
      c.queue.push(entry);
      return;
    }

    begin();
  });
}

/** For tests and shutdown. */
export function closeRelayPool(): void {
  for (const c of conns.values()) {
    failAll(c, 'pool closed');
    try { c.ws?.close(); } catch { /* already gone */ }
    c.ws = null;
  }
  conns.clear();
}

/** For diagnostics: what the pool is holding right now. */
export function relayPoolStats() {
  return [...conns.values()].map((c) => ({
    url: c.url,
    open: c.ws?.readyState === WebSocket.OPEN,
    inFlight: c.subs.size,
    waiters: [...c.subs.values()].reduce((n, s) => n + s.waiters.length, 0),
    failures: c.failures,
  }));
}
