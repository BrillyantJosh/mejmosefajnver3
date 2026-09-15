import { SUPPORTED_LANGS, TranslationDict } from '../types';
import befTranslations, { type BefKey } from './bef';
import befVendorTranslations, { type BefVendorKey } from './befVendor';

// The BEF module reads one dictionary: BEF Explorer's own words (./befVendor.ts,
// generated) and MejmoSefajn's own (./bef.ts), which never share a key. A
// language one of them lacks falls back to English key by key, as
// useTranslation() does for any dictionary.
export type BefTextKey = BefKey | BefVendorKey;

const befText = { en: { ...befVendorTranslations.en, ...befTranslations.en } } as TranslationDict<BefTextKey>;

for (const lang of SUPPORTED_LANGS) {
  if (lang === 'en') continue;
  const vendor = befVendorTranslations[lang];
  const own = befTranslations[lang];
  if (vendor || own) befText[lang] = { ...vendor, ...own } as Record<BefTextKey, string>;
}

export default befText;
