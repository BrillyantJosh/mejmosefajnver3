/**
 * Counting the votes on an alignment.
 *   npx tsx scripts/testAlignmentTally.ts
 *
 * These assertions are mostly about votes that must NOT be counted, and about
 * people who must not be counted twice — the two ways a published tally lies.
 */
import { parseAck, slugFromAckDTag, proposalSlug, tallyAcks, outcomeOf, type AckEvent } from '../src/lib/alignmentTally.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const ANA = 'a'.repeat(64);
const BOR = 'b'.repeat(64);
const CIT = 'c'.repeat(64);
const SLUG = 'alignment-mt8gxvfu-pshu31';

let seq = 0;
function ack(pubkey: string, choice: string, opts: Partial<{ slug: string; at: number; comment: string; d: string; id: string }> = {}): AckEvent {
  const slug = opts.slug ?? SLUG;
  return {
    id: opts.id ?? `id${++seq}`.padEnd(8, '0'),
    pubkey,
    created_at: opts.at ?? 1_700_000_000,
    content: opts.comment ?? '',
    tags: [
      ['d', opts.d ?? `ack:${slug}:${pubkey}`],
      ['ack', choice],
      ['e', 'whatever-version-of-the-proposal'],
    ],
  };
}

console.log('— reading the d tag —');
{
  check('ack:<slug>:<hex> yields the slug', slugFromAckDTag(`ack:${SLUG}:${ANA}`) === SLUG);
  check('a slug carrying colons survives', slugFromAckDTag('ack:a:b:c:' + ANA) === 'a:b:c');
  check('no voter hex is still a readable slug', slugFromAckDTag('ack:' + SLUG) === SLUG);
  check('a proposal d tag is not a vote', slugFromAckDTag('awareness:' + SLUG) === null);
  check('empty is not a vote', slugFromAckDTag('') === null);
  check('proposalSlug strips the awareness prefix', proposalSlug('awareness:' + SLUG) === SLUG);
  check('proposalSlug leaves a bare slug alone', proposalSlug(SLUG) === SLUG);
}

console.log('— what counts as a vote —');
{
  check('yes counts', parseAck(ack(ANA, 'yes'))?.choice === 'yes');
  check('resistance counts', parseAck(ack(ANA, 'resistance'))?.choice === 'resistance');
  check('an unknown word is NOT read as consent', parseAck(ack(ANA, 'maybe')) === null);
  check('an empty ack is not a vote', parseAck(ack(ANA, '')) === null);
  check('YES in capitals is not silently accepted', parseAck(ack(ANA, 'YES')) === null);
  const noD = { id: 'x', pubkey: ANA, created_at: 1, content: '', tags: [['ack', 'yes']] };
  check('no d tag, no vote', parseAck(noD) === null);
  check('the comment is carried', parseAck(ack(ANA, 'yes', { comment: '  I stand with this  ' }))?.comment === 'I stand with this');
}

console.log('— one person, one vote —');
{
  const t = tallyAcks([
    ack(ANA, 'yes', { at: 100 }),
    ack(ANA, 'resistance', { at: 200 }),   // changed their mind
    ack(BOR, 'yes', { at: 150 }),
  ]).get(SLUG)!;
  check('the newest vote is the one that counts', t.resisted.length === 1 && t.accepted.length === 1, t);
  check('the person is counted once, not twice', t.total === 2, t.total);
  check('the superseded yes is gone', t.accepted[0].pubkey === BOR, t.accepted);
}

console.log('— the vote belongs to whoever SIGNED it —');
{
  // Ana writes Bor's hex into her own d tag; the signature is still hers.
  const t = tallyAcks([
    ack(ANA, 'yes', { d: `ack:${SLUG}:${BOR}` }),
    ack(BOR, 'resistance'),
  ]).get(SLUG)!;
  check('a forged d tag does not become a second person', t.total === 2, t.total);
  check("Ana's vote is filed under Ana", t.accepted[0].pubkey === ANA, t.accepted[0]);
}
{
  // Stuffing: one person, many invented d tags, all signed by the same key.
  const stuffed = tallyAcks([
    ack(CIT, 'yes', { d: `ack:${SLUG}:${'1'.repeat(64)}`, at: 10 }),
    ack(CIT, 'yes', { d: `ack:${SLUG}:${'2'.repeat(64)}`, at: 20 }),
    ack(CIT, 'yes', { d: `ack:${SLUG}:${'3'.repeat(64)}`, at: 30 }),
  ]).get(SLUG)!;
  check('a hundred events from one key are still one vote', stuffed.total === 1, stuffed.total);
}

console.log('— votes cast against an older version of the proposal —');
{
  const older: AckEvent = { ...ack(ANA, 'yes'), tags: [['d', `ack:${SLUG}:${ANA}`], ['ack', 'yes'], ['e', 'the-first-version']] };
  const newer: AckEvent = { ...ack(BOR, 'yes'), tags: [['d', `ack:${SLUG}:${BOR}`], ['ack', 'yes'], ['e', 'the-fourth-version']] };
  const t = tallyAcks([older, newer]).get(SLUG)!;
  check('both are counted, whichever version they answered', t.accepted.length === 2, t.accepted.length);
}

console.log('— votes are kept apart by proposal —');
{
  const all = tallyAcks([
    ack(ANA, 'yes', { slug: 'alignment-one' }),
    ack(ANA, 'resistance', { slug: 'alignment-two' }),
  ]);
  check('two proposals, two tallies', all.size === 2, [...all.keys()]);
  check('the yes stays on the first', all.get('alignment-one')!.accepted.length === 1);
  check('the resistance stays on the second', all.get('alignment-two')!.resisted.length === 1);
}

console.log('— the outcome —');
{
  check('any resistance makes it resisted', outcomeOf(50, 1) === 'resisted');
  check('acceptance with no resistance is aligned', outcomeOf(22, 0) === 'aligned');
  check('nobody voted is neither', outcomeOf(0, 0) === 'no_votes');
  check('resistance alone is resisted', outcomeOf(0, 3) === 'resisted');
  const t = tallyAcks([ack(ANA, 'resistance'), ack(BOR, 'yes')]).get(SLUG)!;
  check('one resistance among many decides the tally', t.outcome === 'resisted', t.outcome);
}

console.log('— a tie in time —');
{
  const t = tallyAcks([
    ack(ANA, 'yes', { at: 500, id: 'aaa' }),
    ack(ANA, 'resistance', { at: 500, id: 'zzz' }),
  ]).get(SLUG)!;
  check('same second, same answer every run', t.resisted.length === 1 && t.total === 1, t);
}

console.log('— nothing at all —');
{
  check('no events, no tallies', tallyAcks([]).size === 0);
  check('rubbish in, nothing out', tallyAcks([{ id: 'x', pubkey: '', created_at: 0, content: '', tags: [] }]).size === 0);
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
