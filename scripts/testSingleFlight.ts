/**
 * Sharing a request that is already on the wire.
 *   npx tsx scripts/testSingleFlight.ts
 */
import { singleFlight, singleFlightSize } from '../src/lib/singleFlight.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('— three mounts, one round trip —');
  {
    let runs = 0;
    const run = async () => { runs++; await sleep(50); return { wallets: [1, 2] }; };
    const out = await Promise.all([
      singleFlight('k', run), singleFlight('k', run), singleFlight('k', run),
    ]);
    check('the work ran once', runs === 1, runs);
    check('all three got an answer', out.length === 3 && out.every((r) => r.wallets.length === 2));
    check('and it is the same answer', out[0] === out[1] && out[1] === out[2]);
    check('nothing left behind', singleFlightSize() === 0, singleFlightSize());
  }

  console.log('— different keys do not share —');
  {
    let runs = 0;
    const run = async () => { runs++; await sleep(20); return runs; };
    await Promise.all([singleFlight('a', run), singleFlight('b', run)]);
    check('two keys, two runs', runs === 2, runs);
  }

  console.log('— nothing is remembered after it settles —');
  {
    let runs = 0;
    const run = async () => { runs++; return runs; };
    await singleFlight('k2', run);
    await singleFlight('k2', run);
    check('a later caller fetches fresh, it is not a cache', runs === 2, runs);
  }

  console.log('— a failure is shared, and must not wedge the key —');
  {
    let runs = 0;
    const boom = async () => { runs++; await sleep(20); throw new Error('relay down'); };
    const results = await Promise.allSettled([singleFlight('k3', boom), singleFlight('k3', boom)]);
    check('both callers see the failure', results.every((r) => r.status === 'rejected'), results.map((r) => r.status));
    check('it ran once', runs === 1, runs);
    check('the key is free again', singleFlightSize() === 0, singleFlightSize());

    // The important part: the next caller must be able to try again.
    const ok = await singleFlight('k3', async () => 'recovered');
    check('a later caller can retry', ok === 'recovered', ok);
  }

  console.log('— a slow caller joining late still shares —');
  {
    let runs = 0;
    const run = async () => { runs++; await sleep(80); return 'x'; };
    const first = singleFlight('k4', run);
    await sleep(30);
    const second = singleFlight('k4', run);
    await Promise.all([first, second]);
    check('joined the one in flight', runs === 1, runs);
  }

  console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
  process.exit(failures ? 1 : 0);
}
main();
