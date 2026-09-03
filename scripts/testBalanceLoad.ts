/**
 * The request gate that keeps one search's answer off another's screen.
 *   npx tsx scripts/testBalanceLoad.ts
 */
import { makeRequestGate } from '../src/lib/balanceLoad.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— the newest search owns the screen —');
{
  const g = makeRequestGate();
  const first = g.newer();
  const second = g.newer();
  check('the first is no longer current', !g.isCurrent(first));
  check('the second is', g.isCurrent(second));
}

console.log('— the reported bug: search A, then B, A answers last —');
{
  const g = makeRequestGate();
  const a = g.newer();          // looking up customer A
  const b = g.newer();          // then customer B
  // B comes back first and paints.
  check('B may write', g.isCurrent(b));
  // A comes back afterwards and must NOT overwrite B with A's numbers.
  check('A may not write', !g.isCurrent(a));
}

console.log('— a single search is unaffected —');
{
  const g = makeRequestGate();
  const only = g.newer();
  check('it writes normally', g.isCurrent(only));
}

console.log('— gates are per page, not global —');
{
  const g1 = makeRequestGate(), g2 = makeRequestGate();
  const t1 = g1.newer();
  g2.newer(); g2.newer();
  check('one page starting a search does not invalidate another', g1.isCurrent(t1));
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
