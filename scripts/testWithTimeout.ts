/**
 * The heartbeat's deadline: warn only when the deadline really came first.
 *   npx tsx scripts/testWithTimeout.ts
 *
 * On 9. 10. 2026 production logged "⏰ indexUnconditionalFinancingFromRelays
 * timed out after 120s" exactly two minutes after every SUCCESSFUL re-index —
 * the timer was never cleared, so every heartbeat job "timed out" after every
 * run and a real timeout could not be told apart.
 */
import { withTimeout } from '../server/lib/withTimeout.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pendingTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

async function main() {
  const baseline = pendingTimers();

  console.log('— a job that finishes in time —');
  {
    warnings.length = 0;
    const out = await withTimeout(async () => { await sleep(10); return 'scanned'; }, 'fast job', 100);
    check('its result comes back', out === 'scanned', out);
    check('no timer is left waiting', pendingTimers() === baseline, { pending: pendingTimers(), baseline });
    await sleep(150); // well past the deadline
    check('nothing is logged, not even after the deadline', warnings.length === 0, warnings);
  }

  console.log('— a job that is too slow —');
  {
    warnings.length = 0;
    const job = { finished: false };
    const out = await withTimeout(async () => { await sleep(150); job.finished = true; return 'late'; }, 'slow job', 50);
    check('resolves undefined', out === undefined, out);
    check('logs one warning', warnings.length === 1, warnings);
    check('the warning names the job and the deadline',
      warnings[0] === '⏰ slow job timed out after 0.05s — skipping this cycle', warnings[0]);
    check('the job is not cancelled yet', job.finished === false);
    await sleep(150);
    check('the job keeps running to its end', job.finished === true);
    check('still only one warning', warnings.length === 1, warnings);
    check('no timer is left waiting', pendingTimers() === baseline, { pending: pendingTimers(), baseline });
  }

  console.log('— a job that fails in time —');
  {
    warnings.length = 0;
    let caught: unknown;
    try {
      await withTimeout(async () => { await sleep(10); throw new Error('relay down'); }, 'failing job', 100);
    } catch (err) { caught = err; }
    check('the failure still reaches the caller', (caught as Error)?.message === 'relay down', String(caught));
    check('no timer is left waiting', pendingTimers() === baseline, { pending: pendingTimers(), baseline });
    await sleep(150);
    check('a failure is not reported as a timeout', warnings.length === 0, warnings);
  }

  console.log('— a job that throws before it starts —');
  {
    warnings.length = 0;
    let caught: unknown;
    try {
      await withTimeout(() => { throw new Error('bad input'); }, 'broken job', 50);
    } catch (err) { caught = err; }
    check('the error reaches the caller', (caught as Error)?.message === 'bad input', String(caught));
    check('no timer is left waiting', pendingTimers() === baseline, { pending: pendingTimers(), baseline });
    await sleep(100);
    check('nothing is logged', warnings.length === 0, warnings);
  }

  console.warn = realWarn;
  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}
main();
