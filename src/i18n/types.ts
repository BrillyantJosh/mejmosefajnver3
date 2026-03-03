export type SupportedLang = 'en' | 'sl' | 'de' | 'hu' | 'it';

export const SUPPORTED_LANGS: SupportedLang[] = ['en', 'sl', 'de', 'hu', 'it'];

export const DEFAULT_LANG: SupportedLang = 'sl';

/**
 * A translation dictionary keyed by language.
 * `en` is required (fallback). All other languages are optional.
 */
export type TranslationDict<K extends string = string> = {
  en: Record<K, string>;
} & Partial<Record<Exclude<SupportedLang, 'en'>, Record<K, string>>>;
