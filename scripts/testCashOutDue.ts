/**
 * Whether a Lana8Wonder cash-out is still owed.
 *   npx tsx scripts/testCashOutDue.ts
 *
 * People sent their surplus twice because the alert stayed up while the first
 * transfer was still in the mempool. Most of these assertions are about the
 * two ways that fix could go wrong: counting the same money twice (and so
 * hiding a real cash-out), or trusting a record for ever.
 */
import {
  evaluateCashOut,
  IN_FLIGHT_TRUSTED_MS,
  type InFlightCashOut,
} from '../src/lib/cashOutDue.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const NOW = 1_788_000_000_000;
const REMAINING = 1000;             // the plan says the account keeps 1000 LANA
const record = (over: Partial<InFlightCashOut> = {}): InFlightCashOut => ({
  walletId: 'LbdcjzbH3xJ6ry9mCr3ETqeAv2ihteKimp',
  amount: 500,
  txid: 'f'.repeat(64),
  sentAt: NOW - 60_000,             // a minute ago
  ...over,
});

console.log('— the plain cases —');
{
  const due = evaluateCashOut({ balance: 1500, expectedRemaining: REMAINING, now: NOW });
  check('500 over the line is due', due.state === 'due' && due.amountDue === 500, due);

  const clear = evaluateCashOut({ balance: 1000, expectedRemaining: REMAINING, now: NOW });
  check('exactly at the line is clear', clear.state === 'clear', clear);

  const dust = evaluateCashOut({ balance: 1019, expectedRemaining: REMAINING, now: NOW });
  check('within the 2% tolerance is clear', dust.state === 'clear', dust);

  const overTolerance = evaluateCashOut({ balance: 1021, expectedRemaining: REMAINING, now: NOW });
  check('just past the tolerance is due', overTolerance.state === 'due', overTolerance);
}

console.log('— the chain shows the money leaving —');
{
  // Balance already has the mempool spend subtracted: 1500 - 500 = 1000.
  const v = evaluateCashOut({
    balance: 1000, unconfirmedBalance: -500, expectedRemaining: REMAINING, now: NOW,
  });
  check('no second cash-out is asked for', v.state === 'in_flight', v);
  check('the chain is named as the source', v.chainShowsSpend === true, v);
}

console.log('— the chain has not caught up, but the app wrote it down —');
{
  const v = evaluateCashOut({
    balance: 1500, unconfirmedBalance: 0, expectedRemaining: REMAINING, inFlight: record(), now: NOW,
  });
  check('the recorded send is subtracted', v.effectiveBalance === 1000, v);
  check('nothing is asked for', v.state === 'in_flight', v);
  check('the record is reported back for the UI', v.inFlight?.txid === 'f'.repeat(64), v);
}

console.log('— the same money is never counted twice —');
{
  // Chain shows the spend AND the record still exists. Subtracting both would
  // read 500 and hide a surplus that is really there.
  const v = evaluateCashOut({
    balance: 1000, unconfirmedBalance: -500, expectedRemaining: REMAINING, inFlight: record(), now: NOW,
  });
  check('effective balance is 1000, not 500', v.effectiveBalance === 1000, v);
  check('still not due', v.state === 'in_flight', v);
}
{
  // A Split doubles the balance while the old transfer is still in flight:
  // 3000 on chain, 500 on its way, line at 1000 → genuinely due again.
  const v = evaluateCashOut({
    balance: 3000, unconfirmedBalance: 0, expectedRemaining: REMAINING, inFlight: record(), now: NOW,
  });
  check('a new surplus is NOT hidden by an old send', v.state === 'due', v);
  check('and what is on its way is still discounted', v.amountDue === 1500, v);
}

console.log('— a record is trusted for a day, not forever —');
{
  const justInside = evaluateCashOut({
    balance: 1500, expectedRemaining: REMAINING, inFlight: record({ sentAt: NOW - IN_FLIGHT_TRUSTED_MS + 1000 }), now: NOW,
  });
  check('23h59m old still counts', justInside.state === 'in_flight', justInside);

  const expired = evaluateCashOut({
    balance: 1500, expectedRemaining: REMAINING, inFlight: record({ sentAt: NOW - IN_FLIGHT_TRUSTED_MS - 1 }), now: NOW,
  });
  check('a day old is ignored — a transfer that never landed comes back', expired.state === 'due', expired);
  check('and the stale record is not shown as active', expired.inFlight === null, expired);
}
{
  const fromTheFuture = evaluateCashOut({
    balance: 1500, expectedRemaining: REMAINING, inFlight: record({ sentAt: NOW + 60_000 }), now: NOW,
  });
  check('a record stamped in the future is not trusted', fromTheFuture.state === 'due', fromTheFuture);
}

console.log('— rubbish in the record —');
{
  for (const [name, amount] of [['negative', -500], ['NaN', Number.NaN]] as const) {
    const v = evaluateCashOut({
      balance: 1500, expectedRemaining: REMAINING, inFlight: record({ amount: amount as number }), now: NOW,
    });
    check(`a ${name} amount cannot add money back`, v.effectiveBalance <= 1500, v);
  }
  const huge = evaluateCashOut({
    balance: 1500, expectedRemaining: REMAINING, inFlight: record({ amount: 9_999_999 }), now: NOW,
  });
  check('an absurd amount only ever silences, never charges', huge.state === 'in_flight', huge);
}

console.log('— a balance that could not be read —');
{
  for (const bad of [undefined, Number.NaN] as unknown[]) {
    const v = evaluateCashOut({ balance: bad as number, expectedRemaining: REMAINING, now: NOW });
    check(`${String(bad)} is unknown, not zero and not clear`, v.state === 'unknown', v);
  }
  const withRecord = evaluateCashOut({ balance: undefined, expectedRemaining: REMAINING, inFlight: record(), now: NOW });
  check('unknown stays unknown even with a record', withRecord.state === 'unknown', withRecord);
}

console.log('— an account that should hold nothing —');
{
  const v = evaluateCashOut({ balance: 40, expectedRemaining: 0, now: NOW });
  check('everything above zero is due', v.state === 'due' && v.amountDue === 40, v);
  const sent = evaluateCashOut({ balance: 40, expectedRemaining: 0, inFlight: record({ amount: 40 }), now: NOW });
  check('once sent, nothing is asked', sent.state === 'in_flight', sent);
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
