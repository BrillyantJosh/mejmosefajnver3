/**
 * The capped allowance a frozen wallet keeps.
 *   npx tsx scripts/testFrozenSpendCap.ts
 *
 * This decides whether real money may leave a frozen wallet, so the arithmetic
 * is pinned here rather than trusted to a reading of the code. The worked
 * example is the live one that prompted the fix.
 */
import { frozenSpendCapLana, FROZEN_SPEND_MAX_EUR } from '../server/lib/walletFreeze.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— the reported wallet: 531.25 LANA at 0.128 EUR/LANA —');
{
  const cap = frozenSpendCapLana(531.25, 0.128);
  check('half the funds is the binding limit here', Math.abs(cap - 265.625) < 1e-9, cap);
  check('the €100 arm would have allowed more', 100 / 0.128 > cap, 100 / 0.128);
  check('the 3.00732422 LANA payment fits', 3.00732422 <= cap);
  check('spending everything does not', 531.25 > cap);
}

console.log('— the €100 arm binds on a rich wallet —');
{
  // 100000 LANA at 0.128 → half is 50000, but €100 is only 781.25.
  const cap = frozenSpendCapLana(100000, 0.128);
  check('cap is the €100 equivalent', Math.abs(cap - 781.25) < 1e-9, cap);
  check(`never above €${FROZEN_SPEND_MAX_EUR}`, cap * 0.128 <= FROZEN_SPEND_MAX_EUR + 1e-9);
}

console.log('— refuse rather than guess —');
{
  check('no rate → no allowance', frozenSpendCapLana(531.25, 0) === 0);
  check('missing rate → no allowance', frozenSpendCapLana(531.25, NaN as unknown as number) === 0);
  check('empty wallet → no allowance', frozenSpendCapLana(0, 0.128) === 0);
  check('negative balance → no allowance', frozenSpendCapLana(-5, 0.128) === 0);
}

console.log('— the cap moves with the balance —');
{
  const before = frozenSpendCapLana(531.25, 0.128);
  const after = frozenSpendCapLana(531.25 - 265.625, 0.128);
  check('spending the allowance halves the next one', Math.abs(after - 132.8125) < 1e-9, after);
  check('so it can never drain the wallet in one step', after < before);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
