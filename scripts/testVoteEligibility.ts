/**
 * Who may vote in Lana Aligns World.
 *   npx tsx scripts/testVoteEligibility.ts
 *
 * This decides whether a person keeps their voice in governance, so the rule
 * is pinned here rather than trusted to a reading of the code. The worked
 * example is the one real frozen voter found on the relays.
 */
import {
  evaluateFreezeGate,
  canVoteWith,
  freezeGateExplanation,
  freezeReasonLabel,
} from '../src/lib/voteEligibility.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— an ordinary member votes —');
{
  const gate = evaluateFreezeGate(
    [{ status: 'active', freezeStatus: '' }, { status: 'active' }],
    true
  );
  check('clear', gate.state === 'clear', gate);
  check('may vote', canVoteWith(gate));
  check('nothing to explain', freezeGateExplanation(gate) === null);
}

console.log('— the real frozen voter: 12/12 wallets, account still "active" —');
{
  const wallets = Array.from({ length: 12 }, () => ({
    status: 'active',
    freezeStatus: 'frozen_own_person',
  }));
  const gate = evaluateFreezeGate(wallets, true);
  check('frozen', gate.state === 'frozen', gate);
  check('may NOT vote', !canVoteWith(gate));
  check('account tag alone would have missed it', gate.accountFrozen === false);
  check('counts all twelve', gate.frozenWallets === 12 && gate.totalWallets === 12, gate);
  check('names the reason once, not twelve times', gate.reasons.length === 1, gate.reasons);
  check(
    'explains in plain words',
    (freezeGateExplanation(gate) || '').includes('self-responsibility'),
    freezeGateExplanation(gate)
  );
}

console.log('— one frozen wallet out of many is enough (Brilly, 2026-08-25) —');
{
  const gate = evaluateFreezeGate(
    [
      { status: 'active' },
      { status: 'active', freezeStatus: 'frozen_max_cap' },
      { status: 'active' },
    ],
    true
  );
  check('frozen', gate.state === 'frozen', gate);
  check('may NOT vote', !canVoteWith(gate));
  check('says 1 of 3', (freezeGateExplanation(gate) || '').includes('1 of your 3'), freezeGateExplanation(gate));
}

console.log('— an account-level freeze needs no wallet flag —');
{
  const gate = evaluateFreezeGate([{ status: 'frozen' }], true);
  check('frozen', gate.state === 'frozen', gate);
  check('reported as account-level', gate.accountFrozen === true);
  check('may NOT vote', !canVoteWith(gate));
}

console.log('— silence is never a clearance —');
{
  const unreachable = evaluateFreezeGate([], false);
  check('relay outage → unknown', unreachable.state === 'unknown', unreachable);
  check('and blocked', !canVoteWith(unreachable));
  check('says it is a verification failure', unreachable.unknownBecause === 'unreachable');
  check(
    'never accuses the person of being frozen',
    !(freezeGateExplanation(unreachable) || '').includes('frozen'),
    freezeGateExplanation(unreachable)
  );

  // The trap this guards: a timeout hands back an empty array, exactly like a
  // person with no wallets. Resolved=false is what keeps them apart.
  const emptyButRead = evaluateFreezeGate([], true);
  check('no wallet list → also unknown, not clear', emptyButRead.state === 'unknown', emptyButRead);
  check('and blocked', !canVoteWith(emptyButRead));
  check('but for a different reason', emptyButRead.unknownBecause === 'no_wallet_list');

  check('null wallets → unknown', evaluateFreezeGate(null, true).state === 'unknown');
  check('undefined wallets → unknown', evaluateFreezeGate(undefined, true).state === 'unknown');

  // Frozen must survive an unreadable-looking payload rather than fall to clear.
  const partial = evaluateFreezeGate([{ freezeStatus: 'frozen_too_wild' }], true);
  check('freeze without a status tag still counts', partial.state === 'frozen', partial);
}

console.log('— every freeze code we have seen in production has words —');
{
  for (const code of [
    'frozen_l8w',
    'frozen_max_cap',
    'frozen_too_wild',
    'frozen_unreg_Lanas',
    'frozen_own_person',
    'frozen',
  ]) {
    check(`${code} is not the fallback`, freezeReasonLabel(code) !== 'Frozen', freezeReasonLabel(code));
  }
  check('an unknown code still says something', freezeReasonLabel('frozen_future') === 'Frozen');
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
