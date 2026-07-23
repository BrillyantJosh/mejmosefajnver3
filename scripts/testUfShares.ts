/**
 * Unit tests for the Unconditional Financing repayment split (money-critical).
 * Run: npx tsx scripts/testUfShares.ts   (exit code 0 = all pass)
 */
import { splitRepayment, UF_DUST_THRESHOLD } from '../src/lib/ufShares';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

function sumL(outs: ReturnType<typeof splitRepayment>) {
  return outs.reduce((s, o) => s + o.lanoshis, 0);
}
function sumF(outs: ReturnType<typeof splitRepayment>) {
  return Math.round(outs.reduce((s, o) => s + o.fiat, 0) * 100) / 100;
}

const F = (pubkey: string, wallet: string, contributedFiat: number) => ({ pubkey, wallet, contributedFiat });

console.log('— single financier —');
{
  const outs = splitRepayment(100_000_000, 12.8, [F('a', 'WA', 500)]);
  check('one output', outs.length === 1);
  check('gets everything (lanoshis)', outs[0].lanoshis === 100_000_000);
  check('gets everything (fiat)', outs[0].fiat === 12.8);
  check('100% share', Math.abs(outs[0].sharePercent - 100) < 1e-9);
}

console.log('— 40/30/20/10 spec example (1000 EUR repayment) —');
{
  const fins = [F('fund', 'W1', 4000), F('m1', 'W2', 3000), F('m2', 'W3', 2000), F('m3', 'W4', 1000)];
  const totalLanoshis = 781_250_000_000; // 7812.5 LANA at 0.128 EUR
  const outs = splitRepayment(totalLanoshis, 1000, fins);
  check('4 outputs', outs.length === 4);
  check('lanoshis sum exact', sumL(outs) === totalLanoshis, sumL(outs));
  check('fiat sum exact', sumF(outs) === 1000, sumF(outs));
  const by = Object.fromEntries(outs.map(o => [o.pubkey, o]));
  check('fund 40% fiat', by.fund.fiat === 400, by.fund.fiat);
  check('m1 30% fiat', by.m1.fiat === 300, by.m1.fiat);
  check('m2 20% fiat', by.m2.fiat === 200, by.m2.fiat);
  check('m3 10% fiat', by.m3.fiat === 100, by.m3.fiat);
  check('share percents', Math.abs(by.fund.sharePercent - 40) < 1e-9 && Math.abs(by.m3.sharePercent - 10) < 1e-9);
}

console.log('— uneven thirds: flooring remainder goes to largest —');
{
  // 100 lanoshis across 3 equal-ish contributors → floors 33/33/33, remainder 1
  const fins = [F('a', 'WA', 100.01), F('b', 'WB', 100), F('c', 'WC', 100)];
  const outs = splitRepayment(1_000_000_000, 10, fins, 0); // dust off to test pure math
  check('3 outputs', outs.length === 3);
  check('lanoshis sum exact', sumL(outs) === 1_000_000_000, sumL(outs));
  check('fiat sum exact', sumF(outs) === 10, sumF(outs));
  const a = outs.find(o => o.pubkey === 'a')!;
  const b = outs.find(o => o.pubkey === 'b')!;
  check('largest (a) got the remainder', a.lanoshis >= b.lanoshis, { a: a.lanoshis, b: b.lanoshis });
}

console.log('— dust folding —');
{
  // One financier contributed so little that their output would be dust.
  const fins = [F('big', 'WB', 10_000), F('tiny', 'WT', 0.01)];
  const totalLanoshis = 10_000_000; // tiny's floor share ≈ 9 lanoshis → dust
  const outs = splitRepayment(totalLanoshis, 1.28, fins);
  check('dust folded → 1 output', outs.length === 1, outs.map(o => o.pubkey));
  check('big received everything', outs[0].pubkey === 'big' && outs[0].lanoshis === totalLanoshis);
  check('fiat conserved', sumF(outs) === 1.28, sumF(outs));
}
{
  // Dust threshold boundary: exactly threshold+1 must NOT be folded
  const fins = [F('big', 'WB', 1000), F('edge', 'WE', 1)];
  // edge share = total * 1/1001; choose total so edge gets exactly UF_DUST_THRESHOLD + 1
  const total = (UF_DUST_THRESHOLD + 1) * 1001;
  const outs = splitRepayment(total, 100.1, fins);
  const edge = outs.find(o => o.pubkey === 'edge');
  check('threshold+1 output survives', !!edge && edge.lanoshis === UF_DUST_THRESHOLD + 1, edge?.lanoshis);
  check('lanoshis sum exact', sumL(outs) === total, sumL(outs));
}

console.log('— filtering + degenerate inputs —');
{
  check('no financiers → []', splitRepayment(1000, 1, []).length === 0);
  check('zero-contribution filtered', splitRepayment(1000, 1, [F('z', 'WZ', 0)]).length === 0);
  check('missing wallet filtered', splitRepayment(1000, 1, [{ pubkey: 'x', wallet: '', contributedFiat: 5 }]).length === 0);
  check('zero total → []', splitRepayment(0, 0, [F('a', 'WA', 5)]).length === 0);
  check('negative total → []', splitRepayment(-5, 1, [F('a', 'WA', 5)]).length === 0);
}

console.log('— randomized invariant sweep (sums always exact) —');
{
  // Deterministic pseudo-random (no Math.random for reproducibility)
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(rand() * 12);
    const fins = Array.from({ length: n }, (_, j) => F(`p${j}`, `W${j}`, Math.round(rand() * 100000) / 100 + 0.01));
    const totalLanoshis = 1 + Math.floor(rand() * 10_000_000_000);
    const totalFiat = Math.round(rand() * 1_000_000) / 100;
    const outs = splitRepayment(totalLanoshis, totalFiat, fins);
    if (outs.length === 0) { ok = false; break; }
    if (sumL(outs) !== totalLanoshis) { ok = false; console.error('lanoshi mismatch', { i, totalLanoshis, got: sumL(outs) }); break; }
    if (Math.abs(sumF(outs) - totalFiat) > 0.005) { ok = false; console.error('fiat mismatch', { i, totalFiat, got: sumF(outs) }); break; }
    if (outs.some(o => o.lanoshis < 0 || o.fiat < 0)) { ok = false; console.error('negative output', { i }); break; }
  }
  check('500 random cases: sums exact, no negatives', ok);
}

if (failures > 0) {
  console.error(`\n❌ ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\n✅ all ufShares tests passed');
