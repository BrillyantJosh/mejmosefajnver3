/**
 * Which OWN processes a person is still shown.
 *   npx tsx scripts/testOpenProcessList.ts
 *
 * The records below are the real ones on the relays on 10 September 2026 —
 * including the two that were reported as "still showing after we ended it".
 * One list feeds three screens (/own, /own/todo, /own/exit), so an ending that
 * fails to land here fails on all three at once: /own/todo goes on asking
 * people for steps in a case that is over, which is the one that does harm.
 */
import type { Event } from 'nostr-tools';
import { toOpenProcesses, isRunningStatus, newestPerProcess } from '../src/lib/ownProcessRecords.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const JASNA = '16a970069d63ca1f739c4e3b9a5f34bca6a93ead182dbf1e438a801aa03f4ef3';
const IGNAC = '9b8824cb16cb0ec6cd55ec5ac4eadfe3e1e7e0a45edd98e0a3569b606848eb39';
const GASPER = '85e31bf5f5a1b30271a4f27e5a96079419c6cef93343cc272a434409d83236ef';
const BOSTJAN = '7886315aca1dff7aed7d2049bc81106aac5f5fbbeffa432d2d1470a22271d03b';
const PRIMOZ = '65b70c846f134d1193f026329bb6db1979a7bc0191fb146021c2a9a0ee0e9b2d';
const JURE = 'dd1ad8c0ba351315ade75043ac38a0a2c5d38b763343fa2e1aba787a8f6f0c22';
const TANJA = '7e603d257e48e6c6d4c4004c8949e23ffd4ae0a3aac0d1365912b9ba63c990d8';
const VSEMOGOCNA = '5ca87a5083a3d9ef4293c83b20210334151f39feefbc6e85ce8a2c7f37f93365';
const MOJCA = 'f30cd0b1b582ac846bedb812062bd2a1c2d2bef88329d33a70329bed0ccc5bcf';

let seq = 0;
const ev = (o: {
  d: string; author: string; created_at: number; status: string; phase: string;
  title: string; initiator?: string; facilitators?: string[]; participants?: string[];
  guests?: string[]; handoverTo?: string; openedAt?: number;
}): Event => {
  const tags: string[][] = [
    ['d', o.d],
    ['status', o.status],
    ['phase', o.phase],
    ['title', o.title],
    ['opened_at', String(o.openedAt ?? o.created_at)],
  ];
  if (o.initiator) tags.push(['p', o.initiator, '', 'initiator']);
  for (const f of o.facilitators || []) tags.push(['p', f, '', 'facilitator']);
  for (const p of o.participants || []) tags.push(['p', p, '', 'participant']);
  for (const g of o.guests || []) tags.push(['p', g, '', 'guest']);
  if (o.handoverTo) tags.push(['handover_to', o.handoverTo]);
  return {
    id: `evt${++seq}`.padEnd(64, '0'),
    pubkey: o.author,
    kind: 37044,
    created_at: o.created_at,
    tags,
    content: '',
    sig: '',
  } as Event;
};

// --- The case Tanja reported ------------------------------------------------
// own:6025c260… "Boštjan in Primož", handed on twice and finally CLOSED by
// Gašper on 6.9.2026. The closing record is the only one with no handover_to.
const D_BOSTJAN = 'own:6025c260c77acac33da957be7de64d77f637f2ddd381af9c02067eb14ff83da4';
const bostjanPrimoz = [
  ev({ d: D_BOSTJAN, author: JASNA, created_at: 1783345133, status: 'open', phase: 'opening',
       title: 'Boštjan in Primož: osebni spor in javno blatenje',
       initiator: JASNA, facilitators: [JASNA], participants: [BOSTJAN, PRIMOZ], handoverTo: IGNAC }),
  ev({ d: D_BOSTJAN, author: IGNAC, created_at: 1786629905, status: 'open', phase: 'change',
       title: 'Boštjan in Primož: osebni spor in javno blatenje',
       initiator: JASNA, facilitators: [IGNAC], participants: [BOSTJAN, PRIMOZ], handoverTo: GASPER }),
  ev({ d: D_BOSTJAN, author: GASPER, created_at: 1788715681, status: 'closed', phase: 'resolution',
       title: 'Boštjan in Primož: osebni spor in javno blatenje',
       initiator: JASNA, facilitators: [GASPER, VSEMOGOCNA], participants: [BOSTJAN, PRIMOZ] }),
];

// --- The process terminated on 10.9.2026 ------------------------------------
// No handover anywhere: the SAME author simply republished the record as
// 'terminated'. Nothing but the ordering can tell these two apart.
const D_ZLORABA = 'own:1dba81d818a80a1680c33dc5dcd066c581c128558f53837c0a24e759bd75f829';
const terminated = [
  ev({ d: D_ZLORABA, author: JASNA, created_at: 1788417618, status: 'open', phase: 'reflection',
       title: 'Zloraba sistema in zaupanja', initiator: JASNA,
       facilitators: [JASNA], participants: [IGNAC], guests: [GASPER] }),
  ev({ d: D_ZLORABA, author: JASNA, created_at: 1789045410, status: 'terminated', phase: 'reflection',
       title: 'Zloraba sistema in zaupanja', initiator: JASNA,
       facilitators: [JASNA], participants: [IGNAC], guests: [GASPER] }),
];

// --- A process that really is running ---------------------------------------
const D_CASHOUT = 'own:dcc99a20ecf418f39e47e1417385396873260277f4cd69b4dd4e4d78ec466d5a';
const running = [
  ev({ d: D_CASHOUT, author: JURE, created_at: 1788941650, status: 'open', phase: 'reflection',
       title: 'Sum zlorabe cashout-a Lana8Wonder iz drugih računov',
       initiator: JURE, facilitators: [JURE, VSEMOGOCNA, TANJA], participants: [MOJCA], guests: [GASPER] }),
];

const all = [...bostjanPrimoz, ...terminated, ...running];
const idsFor = (pk: string) => toOpenProcesses(all, pk).map(p => p.id);

console.log('— a CLOSED process is gone, however many open records precede it —');
{
  for (const [who, pk] of [['Boštjan', BOSTJAN], ['Primož', PRIMOZ], ['Jasna (initiator)', JASNA], ['Gašper (facilitator)', GASPER]] as const) {
    check(`${who} no longer sees it`, !idsFor(pk).includes(D_BOSTJAN), idsFor(pk));
  }
  // Shuffled: the answer may not depend on which relay answered first.
  const reversed = toOpenProcesses([...all].reverse(), BOSTJAN).map(p => p.id);
  check('and not in reverse arrival order either', !reversed.includes(D_BOSTJAN), reversed);
}

console.log('— a TERMINATED process is an ending too, not just "closed" —');
{
  for (const [who, pk] of [['Jasna', JASNA], ['Ignac (participant)', IGNAC], ['Gašper (guest)', GASPER]] as const) {
    check(`${who} no longer sees it`, !idsFor(pk).includes(D_ZLORABA), idsFor(pk));
  }
  check('terminated is not a running status', !isRunningStatus('terminated'));
  check('closed is not a running status', !isRunningStatus('closed'));
}

console.log('— only an ending somebody WROTE may remove a process —');
{
  // The status test now rests on one record instead of on whichever record
  // happened to survive, so a record with no status tag must not read as ended.
  const D_NOSTATUS = 'own:nostatus000000000000000000000000000000000000000000000000000';
  const noStatus = ev({ d: D_NOSTATUS, author: JASNA, created_at: 1788000000, status: '', phase: 'change',
    title: 'Brez oznake stanja', initiator: JASNA, facilitators: [JASNA], participants: [MOJCA] });
  noStatus.tags = noStatus.tags.filter(t => t[0] !== 'status');
  check('a missing status tag keeps the process listed',
    toOpenProcesses([noStatus], MOJCA).some(p => p.id === D_NOSTATUS));
  check('an unwritten status is running', isRunningStatus(''));
  // But an ending still wins over an older tagless record.
  const ended = ev({ d: D_NOSTATUS, author: JASNA, created_at: 1789000000, status: 'terminated',
    phase: 'change', title: 'Brez oznake stanja', initiator: JASNA, facilitators: [JASNA], participants: [MOJCA] });
  check('and a later ending still removes it',
    !toOpenProcesses([noStatus, ended], MOJCA).some(p => p.id === D_NOSTATUS));
}

console.log('— what is genuinely running still shows —');
{
  for (const [who, pk] of [['Jure', JURE], ['Tanja', TANJA], ['Mojca (participant)', MOJCA]] as const) {
    check(`${who} still sees the cash-out process`, idsFor(pk).includes(D_CASHOUT), idsFor(pk));
  }
  check('and nothing else is left over', idsFor(JURE).length === 1, idsFor(JURE));
  check('somebody with no role in anything sees nothing',
    toOpenProcesses(all, '0'.repeat(64)).length === 0);
}

console.log('— a PAUSE is not an ending (the Mojca case, 30.8.2026) —');
{
  const D_PAUSED = 'own:paused0000000000000000000000000000000000000000000000000000000';
  const paused = [
    ev({ d: D_PAUSED, author: JASNA, created_at: 1786000000, status: 'open', phase: 'change',
         title: 'Mojca', initiator: JASNA, facilitators: [JASNA], participants: [MOJCA] }),
    ev({ d: D_PAUSED, author: JASNA, created_at: 1787000000, status: 'paused', phase: 'change',
         title: 'Mojca', initiator: JASNA, facilitators: [JASNA], participants: [MOJCA] }),
  ];
  const mine = toOpenProcesses([...all, ...paused], MOJCA);
  check('the paused process is still listed', mine.some(p => p.id === D_PAUSED), mine.map(p => p.id));
  check('and it still says paused, so the amber badge can show',
    mine.find(p => p.id === D_PAUSED)?.status === 'paused');
  check('paused IS a running status', isRunningStatus('paused'));
  // A pause published by the facilitator while an older 'open' record is still
  // on the relays must not be undone by that older record.
  check('the pause is not overridden by the older open record',
    toOpenProcesses([...paused].reverse(), MOJCA).find(p => p.id === D_PAUSED)?.status === 'paused');
}

console.log('— a handover still names the CURRENT facilitator —');
{
  // Same case as above, but before Gašper closed it: two records, the newer one
  // superseded (it carries handover_to), so the authoritative one must win.
  const midHandover = [bostjanPrimoz[0], bostjanPrimoz[1],
    ev({ d: D_BOSTJAN, author: GASPER, created_at: 1786700000, status: 'open', phase: 'change',
         title: 'Boštjan in Primož: osebni spor in javno blatenje',
         initiator: JASNA, facilitators: [GASPER], participants: [BOSTJAN, PRIMOZ] })];
  const one = toOpenProcesses(midHandover, BOSTJAN);
  check('exactly one row per process', one.length === 1, one.map(p => p.id));
  check('led by Gašper, who accepted it', one[0]?.facilitator === GASPER, one[0]?.facilitator);
  check('not by Ignac, who handed it on', one[0]?.facilitator !== IGNAC);
  // Only superseded records left (the new facilitator has not published yet):
  // the newest offer wins rather than the oldest.
  const onlyHandovers = toOpenProcesses([bostjanPrimoz[0], bostjanPrimoz[1]], BOSTJAN);
  check('with only handover records, the newest one is used',
    onlyHandovers[0]?.facilitator === IGNAC, onlyHandovers[0]?.facilitator);
}

console.log('— the header warning reads the same pile, and must not stay lit —');
{
  // /check-own-active + /check-header-warnings + useOwnActiveProcess test
  // `status === 'open'` on EVERY record. Without the dedup, the ended cases
  // above keep the badge on through their older records.
  const newest = newestPerProcess(all);
  check('one record per process survives', newest.length === 3, newest.length);
  const statusOf = (d: string) =>
    newest.find(e => e.tags.find(t => t[0] === 'd')?.[1] === d)?.tags.find(t => t[0] === 'status')?.[1];
  check('the closed case is represented by its ending', statusOf(D_BOSTJAN) === 'closed', statusOf(D_BOSTJAN));
  check('the terminated case likewise', statusOf(D_ZLORABA) === 'terminated', statusOf(D_ZLORABA));
  check('the running one is still open', statusOf(D_CASHOUT) === 'open', statusOf(D_CASHOUT));
  check('so exactly one process would light the badge',
    newest.filter(e => e.tags.find(t => t[0] === 'status')?.[1] === 'open').length === 1);
  check('arrival order does not change that',
    newestPerProcess([...all].reverse()).filter(e => e.tags.find(t => t[0] === 'status')?.[1] === 'open').length === 1);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
