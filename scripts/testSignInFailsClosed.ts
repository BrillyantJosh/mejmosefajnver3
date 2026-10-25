/**
 * Sign-in never goes through on an exclusion check that did not happen.
 * Brilly, 25. 10. 2026: "Nikakor se ne sme imeti možnosti se logirati dokler je izključen".
 *
 * checkGrossViolationFreeze answers "unread" when it could not read the relays at all
 * (none listed, no signer list, no relay answered, the read failed); sign-in refuses on it.
 * Relays that answered and hold no registry record for a person are an answer, not "unread".
 *   npx tsx scripts/testSignInFailsClosed.ts            (offline checks)
 *   LIVE=1 npx tsx scripts/testSignInFailsClosed.ts     (+ read-only checks against the real Lana relays)
 */
import { readFileSync } from 'node:fs';
import { checkGrossViolationFreeze } from '../src/lib/ownFreezeGate.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const someone = 'ab'.repeat(32);

console.log('— a check that could not read is "unread", never "not excluded" —');
{
  const none = await checkGrossViolationFreeze(someone, []);
  check('no relays at all → unread', none.frozen === false && none.unread === true, none);
  const dead = await checkGrossViolationFreeze(someone, ['ws://127.0.0.1:1']);
  check('a relay that cannot be reached → unread', dead.frozen === false && dead.unread === true, dead);
}

console.log('— the code —');
{
  const gate = readFileSync(new URL('../src/lib/ownFreezeGate.ts', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/contexts/AuthContext.tsx', import.meta.url), 'utf8');
  const notFrozen = gate.match(/\{ frozen: false, unknown: true(, unread: true)? \}/g) || [];
  check('five "could not tell" answers: four are "unread", one (relays answered, no registry record) is not',
    notFrozen.length === 5 && notFrozen.filter((x) => x.includes('unread')).length === 4, notFrozen);
  check('the one without "unread" is the "no record from the registrar" answer',
    /if \(trusted\.length === 0\) \{\s*return cached\?\.frozen \? \{ \.\.\.cached \} : \{ frozen: false, unknown: true \};/.test(gate));
  const login = auth.slice(auth.indexOf('const login = async'), auth.indexOf('let profileFields'));
  check('sign-in refuses on "frozen" and then on "unread", before anything else happens',
    /if \(gate\.frozen\) \{[\s\S]*?throw new FrozenOutError\(gate\);\s*\}[\s\S]*?if \(gate\.unread\) \{[\s\S]*?throw new Error\(/.test(login), login.slice(0, 400));
}

if (process.env.LIVE) {
  console.log('— read-only, the real relays —');
  const relays = ['wss://relay.lanavault.space', 'wss://relay.lana-eternity.com', 'wss://relay.lanaheartvoice.com', 'wss://relay.lovelana.org'];
  const excluded = await checkGrossViolationFreeze(process.env.EXCLUDED_HEX || '', relays);
  check('a person under a decision → frozen (sign-in refused)', excluded.frozen === true, excluded);
  const member = await checkGrossViolationFreeze(process.env.MEMBER_HEX || '', relays);
  check('a member in good standing → not frozen and not unread (sign-in goes on)', member.frozen === false && !member.unread, member);
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
