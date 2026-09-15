/**
 * Bring BEF Explorer's shared code and texts into the BEF module.
 *   npx tsx scripts/syncBef.ts                 (bef-explorer next to this repo)
 *   BEF_EXPLORER_DIR=/path/to/bef-explorer npx tsx scripts/syncBef.ts
 *
 * The module signs the same events BEF Explorer checks, so the code that
 * defines them is not rewritten here — it is copied byte for byte from
 * bef-explorer into src/lib/bef/vendor, in BEF's own folder layout, so the
 * copies' relative imports work unchanged. Each of those files carries a line
 * at the top in bef-explorer saying so.
 *
 * The texts the module shows from BEF (calculator, interest, cards, the person
 * door and registration) are generated into src/i18n/modules/befVendor.ts from
 * BEF's own dictionaries: every key those BEF pages use, in the languages both
 * apps speak. A key BEF has not translated gets BEF's own fallback, the English.
 * Hungarian, which BEF does not have, is MejmoSefajn's own translation of those
 * keys, kept by hand in src/i18n/modules/befVendorHu.ts and merged in here, so
 * a regeneration keeps it; a key it lacks gets the English too, and is counted.
 *
 * It refuses while bef-explorer has uncommitted changes: BEF_COMMIT must name
 * the code that was copied. `--allow-uncommitted` copies anyway for a local run
 * and marks BEF_COMMIT with "+uncommitted", which scripts/testBef.ts reports.
 *
 * scripts/testBef.ts imports the generator from here to check nothing drifted.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR_DIR = path.join(ROOT, 'src/lib/bef/vendor');
export const VENDOR_DICT = path.join(ROOT, 'src/i18n/modules/befVendor.ts');
/** MejmoSefajn's own Hungarian for the same keys, merged into VENDOR_DICT. */
export const VENDOR_DICT_HU = path.join(ROOT, 'src/i18n/modules/befVendorHu.ts');
export const BEF_COMMIT_FILE = path.join(VENDOR_DIR, 'BEF_COMMIT');

/** Where bef-explorer is: BEF_EXPLORER_DIR, else next to this repo. */
export function befDir(): string {
  return path.resolve(process.env.BEF_EXPLORER_DIR || path.join(ROOT, '..', 'bef-explorer'));
}

/** Copied byte for byte, at the same path under src/lib/bef/vendor. Everything
 * they import is in the list too (cardList.ts → cardListEvent.ts; the rest
 * import only @noble, which this app already has). */
export const VENDORED_FILES = [
  'server/lib/interestEvent.ts',
  'server/lib/cardListEvent.ts',
  'server/lib/personProfile.ts',
  'server/lib/countries.ts',
  'src/lib/cardList.ts',
  'src/lib/format.ts',
  'src/lib/callingCodes.ts',
] as const;

/** The languages both apps have. Hungarian is MejmoSefajn's own and is not in BEF. */
export const VENDOR_LANGS = ['en', 'sl', 'de', 'it'] as const;

/** The generated dictionary's languages, in MejmoSefajn's order (src/i18n/types.ts). */
export const GENERATED_LANGS = ['en', 'sl', 'de', 'hu', 'it'] as const;

/** The BEF pages the module shows; every translation key they use is taken. */
export const TEXT_SOURCES = [
  // Explorer — the calculator
  'src/pages/CalculatorPage.tsx',
  'src/components/Calculator.tsx',
  'src/components/Bits.tsx',
  // Interest
  'src/pages/InterestPage.tsx',
  'src/components/person/InterestForm.tsx',
  'src/components/person/NonBindingNotice.tsx',
  // My Circle
  'src/pages/CardsPage.tsx',
  'src/components/person/CardList.tsx',
  // The person door and registration
  'src/components/person/problems.ts',
  'src/components/person/PersonDoor.tsx',
  'src/components/person/PersonSignIn.tsx',
  'src/components/person/PersonRegistration.tsx',
] as const;

/** Keys named by the server rather than written in a page: the scenario's
 * assumptions arrive as `assume.*` keys (server/routes/publicApi.ts). */
export const SERVER_KEY_PREFIXES = ['assume.'] as const;

export function befCommit(dir: string): { sha: string; clean: boolean } {
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  return { sha, clean: status === '' };
}

/** Every key the text sources use: quoted keys that exist in the English
 * dictionary, plus every key under a prefix a page builds a key from
 * (`interest.err.${code}`) or the server names. */
export function usedKeys(dir: string, enKeys: readonly string[]): string[] {
  const known = new Set(enKeys);
  const used = new Set<string>();
  const prefixes = new Set<string>(SERVER_KEY_PREFIXES);
  for (const rel of TEXT_SOURCES) {
    const text = readFileSync(path.join(dir, rel), 'utf8');
    for (const m of text.matchAll(/'([a-zA-Z][\w.]*)'|"([a-zA-Z][\w.]*)"/g)) {
      const key = m[1] ?? m[2];
      if (known.has(key)) used.add(key);
    }
    for (const m of text.matchAll(/`([a-z]+(?:\.[a-zA-Z_]+)*\.)\$\{/g)) prefixes.add(m[1]);
  }
  for (const key of enKeys) {
    if ([...prefixes].some((prefix) => key.startsWith(prefix))) used.add(key);
  }
  // In the English dictionary's order, so a regeneration diffs by meaning.
  return enKeys.filter((key) => used.has(key));
}

type Dict = Record<string, string>;

async function loadDict(dir: string, lang: string): Promise<Dict> {
  const mod = await import(pathToFileURL(path.join(dir, 'src/i18n', `${lang}.ts`)).href);
  const dict = mod[lang];
  if (!dict || typeof dict !== 'object') throw new Error(`bef-explorer src/i18n/${lang}.ts exports no "${lang}"`);
  return dict as Dict;
}

/** MejmoSefajn's Hungarian for BEF's keys, which BEF itself does not have. */
async function loadHungarian(): Promise<Dict> {
  const mod = await import(pathToFileURL(VENDOR_DICT_HU).href);
  const dict = mod.default;
  if (!dict || typeof dict !== 'object') throw new Error('src/i18n/modules/befVendorHu.ts has no default export');
  return dict as Dict;
}

/** The generated dictionary's text, how many keys each language lacked, and
 * the Hungarian keys no BEF page uses any more (left out of the output). */
export async function generateBefVendor(
  dir: string,
  commit: string,
): Promise<{ source: string; gaps: Record<string, number>; keys: number; unusedHu: string[] }> {
  const dicts: Record<string, Dict> = {};
  for (const lang of VENDOR_LANGS) dicts[lang] = await loadDict(dir, lang);
  dicts.hu = await loadHungarian();
  const keys = usedKeys(dir, Object.keys(dicts.en));
  const unusedHu = Object.keys(dicts.hu).filter((key) => !keys.includes(key));
  const gaps: Record<string, number> = {};

  const block = (lang: string, indent: string) =>
    keys
      .map((key) => {
        let text = dicts[lang][key];
        if (typeof text !== 'string') {
          gaps[lang] = (gaps[lang] ?? 0) + 1;
          text = dicts.en[key];
        }
        return `${indent}${JSON.stringify(key)}: ${JSON.stringify(text)},`;
      })
      .join('\n');

  const others = GENERATED_LANGS.filter((lang) => lang !== 'en')
    .map((lang) => `  ${lang}: {\n${block(lang, '    ')}\n  },`)
    .join('\n');

  const source = `// GENERATED from bef-explorer@${commit} — do not edit. Run scripts/syncBef.ts.
import { TranslationDict } from '../types';

// BEF Explorer's own words for the pages the BEF module shows: every key the
// calculator, interest, cards, sign-in and registration pages of bef-explorer
// use, from its src/i18n dictionaries. A key BEF has not translated carries
// BEF's own fallback, the English. Hungarian, which BEF does not have, is
// MejmoSefajn's translation from ./befVendorHu.ts — change it there.
// MejmoSefajn's own words are in ./bef.ts.
const befVendor = {
${block('en', '  ')}
} as const;

export type BefVendorKey = keyof typeof befVendor;

const translations: TranslationDict<BefVendorKey> = {
  en: befVendor,
${others}
};

export default translations;
`;
  return { source, gaps, keys: keys.length, unusedHu };
}

async function main() {
  const dir = befDir();
  if (!existsSync(path.join(dir, 'server/lib/interestEvent.ts'))) {
    console.error(`bef-explorer not found at ${dir} (set BEF_EXPLORER_DIR)`);
    process.exit(1);
  }
  const allowUncommitted = process.argv.includes('--allow-uncommitted');
  const { sha, clean } = befCommit(dir);
  if (!clean && !allowUncommitted) {
    console.error(`bef-explorer has uncommitted changes — commit them first, so BEF_COMMIT names what was copied.`);
    process.exit(1);
  }
  const commit = clean ? sha : `${sha}+uncommitted`;

  for (const rel of VENDORED_FILES) {
    const target = path.join(VENDOR_DIR, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(dir, rel)));
    console.log(`  copied ${rel}`);
  }
  writeFileSync(BEF_COMMIT_FILE, `${commit}\n`);

  const { source, gaps, keys, unusedHu } = await generateBefVendor(dir, commit);
  writeFileSync(VENDOR_DICT, source);
  console.log(`  wrote src/i18n/modules/befVendor.ts: ${keys} keys`);
  for (const lang of VENDOR_LANGS) {
    if (lang !== 'en') console.log(`    ${lang}: ${gaps[lang] ?? 0} untranslated in BEF, English used`);
  }
  console.log(`    hu: ${gaps.hu ?? 0} untranslated in befVendorHu.ts, English used`);
  if (gaps.hu) console.log(`  ! translate the new keys in src/i18n/modules/befVendorHu.ts and run this again`);
  if (unusedHu.length) console.log(`  ! no BEF page uses these any more — remove them from befVendorHu.ts: ${unusedHu.join(', ')}`);
  console.log(`\nBEF_COMMIT ${commit}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
