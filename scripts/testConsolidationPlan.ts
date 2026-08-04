/**
 * The consolidation planner must never offer a batch that cannot succeed, never
 * offer one that removes nothing, and never quietly drop a UTXO.
 *
 *   npx tsx scripts/testConsolidationPlan.ts
 */
import {
  buildConsolidationPlan,
  consolidationFee,
  requiredFor,
  largestAffordableSize,
  MAX_INPUTS,
  MIN_INPUTS,
  MIN_NET,
  type PlanUtxo,
} from '../src/lib/consolidationPlan.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 240) : ''); }
}

let id = 0;
const utxo = (value: number, height = 100): PlanUtxo => ({
  tx_hash: `tx${++id}`.padStart(64, '0'),
  tx_pos: 0,
  value,
  height,
});
const many = (count: number, value: number, height = 100) =>
  Array.from({ length: count }, () => utxo(value, height));

/** Invariants that must hold for EVERY plan, whatever the wallet looks like. */
function assertInvariants(label: string, input: PlanUtxo[], plan: ReturnType<typeof buildConsolidationPlan>) {
  for (const b of plan.batches) {
    check(`${label}: batch #${b.id} is affordable (net ${b.net} >= ${MIN_NET})`, b.net >= MIN_NET, b);
    check(`${label}: batch #${b.id} removes at least one UTXO (n=${b.utxos.length})`, b.utxos.length >= MIN_INPUTS, b);
    check(`${label}: batch #${b.id} within MAX_INPUTS`, b.utxos.length <= MAX_INPUTS, b);
    check(`${label}: batch #${b.id} fee matches the formula`, b.fee === consolidationFee(b.utxos.length), b);
    const sum = b.utxos.reduce((s, u) => s + u.value, 0);
    check(`${label}: batch #${b.id} totals add up`, sum === b.totalValue && b.net === sum - b.fee, b);
  }

  // Nothing may appear twice, and nothing may vanish.
  const key = (u: PlanUtxo) => `${u.tx_hash}:${u.tx_pos}`;
  const placed = [...plan.batches.flatMap((b) => b.utxos), ...plan.leftovers].map(key);
  check(`${label}: no UTXO used twice`, new Set(placed).size === placed.length, placed.length);
  check(`${label}: every UTXO accounted for (${placed.length}/${input.length})`, placed.length === input.length);
  const inputKeys = new Set(input.map(key));
  check(`${label}: no invented UTXOs`, placed.every((k) => inputKeys.has(k)));
}

console.log('— the reported wallet: 1 funder of 458,663 + 20 dust of 20 —');
{
  const input = [utxo(458663), ...many(20, 20)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('reported', input, plan);
  check('produces exactly one viable batch', plan.batches.length === 1, plan.batches.length);
  check('that batch has 16 inputs', plan.batches[0]?.utxos.length === 16, plan.batches[0]?.utxos.length);
  check('fee is 438,600', plan.batches[0]?.fee === 438600, plan.batches[0]?.fee);
  check('net is 20,363', plan.batches[0]?.net === 20363, plan.batches[0]?.net);
  check('removes 15 UTXOs', plan.totalRemoved === 15, plan.totalRemoved);
  check('5 dust left over, honestly reported', plan.leftovers.length === 5, plan.leftovers.length);
  // The old code produced 20 + 1 and refused both.
  check('the old 20-input batch was indeed unaffordable', 459043 - consolidationFee(20) < MIN_NET);
}

console.log('\n— viability is not monotone: five UTXOs of 28,750 —');
{
  const input = many(5, 28750);
  const plan = buildConsolidationPlan(input);
  assertInvariants('non-monotone', input, plan);
  check('a naive grow-while-viable loop finds nothing at n=2', 57500 < requiredFor(2));
  check('the planner still finds the n=5 batch', plan.batches.length === 1 && plan.batches[0].utxos.length === 5, plan.batches[0]?.utxos.length);
  check('largestAffordableSize agrees', largestAffordableSize([...input].sort((a, b) => b.value - a.value)) === 5);
}

console.log('\n— a single UTXO: nothing to do, and nothing to burn —');
{
  const input = [utxo(1000000)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('single', input, plan);
  check('no batch offered', plan.batches.length === 0, plan.batches);
  check('the lone UTXO is still reported', plan.leftovers.length === 1);
  // The old code offered an enabled button here that burned 33,600 for nothing.
  check('old code would have called this viable', 1000000 - consolidationFee(1) >= MIN_NET);
}

console.log('\n— a wallet that can never consolidate: 25 dust of 20 —');
{
  const input = many(25, 20);
  const plan = buildConsolidationPlan(input);
  assertInvariants('all-dust', input, plan);
  check('no batch offered', plan.batches.length === 0, plan.batches);
  check('all 25 reported as stranded', plan.leftovers.length === 25);
  check('a deposit figure is offered', plan.depositToUnstick > 0, plan.depositToUnstick);
  check('and it is enough to fund a 2-input batch', plan.depositToUnstick + 20 >= requiredFor(2), plan.depositToUnstick);
}

console.log('\n— plenty of value: 2 funders of 5,000,000 + 38 dust —');
{
  const input = [...many(2, 5000000), ...many(38, 20)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('funded', input, plan);
  check('more than one batch is offered', plan.batches.length >= 2, plan.batches.length);
  check('every batch is full-size', plan.batches.every((b) => b.utxos.length === MAX_INPUTS), plan.batches.map((b) => b.utxos.length));
  check('removes 19 per batch', plan.totalRemoved === plan.batches.length * 19, plan.totalRemoved);
  check('the wallet drops to at most 20 UTXOs', input.length - plan.totalRemoved <= MAX_INPUTS, input.length - plan.totalRemoved);
}

console.log('\n— barely funded: one of 40,000 + 20 dust —');
{
  const input = [utxo(40000), ...many(20, 20)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('barely', input, plan);
  // 40,020 covers requiredFor(1)=34,600 but not requiredFor(2)=61,600.
  check('no batch is affordable', plan.batches.length === 0, plan.batches);
  check('nothing is silently dropped', plan.leftovers.length === 21);
}

console.log('\n— trivial: 1,000,000 and 15 —');
{
  const input = [utxo(1000000), utxo(15)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('trivial', input, plan);
  check('one 2-input batch', plan.batches.length === 1 && plan.batches[0].utxos.length === 2, plan.batches[0]?.utxos.length);
  check('net is correct', plan.batches[0]?.net === 1000015 - consolidationFee(2), plan.batches[0]?.net);
}

console.log('\n— 20 healthy UTXOs of 1,000,000 —');
{
  const input = many(20, 1000000);
  const plan = buildConsolidationPlan(input);
  assertInvariants('healthy', input, plan);
  check('a full 20-input batch is affordable', plan.batches.length === 1 && plan.batches[0].utxos.length === 20, plan.batches[0]?.utxos.length);
}

console.log('\n— unconfirmed outputs are never spent —');
{
  const input = [utxo(1000000, 0), utxo(500000), utxo(20)];
  const plan = buildConsolidationPlan(input);
  assertInvariants('unconfirmed', input, plan);
  const spent = plan.batches.flatMap((b) => b.utxos);
  check('no unconfirmed UTXO ended up in a batch', spent.every((u) => (u.height ?? 1) > 0), spent.map((u) => u.height));
  check('the unconfirmed one is still shown', plan.leftovers.some((u) => u.height === 0));
}

console.log('\n— empty wallet —');
{
  const plan = buildConsolidationPlan([]);
  check('no batches, no leftovers, no deposit figure',
    plan.batches.length === 0 && plan.leftovers.length === 0 && plan.depositToUnstick === 0, plan);
}

console.log('\n— randomised sweep: invariants must hold for any wallet —');
{
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let worstCase = '';
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(rnd() * 45);
    const input = Array.from({ length: n }, () =>
      utxo(rnd() < 0.6 ? Math.floor(rnd() * 500) + 1 : Math.floor(rnd() * 3_000_000) + 1)
    );
    const plan = buildConsolidationPlan(input);
    const key = (u: PlanUtxo) => `${u.tx_hash}:${u.tx_pos}`;
    const placed = [...plan.batches.flatMap((b) => b.utxos), ...plan.leftovers].map(key);
    const ok =
      plan.batches.every((b) => b.net >= MIN_NET && b.utxos.length >= MIN_INPUTS && b.utxos.length <= MAX_INPUTS) &&
      new Set(placed).size === placed.length &&
      placed.length === input.length;
    if (!ok) { worstCase = JSON.stringify({ i, n, batches: plan.batches.map((b) => [b.utxos.length, b.net]) }); break; }
  }
  check('400 random wallets all satisfy every invariant', worstCase === '', worstCase);
}

if (failures > 0) {
  console.error(`\n❌ ${failures} FAILED`);
  process.exit(1);
}
console.log('\n✅ ALL CONSOLIDATION PLAN TESTS PASSED');
