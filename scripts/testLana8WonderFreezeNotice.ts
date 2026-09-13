/**
 * What a frozen person is told to do before a Lana8Wonder cash-out.
 *   npx tsx scripts/testLana8WonderFreezeNotice.ts
 *
 * The assertions that matter most: nobody is told their cash-out is blocked
 * when the frozen wallet is not in their plan, an unreadable list is never
 * reported as either frozen or clear, and a freeze from the self-responsibility
 * process is never routed to the registrar.
 */
import { lana8wonderFreezeNotice, type NoticeWallet } from '../src/lib/lana8wonderFreezeNotice.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const P1 = 'LplanWallet1111111111111111111111';
const P2 = 'LplanWallet2222222222222222222222';
const P3 = 'LplanWallet3333333333333333333333';
const OTHER = 'LotherWallet99999999999999999999';
const PLAN = [P1, P2, P3];
const w = (walletId: string, freezeStatus = '', status = 'active'): NoticeWallet => ({ walletId, freezeStatus, status });

console.log('— nothing frozen —');
{
  const n = lana8wonderFreezeNotice([w(P1), w(P2), w(P3), w(OTHER)], true, PLAN);
  check('no notice', n.scope === 'none' && n.steps.length === 0, n);
}

console.log('— the list could not be read —');
{
  const outage = lana8wonderFreezeNotice([], false, PLAN);
  check('unresolved is unknown', outage.scope === 'unknown', outage);
  const empty = lana8wonderFreezeNotice([], true, PLAN);
  check('an empty list is unknown, not clear', empty.scope === 'unknown', empty);
  check('and unknown never tells anyone to unfreeze', empty.steps.length === 0, empty);
}

console.log('— a frozen wallet OUTSIDE the plan —');
{
  const n = lana8wonderFreezeNotice([w(P1), w(P2), w(P3), w(OTHER, 'frozen_max_cap')], true, PLAN);
  check('the cash-out is not described as blocked', n.scope === 'unaffected', n);
  check('no steps are asked of them here', n.steps.length === 0, n);
  check('zero plan wallets counted as frozen', n.frozenPlanWallets === 0, n);
}

console.log('— one plan wallet frozen —');
{
  const n = lana8wonderFreezeNotice([w(P1, 'frozen_max_cap'), w(P2), w(P3)], true, PLAN);
  check('scope is the plan', n.scope === 'plan', n);
  check('1 of 3 plan wallets', n.frozenPlanWallets === 1 && n.planWallets === 3, n);
  check('one step', n.steps.length === 1, n);
  check('it goes to the max-cap page for THAT wallet', n.steps[0].resolution.href.includes(encodeURIComponent(P1)), n.steps[0]);
}

console.log('— the self-responsibility process —');
{
  const n = lana8wonderFreezeNotice([w(P1, 'frozen_own_person'), w(P2, 'frozen_own_person'), w(P3, 'frozen_own_person')], true, PLAN);
  check('all three held', n.frozenPlanWallets === 3, n);
  check('ONE step, not three', n.steps.length === 1, n);
  check('routed to the process', n.steps[0].resolution.kind === 'own-process' && n.steps[0].resolution.href === '/own', n.steps[0]);
  check('never to the registrar', !n.steps[0].resolution.href.includes('lanatrace'), n.steps[0]);
}

console.log('— the account itself frozen —');
{
  const n = lana8wonderFreezeNotice([w(P1, '', 'frozen'), w(P2, '', 'frozen'), w(P3, '', 'frozen')], true, PLAN);
  check('scope is the account', n.scope === 'account', n);
  check('every plan wallet held', n.frozenPlanWallets === 3, n);
  check('a plan wallet the list does not name is still held', lana8wonderFreezeNotice([w(OTHER, '', 'frozen')], true, PLAN).frozenPlanWallets === 3);
}

console.log('— several reasons at once —');
{
  const n = lana8wonderFreezeNotice(
    [w(P1, 'frozen_too_wild'), w(P2, 'frozen_own_person'), w(P3, 'frozen_l8w')],
    true, PLAN,
  );
  check('one step per reason', n.steps.length === 3, n.steps.map(s => s.reason));
  check('what they can settle themselves comes first', n.steps[0].resolution.kind === 'self', n.steps.map(s => s.resolution.kind));
  check('then the process', n.steps[1].resolution.kind === 'own-process', n.steps.map(s => s.resolution.kind));
  check('then the registrar review', n.steps[2].resolution.kind === 'registrar', n.steps.map(s => s.resolution.kind));
}
{
  const n = lana8wonderFreezeNotice([w(P1, 'frozen_max_cap'), w(P2, 'frozen_max_cap'), w(P3)], true, PLAN);
  check('the same reason on two wallets is one step naming both', n.steps.length === 1 && n.steps[0].wallets.length === 2, n.steps);
}

console.log('— an unknown freeze code —');
{
  const n = lana8wonderFreezeNotice([w(P1, 'frozen_something_new'), w(P2), w(P3)], true, PLAN);
  check('still counts as frozen', n.frozenPlanWallets === 1, n);
  check('and goes to registrar review, never to a donate-your-balance page', n.steps[0].resolution.kind === 'registrar', n.steps[0]);
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
