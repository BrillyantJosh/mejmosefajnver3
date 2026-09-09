/**
 * When the Split cap warning is shown.
 *   npx tsx scripts/testSplitWarning.ts
 *
 * The rule changed on 9 September 2026, so these assertions exist mostly to
 * pin the new one: no Split approaching, no sign — however far over someone is.
 */
import { evaluateSplitLimit } from '../src/lib/splitWarning.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const CAP = 196;

console.log('— no Split approaching: the sign stays away —');
{
  const far = evaluateSplitLimit(CAP, 983.48, false);
  check('five times over the cap shows nothing', far.warn === false, far);
  check('but the fact is still readable', far.overLimit === true, far);

  const retail = evaluateSplitLimit(1000, 1948.17, false);
  check('the Retail limit behaves the same', retail.warn === false && retail.overLimit === true, retail);
}

console.log('— Split approaching: the sign appears —');
{
  const over = evaluateSplitLimit(CAP, 983.48, true);
  check('over the cap warns', over.warn === true, over);

  const under = evaluateSplitLimit(CAP, 12, true);
  check('under the cap does not warn', under.warn === false, under);
  check('under the cap is not over', under.overLimit === false, under);
}

console.log('— the boundary —');
{
  const exact = evaluateSplitLimit(CAP, CAP, true);
  check('exactly at the cap is NOT over', exact.overLimit === false && exact.warn === false, exact);
  const hair = evaluateSplitLimit(CAP, CAP + 0.01, true);
  check('a hundredth above it is', hair.overLimit === true && hair.warn === true, hair);
}

console.log('— no cap published —');
{
  for (const [name, value] of [['zero', 0], ['negative', -5], ['NaN', Number.NaN]] as const) {
    const v = evaluateSplitLimit(value as number, 999999, true);
    check(`a ${name} cap warns nobody`, v.warn === false && v.overLimit === false && v.limit === 0, v);
  }
}

console.log('— a flag that is not a real yes —');
{
  // The flag arrives as a string from the relays and is parsed upstream; only a
  // real boolean true may open the gate here.
  for (const bad of [undefined, null, 0, '', 'false', 'FALSE', 'no'] as unknown[]) {
    const v = evaluateSplitLimit(CAP, 983.48, bad as boolean);
    check(`${JSON.stringify(bad)} does not count as approaching`, v.warn === false, v);
  }
  const yes = evaluateSplitLimit(CAP, 983.48, true);
  check('only true opens it', yes.warn === true, yes);
}

console.log('— an unreadable balance —');
{
  const v = evaluateSplitLimit(CAP, Number.NaN, true);
  check('NaN is not treated as over the cap', v.overLimit === false && v.warn === false, v);
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
