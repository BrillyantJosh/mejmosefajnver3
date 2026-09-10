/**
 * Who gets the Pause button on an OWN process.
 *   npx tsx scripts/testFacilitatorPause.ts
 *
 * Reported by Jasna Flis: Jure Pirc leads "Sum zlorabe cashout-a Lana8Wonder iz
 * drugih računov" and wanted to pause it for longer than 10 days. He had no
 * Pause button — only Exit — and solved it by adding Tanja Hruševar, who did
 * have one, as co-facilitator. That workaround changes who leads the process,
 * which is far more than a button is worth.
 *
 * The rule these assertions hold: the facilitator LEADING a process can pause
 * it — and nobody else gains anything.
 */
import type { Event } from 'nostr-tools';
import { toOpenProcesses, canPauseProcess } from '../src/lib/ownProcessRecords.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const JURE = 'dd1ad8c0ba351315ade75043ac38a0a2c5d38b763343fa2e1aba787a8f6f0c22';
const TANJA = '7e603d257e48e6c6d4c4004c8949e23ffd4ae0a3aac0d1365912b9ba63c990d8';
const VSEMOGOCNA = '5ca87a5083a3d9ef4293c83b20210334151f39feefbc6e85ce8a2c7f37f93365';
const MOJCA = 'f30cd0b1b582ac846bedb812062bd2a1c2d2bef88329d33a70329bed0ccc5bcf';
const GASPER = '85e31bf5f5a1b30271a4f27e5a96079419c6cef93343cc272a434409d83236ef';
const JASNA = '16a970069d63ca1f739c4e3b9a5f34bca6a93ead182dbf1e438a801aa03f4ef3';

const record = (o: { d: string; initiator: string; facilitators: string[]; participants?: string[]; guests?: string[] }): Event => ({
  id: 'e'.repeat(64),
  pubkey: o.facilitators[0],
  kind: 37044,
  created_at: 1788941650,
  tags: [
    ['d', o.d], ['status', 'open'], ['phase', 'reflection'],
    ['title', 'Sum zlorabe cashout-a Lana8Wonder iz drugih računov'],
    ['opened_at', '1788941650'],
    ['p', o.initiator, '', 'initiator'],
    ...o.facilitators.map(f => ['p', f, '', 'facilitator']),
    ...(o.participants || []).map(p => ['p', p, '', 'participant']),
    ...(o.guests || []).map(g => ['p', g, '', 'guest']),
  ],
  content: '',
  sig: '',
} as Event);

const D = 'own:dcc99a20ecf418f39e47e1417385396873260277f4cd69b4dd4e4d78ec466d5a';
const asSeenBy = (pk: string, ev: Event) => toOpenProcesses([ev], pk)[0];

console.log('— the real case: Jure leads it AND opened it —');
{
  // Exactly as it stands on the relays: Jure is tagged both initiator and
  // facilitator, so userRole reports 'initiator' and never reaches 'facilitator'.
  const live = record({ d: D, initiator: JURE, facilitators: [JURE, VSEMOGOCNA, TANJA], participants: [MOJCA], guests: [GASPER] });
  const jure = asSeenBy(JURE, live);
  check('he is on the record as its facilitator', jure.facilitators.includes(JURE), jure.facilitators);
  check('userRole calls him the initiator', jure.userRole === 'initiator', jure.userRole);
  check('and he CAN pause his own process', canPauseProcess(jure, JURE) === true);

  // The workaround must keep working, unchanged.
  check('Tanja, added as co-facilitator, still can', canPauseProcess(asSeenBy(TANJA, live), TANJA) === true);
  check('so can the co-leading being', canPauseProcess(asSeenBy(VSEMOGOCNA, live), VSEMOGOCNA) === true);
}

console.log('— before Tanja was added, he was just as much the facilitator —');
{
  const sole = record({ d: D, initiator: JURE, facilitators: [JURE], participants: [MOJCA] });
  check('a sole facilitator who opened the case can pause',
    canPauseProcess(asSeenBy(JURE, sole), JURE) === true);
  check('no co-facilitator needed for the button',
    asSeenBy(JURE, sole).facilitators.length === 1);
}

console.log('— and nobody else gains a button —');
{
  const live = record({ d: D, initiator: JASNA, facilitators: [JURE, TANJA], participants: [MOJCA], guests: [GASPER] });
  check('a participant cannot pause', canPauseProcess(asSeenBy(MOJCA, live), MOJCA) === false);
  check('a guest cannot pause', canPauseProcess(asSeenBy(GASPER, live), GASPER) === false);
  check('an initiator who does NOT lead cannot pause', canPauseProcess(asSeenBy(JASNA, live), JASNA) === false);
  check('someone with no role at all cannot pause',
    canPauseProcess(asSeenBy(JURE, live), '0'.repeat(64)) === false);
}

console.log('— the edges —');
{
  const live = record({ d: D, initiator: JURE, facilitators: [JURE, TANJA], participants: [MOJCA] });
  const p = asSeenBy(JURE, live);
  check('no process selected → no button', canPauseProcess(null, JURE) === false);
  check('not signed in → no button', canPauseProcess(p, null) === false);
  check('empty pubkey does not match an empty facilitator slot', canPauseProcess(p, '') === false);
  check('an UPPERCASE pubkey still matches', canPauseProcess(p, JURE.toUpperCase()) === true);
  // Older records carry only the singular field; it must still be honoured.
  check('a record with only the legacy `facilitator` field works',
    canPauseProcess({ facilitator: JURE, facilitators: [] }, JURE) === true);
  check('and it does not hand the button to anyone else',
    canPauseProcess({ facilitator: JURE, facilitators: [] }, MOJCA) === false);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
