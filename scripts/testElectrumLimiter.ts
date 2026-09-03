/**
 * Bounding outbound Electrum connections, against a fake server we control.
 *   npx tsx scripts/testElectrumLimiter.ts
 *
 * Every call here opens a fresh TCP socket, so a burst of callers is a burst of
 * connections — that is what produced five simultaneous "All Electrum servers
 * failed" eighty-two seconds after a deploy while the servers were fine.
 *
 * The two things that must NOT change: a broadcast is a write and must never
 * wait behind reads, and only the chain tip may be answered once for everyone.
 */
import net from 'node:net';
import { electrumCall, fetchBatchBalances, electrumStats } from '../server/lib/electrum.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fake {
  port: number;
  opened: number;
  concurrent: number;
  peakConcurrent: number;
  calls: string[];
  close: () => Promise<void>;
}

function fakeElectrum(delayMs = 60): Promise<Fake> {
  return new Promise((resolve) => {
    const state: any = { opened: 0, concurrent: 0, peakConcurrent: 0, calls: [] };
    const srv = net.createServer((sock) => {
      state.opened++;
      state.concurrent++;
      state.peakConcurrent = Math.max(state.peakConcurrent, state.concurrent);
      sock.on('close', () => { state.concurrent--; });
      sock.on('error', () => {});
      let buf = '';
      sock.on('data', async (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          state.calls.push(req.method);
          await sleep(delayMs);
          if (!sock.destroyed) sock.write(JSON.stringify({ id: req.id, result: { ok: req.method } }) + '\n');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      state.port = (srv.address() as any).port;
      state.close = () => new Promise<void>((r) => srv.close(() => r()));
      resolve(state as Fake);
    });
  });
}

async function main() {
  console.log('— concurrent connections are bounded —');
  {
    const f = await fakeElectrum(80);
    const servers = [{ host: '127.0.0.1', port: f.port }];
    // 30 address reads at once; the limiter is 8 unless the env says otherwise.
    const cap = Number(process.env.ELECTRUM_MAX_CONCURRENT || 8);
    // Sample what the limiter itself is holding — that is the thing under test.
    let peakHeld = 0;
    const sampler = setInterval(() => { peakHeld = Math.max(peakHeld, electrumStats().active); }, 5);
    await Promise.all(Array.from({ length: 30 }, (_, i) =>
      electrumCall('blockchain.address.listunspent', [`addr${i}`], servers, 20000)));
    clearInterval(sampler);
    check(`the limiter never held more than ${cap}`, peakHeld <= cap, peakHeld);
    // The server's own count may read one higher: a slot is released when the
    // socket is destroyed, but the peer sees `close` a tick later, so the next
    // connection can arrive before the previous one is counted out.
    check(`server saw at most ${cap + 1} at once`, f.peakConcurrent <= cap + 1, f.peakConcurrent);
    check('all 30 still completed', f.calls.length === 30, f.calls.length);
    check('nothing left holding a slot', electrumStats().active === 0, electrumStats());
    await f.close();
  }

  console.log('— address reads are NEVER coalesced —');
  {
    const f = await fakeElectrum(40);
    const servers = [{ host: '127.0.0.1', port: f.port }];
    await Promise.all([
      electrumCall('blockchain.address.listunspent', ['same'], servers, 20000),
      electrumCall('blockchain.address.listunspent', ['same'], servers, 20000),
      electrumCall('blockchain.address.listunspent', ['same'], servers, 20000),
    ]);
    check('three identical address reads = three calls', f.calls.length === 3, f.calls.length);
    await f.close();
  }

  console.log('— the chain tip IS answered once for everyone —');
  {
    const f = await fakeElectrum(120);
    const servers = [{ host: '127.0.0.1', port: f.port }];
    const out = await Promise.all(Array.from({ length: 25 }, () =>
      electrumCall('blockchain.headers.subscribe', [], servers, 20000)));
    check('25 callers, 1 call to the server', f.calls.length === 1, f.calls.length);
    check('all 25 got the answer', out.every((r) => r?.ok === 'blockchain.headers.subscribe'));
    check('and only one connection was opened', f.opened === 1, f.opened);
    await f.close();
  }

  console.log('— a broadcast never waits behind reads —');
  {
    const f = await fakeElectrum(300);                 // slow reads
    const servers = [{ host: '127.0.0.1', port: f.port }];
    const cap = Number(process.env.ELECTRUM_MAX_CONCURRENT || 8);
    // Fill every slot and queue more, then send the write.
    const reads = Array.from({ length: cap * 3 }, (_, i) =>
      electrumCall('blockchain.address.listunspent', [`a${i}`], servers, 30000));
    await sleep(50);
    const t0 = Date.now();
    await electrumCall('blockchain.transaction.broadcast', ['rawtx'], servers, 30000);
    const took = Date.now() - t0;
    check('the write went straight out, not behind the queue', took < 900, took);
    await Promise.all(reads);
    await f.close();
  }

  console.log('— a failure releases its slot rather than wedging the limiter —');
  {
    const dead = [{ host: '127.0.0.1', port: 9 }];
    await Promise.allSettled(Array.from({ length: 12 }, () =>
      electrumCall('blockchain.address.listunspent', ['x'], dead, 3000)));
    check('no slots leaked', electrumStats().active === 0, electrumStats());
    check('nothing left queued', electrumStats().queued === 0, electrumStats());

    // And the limiter still works afterwards.
    const f = await fakeElectrum(10);
    const r = await electrumCall('blockchain.headers.subscribe', [], [{ host: '127.0.0.1', port: f.port }], 10000);
    check('calls still succeed after a run of failures', !!r, r);
    await f.close();
  }

  console.log('— the batch balance path is limited too —');
  {
    const f = await fakeElectrum(80);
    const servers = [{ host: '127.0.0.1', port: f.port }];
    const cap = Number(process.env.ELECTRUM_MAX_CONCURRENT || 8);
    let peakHeld = 0;
    const sampler = setInterval(() => { peakHeld = Math.max(peakHeld, electrumStats().active); }, 5);
    await Promise.all(Array.from({ length: 20 }, () =>
      fetchBatchBalances(servers, ['LaddrOne', 'LaddrTwo'], 15000).catch(() => [])));
    clearInterval(sampler);
    check(`the limiter never held more than ${cap}`, peakHeld <= cap, peakHeld);
    check(`server saw at most ${cap + 1} at once`, f.peakConcurrent <= cap + 1, f.peakConcurrent);
    check('no slots leaked', electrumStats().active === 0, electrumStats());
    await f.close();
  }

  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}
main();
