/**
 * How an OWN case description is laid out.
 *   npx tsx scripts/testRichText.ts
 *
 * The shapes are the ones that actually occur in the eight case texts on the
 * relays: blank-line paragraphs, "*" bullets, tab-separated rows and links.
 */
import { parseRichText, parseSegments } from '../src/lib/richText.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

console.log('— the live case: a lead paragraph, then starred points —');
{
  const blocks = parseRichText(
    'Proces se odpira zaradi naslednjih ravnanj:\n\n' +
    '* Namerna uporaba oz. zloraba svojega bitja Justiq.\n' +
    '* Izstavljanje namišljenih računov za Lanac d.o.o.\n' +
    '* Način nagovarjanja in izkrivljene informacije.'
  );
  check('two blocks', blocks.length === 2, blocks.map(b => b.kind));
  check('first is a paragraph', blocks[0].kind === 'paragraph');
  check('second is a list', blocks[1].kind === 'list');
  check('three bullets', blocks[1].kind === 'list' && blocks[1].items.length === 3);
  check('the star is gone from the text',
    blocks[1].kind === 'list' && !JSON.stringify(blocks[1].items).includes('*'));
}

console.log('— blank lines make paragraphs, single breaks do not —');
{
  const blocks = parseRichText('Prva vrstica\nDruga vrstica\n\nNov odstavek');
  check('two paragraphs', blocks.length === 2, blocks.length);
  check('first keeps both its lines', blocks[0].kind === 'paragraph' && blocks[0].lines.length === 2);
  check('second has one', blocks[1].kind === 'paragraph' && blocks[1].lines.length === 1);
}

console.log('— tab-separated figures become columns —');
{
  const blocks = parseRichText('Račun\tPosredovano\nIvicaT\t515,79 LANA\nMihaF\t431,97 LANA');
  check('one table', blocks.length === 1 && blocks[0].kind === 'table');
  check('three rows', blocks[0].kind === 'table' && blocks[0].rows.length === 3);
  check('two cells each', blocks[0].kind === 'table' && blocks[0].rows.every(r => r.length === 2));
  // The live table has one malformed row with five cells — it must not throw
  // the whole block away.
  const ragged = parseRichText('a\tb\tc\td\te\nf\tg');
  check('ragged rows survive', ragged[0].kind === 'table' && ragged[0].rows[0].length === 5);
}

console.log('— links —');
{
  const segs = parseSegments('Glej https://lana.is/x in konec.');
  check('three segments', segs.length === 3, segs);
  check('the middle is a link', segs[1].kind === 'link');
  check('address is clean', segs[1].kind === 'link' && segs[1].href === 'https://lana.is/x', segs[1]);
  const dotted = parseSegments('Vir: https://lana.is/a.');
  check('a trailing full stop is not part of the address',
    dotted[1].kind === 'link' && dotted[1].href === 'https://lana.is/a', dotted[1]);
  // Only http(s) is ever turned into something clickable.
  const nasty = parseSegments('javascript:alert(1) and data:text/html,x');
  check('javascript: is plain text', nasty.every(s => s.kind === 'text'), nasty);
}

console.log('— nothing, and nothing surprising —');
{
  check('empty', parseRichText('').length === 0);
  check('null', parseRichText(null).length === 0);
  check('whitespace', parseRichText('  \n\n  ').length === 0);
  const dashes = parseRichText('- ena\n- dve');
  check('a dash bullets too', dashes[0].kind === 'list' && dashes[0].items.length === 2);
  const dot = parseRichText('• ena');
  check('a bullet character too', dot[0].kind === 'list');
  const notList = parseRichText('5 * 3 = 15');
  check('a star mid-sentence is not a bullet', notList[0].kind === 'paragraph', notList[0].kind);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
