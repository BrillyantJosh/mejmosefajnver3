/**
 * Dependency-free load generator for MejmoSeFajn.
 *   node scripts/load/loadTest.mjs --url http://127.0.0.1:3099 --users 1000 --seconds 30
 *
 * Point it at a LOCAL instance. Never at production: 1000 virtual users against
 * the live box is an outage, not a test.
 *
 * The number that matters is not throughput. It is the latency of a trivial
 * endpoint measured WHILE the load runs: better-sqlite3 is synchronous, so a
 * blocked event loop shows up as the cheap probe going slow. Throughput can look
 * fine while every user waits.
 */
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ') || true])
);

const URL_BASE = args.url || 'http://127.0.0.1:3099';
const USERS = Number(args.users || 100);
const SECONDS = Number(args.seconds || 20);
const PROBE_MS = Number(args.probe || 250);

const { hostname, port } = new URL(URL_BASE);
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

const stats = new Map();   // label -> {n, errors, statuses:Map, times:[]}
const bucket = (label) => {
  if (!stats.has(label)) stats.set(label, { n: 0, errors: 0, statuses: new Map(), times: [] });
  return stats.get(label);
};

function once(label, path, { method = 'GET', body = null, timeout = 20000 } = {}) {
  const b = bucket(label);
  const started = performance.now();
  return new Promise((resolve) => {
    const req = http.request(
      { hostname, port, path, method, agent, timeout,
        headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {} },
      (res) => {
        res.resume();                       // drain, we only time the response
        res.on('end', () => {
          b.n++; b.times.push(performance.now() - started);
          b.statuses.set(res.statusCode, (b.statuses.get(res.statusCode) || 0) + 1);
          resolve(res.statusCode);
        });
      }
    );
    req.on('timeout', () => { b.errors++; req.destroy(); resolve('timeout'); });
    req.on('error', () => { b.errors++; resolve('error'); });
    if (body) req.write(body);
    req.end();
  });
}

// ── the probe: one trivial request every PROBE_MS, throughout ──────────────
const probe = [];
async function runProbe(until) {
  while (performance.now() < until) {
    const t0 = performance.now();
    await once('probe', '/health');
    probe.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, PROBE_MS));
  }
}

// ── what one virtual user does, repeatedly ────────────────────────────────
async function virtualUser(i, until) {
  while (performance.now() < until) {
    await once('index', '/');                              // SPA shell
    await once('profiles', '/api/db/nostr_profiles?limit=20');  // the table the client reads most
    await once('settings', '/api/db/app_settings');
    await new Promise(r => setTimeout(r, 200 + (i % 7) * 40));   // human pacing, staggered
  }
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
};

console.log(`\n▶ ${USERS} virtual users against ${URL_BASE} for ${SECONDS}s\n`);
const until = performance.now() + SECONDS * 1000;
const t0 = performance.now();

await Promise.all([
  runProbe(until),
  ...Array.from({ length: USERS }, (_, i) => virtualUser(i, until)),
]);

const elapsed = (performance.now() - t0) / 1000;
let total = 0, errs = 0;

console.log('label       reqs    rps    p50     p95     p99     max   errors  statuses');
console.log('─'.repeat(78));
for (const [label, b] of stats) {
  total += b.n; errs += b.errors;
  const st = [...b.statuses.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
  console.log(
    label.padEnd(11) +
    String(b.n).padStart(5) +
    String(Math.round(b.n / elapsed)).padStart(7) +
    String(pct(b.times, 0.5)).padStart(7) + 'ms' +
    String(pct(b.times, 0.95)).padStart(6) + 'ms' +
    String(pct(b.times, 0.99)).padStart(6) + 'ms' +
    String(Math.round(Math.max(0, ...b.times))).padStart(6) + 'ms' +
    String(b.errors).padStart(7) + '  ' + st
  );
}
console.log('─'.repeat(78));
console.log(`total ${total} reqs in ${elapsed.toFixed(1)}s = ${Math.round(total / elapsed)} rps, ${errs} errors`);
console.log(`\nEVENT-LOOP PROBE (a trivial request, taken every ${PROBE_MS}ms during the run)`);
console.log(`  p50 ${pct(probe, 0.5)}ms   p95 ${pct(probe, 0.95)}ms   p99 ${pct(probe, 0.99)}ms   max ${Math.round(Math.max(0, ...probe))}ms`);
console.log(`  ${probe.length} samples. A healthy loop keeps this in single-digit ms.\n`);
process.exit(0);
