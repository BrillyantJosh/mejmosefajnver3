/**
 * What an opened OWN process shows as its description.
 *   npx tsx scripts/testProcessDescription.ts
 *
 * The examples are the real shapes found on the relays, including the stale
 * stamped titles — the case that decides whether people are shown the wrong
 * subject for their own process.
 */
import {
  processDescription,
  pickProcessDescription,
  descriptionNeedsFolding,
  DESCRIPTION_FOLD_CHARS,
} from '../src/lib/processDescription.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— the stamp alone says nothing the heading does not —');
{
  const only = 'Process initiated: Zloraba sistema in zaupanja, zavajanje in spodkopavanje skupnosti';
  check('nothing to show', processDescription(only) === '', processDescription(only));
  check('nothing to fold', !descriptionNeedsFolding(processDescription(only)));
}

console.log('— a STALE stamped title must never be shown as the subject —');
{
  // Live case: the title tag reads "Andrej, Boštjan, Gregor in Rok …" while the
  // content still stamps the older "Andrej, Boštjan in Gregor …".
  const stale = 'Process initiated: Andrej, Boštjan in Gregor: komunikacija, meje in samoodgovornost';
  check('dropped, not printed', processDescription(stale) === '', processDescription(stale));
  check('no trace of the old title', !processDescription(stale).includes('Gregor'));
}

console.log('— the stamp plus a real description keeps the description —');
{
  const real = 'Process initiated: Sum zlorabe cashout-a\n\nAnaliza transakcij kaže na vzorec.\n\nRačun\tPosredovano\nIvicaT\t515,79 LANA';
  const out = processDescription(real);
  check('stamp is gone', !out.startsWith('Process initiated'), out.slice(0, 40));
  check('description survives whole', out.startsWith('Analiza transakcij'), out.slice(0, 40));
  check('the table lines survive', out.includes('IvicaT\t515,79 LANA'));
  check('folded behind "more"', descriptionNeedsFolding(out));
}

console.log('— an unstamped description is shown as written —');
{
  const plain = 'Primož kot član skupnosti in imetnik L8W se je želel vključiti med nove vlagatelje.';
  check('untouched', processDescription(plain) === plain);
}

console.log('— folding —');
{
  check('short single line stays open', !descriptionNeedsFolding('Kratek opis.'));
  check('any newline folds', descriptionNeedsFolding('Prva vrstica\nDruga vrstica'));
  check(`over ${DESCRIPTION_FOLD_CHARS} chars folds`, descriptionNeedsFolding('a'.repeat(DESCRIPTION_FOLD_CHARS + 1)));
  check('exactly at the limit stays open', !descriptionNeedsFolding('a'.repeat(DESCRIPTION_FOLD_CHARS)));
}

console.log('— nothing at all —');
{
  check('empty', processDescription('') === '');
  check('null', processDescription(null) === '');
  check('undefined', processDescription(undefined) === '');
  check('whitespace only', processDescription('   \n  ') === '');
  check('stamp with trailing blank lines', processDescription('Process initiated: X\n\n   \n') === '');
}

console.log('— the editable record outranks the original —');
{
  // The live shape today: KIND 87044 carries the initiator's reasoning while
  // the KIND 37044 record carries only "Process initiated: <title>".
  const caseText = 'Proces se odpira zaradi naslednjih ravnanj, ki odpirajo vprašanje iskrenih namenov.';
  const stamped = 'Process initiated: Zloraba sistema in zaupanja';
  check('a stamped record yields to the case', pickProcessDescription(caseText, stamped) === caseText);

  // Once a facilitator edits it on selfresponsible.life, the record must win —
  // a refined wording cannot be overruled by the original.
  const edited = 'Dopolnjen opis, ki ga je uredil fasilitator.';
  check('an edited record wins', pickProcessDescription(caseText, edited) === edited);
  check('even over a longer case text',
    pickProcessDescription(caseText + ' '.repeat(50) + 'še več', edited) === edited);

  check('no case → the record alone', pickProcessDescription('', edited) === edited);
  check('no record → the case alone', pickProcessDescription(caseText, '') === caseText);
  check('stamped record and no case → nothing', pickProcessDescription('', stamped) === '');
  check('neither → nothing', pickProcessDescription(null, null) === '');
}

console.log('— ciphertext is never shown —');
{
  const nip04 = 'Zm9vYmFyYmF6cXV4' + '?iv=YWJjZGVmZ2hpamtsbW5vcA==';
  check('encrypted case → nothing', processDescription(nip04) === '', processDescription(nip04));
  check('and no fallback to it', pickProcessDescription(nip04, '') === '');
  check('a plain sentence with a question mark still shows',
    processDescription('Zakaj je to storil? Ne vem.') === 'Zakaj je to storil? Ne vem.');
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
