/**
 * The BEF module's Interest page, closed: an interest is expressed on the BEF
 * page of LetsBalance.world now — support, sell, or sell and buy, for at most
 * 30 days (KIND 30975, taken up by one firm with KIND 40971) — and the buy-only
 * KIND 30970 this page signed and sent through BEF Explorer is replaced
 * (Brilly, 3. 11. 2026). What is checked: the page says so in every language
 * and links there, and nothing in the module signs, reads or sends a 30970 any
 * more.
 *   npx tsx scripts/testBefInterest.ts
 *
 * Nothing here compares with bef-explorer, touches a network or a relay.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { BEF_INTEREST_ROUTES_LEFT_OUT, BEF_ROUTES, isBefRoute, LETSBALANCE_BEF_URL } from '../src/lib/bef/base.js';
import { BefApiError, createBefClient } from '../src/lib/bef/api.js';
import * as signing from '../src/lib/bef/signing.js';
import { SUPPORTED_LANGS } from '../src/i18n/types.js';
import befInterestText, { befInterestTranslations } from '../src/i18n/modules/befInterest.js';
import { ROOT } from './syncBef.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)?.slice(0, 300)}`);
  if (!cond) failures++;
};
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Source without its comments: what a file says about the past is not what it does. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PAGE = 'src/pages/bef/BefInterest.tsx';
const KEYS = ['interest.moved.title', 'interest.moved.text', 'interest.moved.closed', 'interest.moved.open'] as const;

async function main() {
  /* ─────────────────────────────────────────────────────────────── page ── */
  console.log('— the page says where an interest is expressed now —');
  {
    const page = code(PAGE);
    check('it links to the BEF page of LetsBalance.world', LETSBALANCE_BEF_URL === 'https://letsbalance.world/pays-us?view=bef' && page.includes('import { LETSBALANCE_BEF_URL } from "@/lib/bef/base";'));
    const anchors = [...page.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
    check('one link out, in a new tab, without a referrer', anchors.length === 1 && /href=\{LETSBALANCE_BEF_URL\}/.test(anchors[0]) && /target="_blank"/.test(anchors[0]) && /rel="noopener noreferrer"/.test(anchors[0]), anchors);
    const named = [...page.matchAll(/t\("([\w.]+)"\)/g)].map((m) => m[1]).sort();
    check('it says the four texts of its own, and nothing else', JSON.stringify(named) === JSON.stringify([...KEYS].sort()), named);
    check('an h2 under BefLayout’s h1', /<h2[\s>]/.test(page) && !/<h1[\s>]/.test(page));
    check('signs, reads and sends nothing: no door, no session, no client, no key',
      !/BefDoor|useBefPerson|withSession|befClient|signing|finalizeEvent|lanaPrivateKey|nostrPrivateKey|useSearchParams|fetch\(/.test(page));
    check('no form and no field', !/<form|<input|<textarea|<select/i.test(page));
  }

  /* ─────────────────────────────────────────────────────────────── words ── */
  console.log('— in every MejmoSefajn language —');
  {
    const en = befInterestTranslations.en as Record<string, string>;
    check('befInterest.ts has exactly the four texts', JSON.stringify(Object.keys(en).sort()) === JSON.stringify([...KEYS].sort()), Object.keys(en));
    for (const lang of SUPPORTED_LANGS) {
      const words = (befInterestTranslations[lang] ?? {}) as Record<string, string>;
      const missing = KEYS.filter((key) => typeof words[key] !== 'string' || words[key].trim() === '');
      const extra = Object.keys(words).filter((key) => !(key in en));
      check(`${lang}: every text, and no other`, missing.length === 0 && extra.length === 0, { missing, extra });
      check(`${lang}: names LetsBalance.world, its three choices’ place and 30 days`, (words['interest.moved.text'] ?? '').includes('LetsBalance.world') && /\b30\b/.test(words['interest.moved.text'] ?? '') && (words['interest.moved.open'] ?? '').includes('LetsBalance.world'), words['interest.moved.text']);
      check(`${lang}: the page dictionary carries them`, KEYS.every((key) => (befInterestText[lang] as Record<string, string> | undefined)?.[key] === words[key]));
    }
    const sl = befInterestTranslations.sl as Record<string, string>;
    check('sl: podpora, prodaja ali prodaja in nakup', /podpora, prodaja ali prodaja in nakup/.test(sl['interest.moved.text']), sl['interest.moved.text']);
    check('en: support, sell, or sell and buy', /support, sell, or sell and buy/.test(en['interest.moved.text']), en['interest.moved.text']);
  }

  /* ──────────────────────────────────────────────────── nothing sends one ── */
  console.log('— no KIND 30970 is signed, read or sent —');
  {
    check('signing.ts exports no signInterest', !('signInterest' in signing));
    check('signing.ts does not build an interest event', !/buildInterestTemplate|InterestDraft/.test(code('src/lib/bef/signing.ts')));
    for (const [m, p] of BEF_INTEREST_ROUTES_LEFT_OUT) {
      check(`${m} ${p} is not a route the module may call`, !isBefRoute(m, p) && !BEF_ROUTES.some(([rm, rp]) => rm === m && rp === p));
    }
    let fetched = 0;
    const client = createBefClient({ base: 'https://befexplorer.com', fetchImpl: (async () => { fetched++; return new Response('{}'); }) as unknown as typeof fetch });
    check('the client has no interest calls', !('interest' in client));
    let refusal: unknown = null;
    try {
      await client.request('/api/interest', { method: 'POST', body: { event: {} } });
    } catch (err) {
      refusal = err;
    }
    check('a POST /api/interest is refused before fetch', refusal instanceof BefApiError && refusal.code === 'route_not_allowed' && fetched === 0, String(refusal));

    // Every own file of the module — pages, components, lib (BEF's vendored copies aside).
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== 'vendor') walk(rel);
        } else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
      }
    };
    for (const dir of ['src/pages/bef', 'src/components/bef', 'src/lib/bef']) walk(dir);
    const offenders = files.filter((rel) => /signInterest|buildInterestTemplate|parseInterestEvent|['"]\/api\/interest(\/mine|\/windows)?['"]|\.interest\.(submit|mine|windows)/.test(code(rel)) && rel !== 'src/lib/bef/base.ts');
    check('no file of the module signs, reads or sends an interest', offenders.length === 0, offenders);
    check('the interest form and its model are gone', ['InterestForm.tsx', 'InterestSplitCard.tsx', 'interestModel.ts', 'NonBindingNotice.tsx'].every((f) => !existsSync(path.join(ROOT, 'src/components/bef/interest', f))) && !existsSync(path.join(ROOT, 'src/lib/bef/prefill.ts')));
  }

  if (failures) console.log(`\n❌ ${failures} FAILED`);
  else console.log('\n✅ all passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
