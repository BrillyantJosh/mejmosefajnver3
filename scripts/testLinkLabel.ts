/**
 * A chat message must never be able to crash the page.
 *   npx tsx scripts/testLinkLabel.ts
 *
 * The inputs are what Chat.tsx's own regex extracts from message text
 * (/(https?:\/\/[^\s]+|www\.[^\s]+)/g, then https:// prefixed when missing) —
 * so these are strings that really do reach LinkPreview.
 */
import { linkLabel } from '../src/components/social/LinkPreview.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

const extract = (content: string): string[] =>
  (content.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/g) || [])
    .map((u) => (u.startsWith('http://') || u.startsWith('https://') ? u : 'https://' + u));

console.log('— shapes that used to throw during render —');
for (const raw of ['https://a:b', 'https://a:99999999', 'https://[x', 'https://a]b', 'https://xn--', 'https://%', 'https://a%zz']) {
  let threw = false;
  let label = '';
  try { label = linkLabel(raw); } catch { threw = true; }
  check(`${raw} renders instead of throwing`, !threw && label === raw, { threw, label });
}

console.log('— real links still show their host —');
{
  check('plain link', linkLabel('https://direct.lana.fund') === 'direct.lana.fund');
  check('with path and query', linkLabel('https://lana.fund/report?x=1') === 'lana.fund');
  check('www form', linkLabel('https://www.lana.fund') === 'www.lana.fund');
}

console.log('— straight from message text —');
{
  const urls = extract('Dear all, see https://a:b and www.lana.fund for the update');
  check('the broken one is extracted, as chat would', urls.includes('https://a:b'), urls);
  let threw = false;
  try { urls.forEach(linkLabel); } catch { threw = true; }
  check('rendering the whole message survives', !threw);
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
