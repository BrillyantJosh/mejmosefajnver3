/**
 * The relay connection pool, against a fake relay we fully control.
 *   npx tsx scripts/testRelayPool.ts
 *
 * A pooled socket is shared, so the failures that matter are the ones that
 * could hurt OTHER callers: one query timing out, one relay dropping, one
 * subscription being refused. Those cannot be provoked against the live
 * relays, so the relay here is ours.
 */
import { WebSocketServer } from 'ws';
import { poolQuery, closeRelayPool, relayPoolStats } from '../server/lib/relayPool.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fake {
  url: string;
  connections: number;
  reqs: { subId: string; filter: any }[];
  close: () => Promise<void>;
  drop: () => void;
  server: WebSocketServer;
}

/** A relay that answers REQ with `events` then EOSE, after `delayMs`. */
function fakeRelay(opts: { events?: any[]; delayMs?: number; silent?: boolean; closeWith?: string } = {}): Promise<Fake> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = (wss.address() as any).port;
      const state: Fake = {
        url: `ws://127.0.0.1:${port}`,
        connections: 0,
        reqs: [],
        server: wss,
        drop: () => { for (const c of wss.clients) c.terminate(); },
        close: () => new Promise((r) => wss.close(() => r())),
      };
      wss.on('connection', (ws) => {
        state.connections++;
        ws.on('message', async (raw) => {
          const m = JSON.parse(raw.toString());
          if (m[0] !== 'REQ') return;
          state.reqs.push({ subId: m[1], filter: m[2] });
          if (opts.silent) return;                       // never answers
          await sleep(opts.delayMs || 5);
          if (ws.readyState !== ws.OPEN) return;
          if (opts.closeWith) { ws.send(JSON.stringify(['CLOSED', m[1], opts.closeWith])); return; }
          for (const e of opts.events || []) ws.send(JSON.stringify(['EVENT', m[1], e]));
          ws.send(JSON.stringify(['EOSE', m[1]]));
        });
      });
      resolve(state);
    });
  });
}

const ev = (id: string) => ({ id, kind: 1, content: id, tags: [], pubkey: 'x', created_at: 1, sig: 's' });

async function main() {
  console.log('— one socket, however many queries —');
  {
    const r = await fakeRelay({ events: [ev('a')] });
    for (let i = 0; i < 10; i++) await poolQuery(r.url, { kinds: [i] }, 3000);
    check('10 sequential queries reused ONE connection', r.connections === 1, r.connections);
    check('each got its answer', r.reqs.length === 10, r.reqs.length);
    closeRelayPool(); await r.close();
  }

  console.log('— identical concurrent filters become ONE subscription —');
  {
    const r = await fakeRelay({ events: [ev('a'), ev('b')], delayMs: 120 });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => poolQuery(r.url, { kinds: [30889], limit: 5 }, 3000))
    );
    check('50 callers, 1 REQ sent to the relay', r.reqs.length === 1, r.reqs.length);
    check('all 50 answered', results.every((x) => x.ok), results.filter((x) => !x.ok).length);
    check('all 50 got the same 2 events', results.every((x) => x.events.length === 2));
    check('and they are real copies, not a shared array',
      results[0].events !== results[1].events);
    closeRelayPool(); await r.close();
  }

  console.log('— different filters do NOT share —');
  {
    const r = await fakeRelay({ events: [ev('a')] });
    await Promise.all([
      poolQuery(r.url, { kinds: [1] }, 3000),
      poolQuery(r.url, { kinds: [2] }, 3000),
      poolQuery(r.url, { kinds: [1] }, 3000),
    ]);
    check('two distinct filters → two REQs', r.reqs.length === 2, r.reqs.map((x) => x.filter));
    check('still one socket', r.connections === 1, r.connections);
    closeRelayPool(); await r.close();
  }

  console.log('— one caller timing out must not harm the others —');
  {
    // Answers after 400ms. One caller waits 100ms (gives up), another waits 3s.
    const r = await fakeRelay({ events: [ev('a')], delayMs: 400 });
    const [impatient, patient] = await Promise.all([
      poolQuery(r.url, { kinds: [7] }, 100),
      poolQuery(r.url, { kinds: [7] }, 3000),
    ]);
    check('the impatient caller fails', !impatient.ok && impatient.reason === 'timeout', impatient);
    check('the patient caller still gets its answer', patient.ok && patient.events.length === 1, patient);
    check('the shared socket survived', r.connections === 1, r.connections);
    closeRelayPool(); await r.close();
  }

  console.log('— a timeout with nobody left closes the subscription —');
  {
    const r = await fakeRelay({ silent: true });
    const res = await poolQuery(r.url, { kinds: [9] }, 120);
    check('reported as a timeout, not as empty-and-fine', !res.ok && res.reason === 'timeout', res);
    check('no events invented', res.events.length === 0);
    const stats = relayPoolStats();
    check('nothing left in flight', stats[0]?.inFlight === 0, stats);
    closeRelayPool(); await r.close();
  }

  console.log('— a relay that drops fails every rider, and says so —');
  {
    const r = await fakeRelay({ silent: true });
    const pending = Promise.all([
      poolQuery(r.url, { kinds: [1] }, 5000),
      poolQuery(r.url, { kinds: [2] }, 5000),
      poolQuery(r.url, { kinds: [3] }, 5000),
    ]);
    await sleep(150);
    r.drop();
    const out = await pending;
    check('all three failed', out.every((x) => !x.ok), out);
    check('none reported an all-clear', out.every((x) => x.events.length === 0));
    check('reason names the drop', out.every((x) => /clos|error/i.test(x.reason)), out.map((x) => x.reason));
    closeRelayPool(); await r.close();
  }

  console.log('— a refused subscription is a failure, not an empty result —');
  {
    const r = await fakeRelay({ closeWith: 'rate-limited: slow down' });
    const res = await poolQuery(r.url, { kinds: [1] }, 3000);
    check('not ok', !res.ok, res);
    check('carries the relay reason', /rate-limited/.test(res.reason), res.reason);
    closeRelayPool(); await r.close();
  }

  console.log('— an unreachable relay fails fast and does not hang —');
  {
    const t0 = Date.now();
    const res = await poolQuery('ws://127.0.0.1:9', { kinds: [1] }, 3000);
    check('reported as a failure', !res.ok, res);
    check('no events', res.events.length === 0);
    check('returned quickly', Date.now() - t0 < 9000, Date.now() - t0);
    closeRelayPool();
  }

  console.log('— it reconnects after the relay comes back —');
  {
    const r = await fakeRelay({ events: [ev('a')] });
    const first = await poolQuery(r.url, { kinds: [1] }, 3000);
    check('first query fine', first.ok);
    r.drop();
    await sleep(700);                                  // past the first backoff step
    const second = await poolQuery(r.url, { kinds: [1] }, 3000);
    check('a later query reconnects and succeeds', second.ok, second);
    check('the relay saw a second connection', r.connections === 2, r.connections);
    closeRelayPool(); await r.close();
  }

  console.log('— at the subscription cap, callers WAIT; they are never refused —');
  {
    // The cap is what an earlier draft refused at. Refusing made `answered`
    // empty, which the payment path reads as an unverifiable relay and fails
    // closed — an outage produced by our own throttle. Run with the cap at 3.
    const r = await fakeRelay({ events: [ev('a')], delayMs: 250 });
    const out = await Promise.all(
      Array.from({ length: 12 }, (_, i) => poolQuery(r.url, { kinds: [100 + i] }, 8000))
    );
    check('all 12 answered despite a cap of 3', out.every((x) => x.ok), out.filter((x) => !x.ok));
    check('nobody was refused for hitting the limit',
      !out.some((x) => /limit/i.test(x.reason)), out.map((x) => x.reason).filter(Boolean));
    check('every one got its event', out.every((x) => x.events.length === 1));
    check('the relay saw all 12 REQs, just not at once', r.reqs.length === 12, r.reqs.length);
    check('still one socket', r.connections === 1, r.connections);
    closeRelayPool(); await r.close();
  }

  console.log('— a caller that runs out of time while queued says TIMEOUT, not "refused" —');
  {
    const r = await fakeRelay({ silent: true });                 // nothing ever completes
    const holders = [
      poolQuery(r.url, { kinds: [1] }, 5000),
      poolQuery(r.url, { kinds: [2] }, 5000),
      poolQuery(r.url, { kinds: [3] }, 5000),
    ];
    await sleep(60);
    const queued = await poolQuery(r.url, { kinds: [4] }, 250);  // must wait, then give up
    check('reported as a timeout', !queued.ok && queued.reason === 'timeout', queued);
    check('no events invented', queued.events.length === 0);
    check('and it never claims the relay answered', queued.ok === false);
    r.drop(); await Promise.all(holders);
    closeRelayPool(); await r.close();
  }

  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}

main();
