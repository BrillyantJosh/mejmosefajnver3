/**
 * Pure-logic tests for the shared duplicate matcher.
 *   npx tsx scripts/testUnconditionalPaymentGuard.ts
 *
 * The scenarios are real ones read off the relays (14 108 KIND 90900 /
 * 8 157 KIND 90901, 377 payers), not invented:
 *   - payer c895854d paid five 2026-05 proposals twice, 31 minutes apart,
 *     the second transaction quoting the SAME d-tags → must block;
 *   - payer 6ae127d1 had two proposals for lanaheartvoice in 2026-02 and paid
 *     each separately → must block;
 *   - payer 9b1267aa paid the 2026-07 bill late on 2026-08-08 15:09 and the
 *     2026-08 bill at 06:06 next morning → two legitimate months, must NOT
 *     block. This one is why "paid recently" cannot be the rule.
 */
import {
  findDuplicateConfirmations,
  confirmationPaidAt,
  billingMonthOfDTag,
  type SelectedObligation,
  type ConfirmationEvent,
} from '../src/lib/unconditionalPaymentGuard.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail).slice(0, 240)}`);
  if (!cond) failures++;
};

const secondsOf = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const obligation = (over: Partial<SelectedObligation> = {}): SelectedObligation => ({
  proposalId: 'ev-new',
  proposalDTag: 'sub:lana:1780016130869:c895854', // 2026-05
  recipientWallet: 'LYWG1EkE6gCMMLSg13xY3SwVy8kWJqEbVJ',
  service: 'https://selfresponsible.life/',
  proposalCreatedAt: secondsOf('2026-05-29T01:35:00Z'),
  ...over,
});

const confirmation = (tag: Record<string, string> = {}, over: Partial<ConfirmationEvent> = {}): ConfirmationEvent => {
  const base: Record<string, string> = {
    proposal: 'sub:lana:1780016130869:c895854',
    to_wallet: 'LYWG1EkE6gCMMLSg13xY3SwVy8kWJqEbVJ',
    service: 'https://selfresponsible.life/',
    tx: '42b03f220d130a19'.padEnd(64, '0'),
    ...tag,
  };
  return {
    id: 'conf-1',
    created_at: secondsOf('2026-06-19T18:43:00Z'),
    tags: Object.entries(base).map(([k, v]) => (k === 'e' ? ['e', v, '', 'proposal'] : [k, v])),
    ...over,
  };
};

console.log('— d-tag → subscription month —');
check('legacy sub:lana:<ms> → month', billingMonthOfDTag('sub:lana:1780016130869:c895854') === '2026-05', billingMonthOfDTag('sub:lana:1780016130869:c895854'));
check('legacy pay:lana:<ms> → month', billingMonthOfDTag('pay:lana:1763827817626:b1f4a8a9') === '2025-11', billingMonthOfDTag('pay:lana:1763827817626:b1f4a8a9'));
// The deterministic form the generator emits now: sub:lana:<YYYY-MM>:<payer8>:<service12>
check('deterministic sub:lana:<YYYY-MM> → month', billingMonthOfDTag('sub:lana:2026-08:9b1267aa:a1b2c3d4e5f6') === '2026-08', billingMonthOfDTag('sub:lana:2026-08:9b1267aa:a1b2c3d4e5f6'));
check('registrar d-tag → unknown', billingMonthOfDTag('registrar:subscription:9b1267aa:2026') === '');
check('empty → unknown', billingMonthOfDTag('') === '');
{
  // A legacy proposal and a deterministic one for the same month must be
  // recognised as the same obligation — that is the migration month.
  const legacy = obligation({ proposalDTag: 'sub:lana:1786234692018:9b1267aa', proposalCreatedAt: 0 }); // 2026-08
  const deterministic = confirmation({ proposal: 'sub:lana:2026-08:9b1267aa:a1b2c3d4e5f6' });
  check('legacy and deterministic d-tags meet in the same month',
    findDuplicateConfirmations([legacy], [deterministic]).length === 1);
}

console.log('— real double payment: same proposal, two transactions 31 min apart (c895854d) —');
{
  const m = findDuplicateConfirmations([obligation()], [confirmation()]);
  check('second attempt blocked', m.length === 1 && m[0].via === 'proposal reference', m);
  check('reports the existing txid', m[0]?.txId.startsWith('42b03f22'), m[0]?.txId);
}
{
  const m = findDuplicateConfirmations([obligation({ proposalDTag: 'x', proposalId: 'ev-old' })], [confirmation({ e: 'ev-old' })]);
  check('matched by proposal event id too', m.length === 1, m);
}

console.log('— real double payment: two proposals for ONE month (6ae127d1, 2026-02) —');
{
  const feb = { service: 'wss://relay.lanaheartvoice.com', wallet: 'LiAE7g1XUzXVYfT8KPCJNLYFjyieLYVbxe' };
  const second = obligation({
    proposalDTag: 'sub:lana:1771376255406:6ae127d1', // 2026-02-18
    proposalCreatedAt: secondsOf('2026-02-18T00:57:00Z'),
    service: feb.service,
    recipientWallet: feb.wallet,
  });
  const paidFirst = confirmation({
    proposal: 'sub:lana:1771318399276:6ae127d1', // 2026-02-17, same month
    service: feb.service,
    to_wallet: feb.wallet,
    tx: '3a786a94229e0918'.padEnd(64, '0'),
  }, { created_at: secondsOf('2026-02-17T09:00:00Z') });

  const m = findDuplicateConfirmations([second], [paidFirst]);
  check('duplicate proposal for the same month blocked', m.length === 1 && m[0].via.includes('same subscription month'), m);
}

console.log('— MUST NOT block: last month paid late, this month minted hours later (9b1267aa) —');
{
  const august = obligation({
    proposalDTag: 'sub:lana:1786234692018:9b1267aa', // 2026-08-09 00:18
    proposalCreatedAt: secondsOf('2026-08-09T00:18:12Z'),
    service: 'Lana Realm',
    recipientWallet: 'LaqqtQDvBmEaUFEbkvqvsLGxUChBYJJ7D9',
  });
  const julyPaid = confirmation({
    proposal: 'sub:lana:1784420178390:9b1267aa', // 2026-07-19 proposal
    service: 'Lana Realm',
    to_wallet: 'LaqqtQDvBmEaUFEbkvqvsLGxUChBYJJ7D9',
    tx: 'bbea05f8035007cc'.padEnd(64, '0'),
  }, { created_at: secondsOf('2026-08-08T15:09:40Z') }); // paid 9h BEFORE the August mint

  const m = findDuplicateConfirmations([august], [julyPaid]);
  check("August bill stays payable after July's late payment", m.length === 0, m);
}

console.log('— other legitimate cases must stay payable —');
// These probe Rule B only, so the confirmation must reference a DIFFERENT
// proposal (same month) — otherwise Rule A rightly matches on the d-tag.
const OTHER_D_SAME_MONTH = 'sub:lana:1780016199853:c895854'; // also 2026-05
{
  const m = findDuplicateConfirmations([obligation()], [confirmation({ proposal: OTHER_D_SAME_MONTH, service: 'lanawatch.us' })]);
  check('different service on the same wallet', m.length === 0, m);
}
{
  const m = findDuplicateConfirmations([obligation()], [confirmation({ proposal: OTHER_D_SAME_MONTH, to_wallet: 'LTpv5j4NYmzVF4LPKC6irwc4xvAZkfXjEg' })]);
  check('different wallet, same service', m.length === 0, m);
}
{
  const m = findDuplicateConfirmations([obligation({ service: '' })], [confirmation({ proposal: OTHER_D_SAME_MONTH, service: '' })]);
  check('empty service never matches Rule B', m.length === 0, m);
}
{
  const m = findDuplicateConfirmations([obligation()], [confirmation({ proposal: OTHER_D_SAME_MONTH })]);
  check('duplicate proposal, same month, same service+wallet → blocked', m.length === 1, m);
}
{
  const undatable = confirmation({ proposal: 'registrar:subscription:c895854:2026' });
  const m = findDuplicateConfirmations([obligation({ proposalDTag: 'other' })], [undatable]);
  check('undatable d-tag stands down instead of blocking', m.length === 0, m);
}

console.log('— timestamp_paid beats a re-signed created_at —');
{
  const ev = confirmation({ timestamp_paid: String(secondsOf('2026-06-19T18:43:00Z')) }, { created_at: secondsOf('2026-06-25T10:00:00Z') });
  check('confirmationPaidAt prefers timestamp_paid', confirmationPaidAt(ev) === secondsOf('2026-06-19T18:43:00Z'), confirmationPaidAt(ev));
}

console.log('— batch semantics —');
{
  const items = [obligation(), obligation({ proposalId: 'ev-other', proposalDTag: 'sub:lana:1780016145573:c895854', service: 'wss://relay.lanaheartvoice.com', recipientWallet: 'LiAE7g1XUz' })];
  const m = findDuplicateConfirmations(items, [confirmation()]);
  check('only the settled item matches; the rest of the batch survives', m.length === 1 && m[0].obligation.proposalId === 'ev-new', m);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
