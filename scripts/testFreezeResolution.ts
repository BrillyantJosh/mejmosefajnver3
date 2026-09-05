/**
 * Where a frozen wallet is sent to be unfrozen.
 *   npx tsx scripts/testFreezeResolution.ts
 *
 * This decides where a person goes to get their money moving again, and one of
 * the destinations asks them to donate their whole balance — so the routing is
 * pinned here rather than trusted to a reading of the code.
 */
import { freezeResolution } from '../src/lib/freezeResolution.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const W = 'LbdcjzbH3xJ6ry9mCr3ETqeAv2ihteKimp';

console.log('— the two the person can settle themselves —');
{
  for (const reason of ['frozen_max_cap', 'frozen_l8w']) {
    const r = freezeResolution(reason, W);
    check(`${reason}: self-service`, r.kind === 'self', r);
    check(`${reason}: goes to the resolve page`, r.href.includes('/wallets/resolve-max-cap'), r.href);
    check(`${reason}: carries the wallet`, r.href.includes(W), r.href);
    check(`${reason}: opens the registrar`, r.external === true);
  }
}

console.log('— the self-responsibility freeze must NOT go to the registrar —');
{
  // The registrar's resolve page asks for the whole balance. Sending someone
  // here whose freeze it cannot lift would invite them to pay for nothing.
  const r = freezeResolution('frozen_own_person', W);
  check('routed to the process, not the registrar', r.kind === 'own-process', r);
  check('does not link to lanatrace', !r.href.includes('lanatrace'), r.href);
  check('never suggests donating a balance', !/resolve-max-cap/.test(r.href), r.href);
  check('stays inside the app', r.external === false);
  check('says why', /self-responsibility/i.test(r.hint), r.hint);
}

console.log('— everything the registrar reviews by hand —');
{
  for (const reason of ['frozen_too_wild', 'frozen_unreg_Lanas', 'frozen']) {
    const r = freezeResolution(reason, W);
    check(`${reason}: registrar review`, r.kind === 'registrar', r);
    check(`${reason}: NOT the donate-everything page`, !r.href.includes('resolve-max-cap'), r.href);
  }
}

console.log('— an unknown reason fails to the safe side —');
{
  const r = freezeResolution('frozen_something_new', W);
  check('treated as registrar review', r.kind === 'registrar', r);
  check('not the donate-everything page', !r.href.includes('resolve-max-cap'), r.href);
  check('and an empty reason too', freezeResolution('', W).kind === 'registrar');
}

console.log('— the address is escaped, never pasted raw —');
{
  const r = freezeResolution('frozen_max_cap', 'abc&def=1 x');
  check('encoded', r.href.includes('abc%26def%3D1%20x'), r.href);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
