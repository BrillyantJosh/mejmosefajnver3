import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SupportedLang, SUPPORTED_LANGS, DEFAULT_LANG, TranslationDict } from './types';

interface I18nContextValue {
  lang: SupportedLang;
}

const I18nContext = createContext<I18nContextValue>({ lang: DEFAULT_LANG });

/**
 * Resolves a raw profile language string to a SupportedLang.
 * Handles codes like "sl", "slv", "sl-SI", "Slovenian", etc.
 */
function resolveLang(raw?: string): SupportedLang | null {
  if (!raw) return null;

  const lower = raw.toLowerCase().trim();

  // Exact match
  if (SUPPORTED_LANGS.includes(lower as SupportedLang)) {
    return lower as SupportedLang;
  }

  // Match prefix (e.g. "sl-SI" → "sl", "de-AT" → "de")
  const prefix = lower.split(/[-_]/)[0];
  if (SUPPORTED_LANGS.includes(prefix as SupportedLang)) {
    return prefix as SupportedLang;
  }

  // Common ISO 639-2/3 and full-name mappings
  const langAliases: Record<string, SupportedLang> = {
    slv: 'sl', slovenian: 'sl', slovenščina: 'sl', slovenscina: 'sl',
    deu: 'de', ger: 'de', german: 'de', deutsch: 'de',
    hun: 'hu', hungarian: 'hu', magyar: 'hu',
    ita: 'it', italian: 'it', italiano: 'it',
    eng: 'en', english: 'en',
  };

  return langAliases[lower] || null;
}

/**
 * Maps an ISO 3166-1 country code to the primary language spoken there.
 * Only maps countries where we support the language.
 */
const COUNTRY_TO_LANG: Record<string, SupportedLang> = {
  si: 'sl', // Slovenia
  de: 'de', // Germany
  at: 'de', // Austria
  ch: 'de', // Switzerland (German majority)
  hu: 'hu', // Hungary
  it: 'it', // Italy
  gb: 'en', us: 'en', au: 'en', ca: 'en', nz: 'en', ie: 'en',
};

function resolveCountry(country?: string): SupportedLang | null {
  if (!country) return null;
  return COUNTRY_TO_LANG[country.toLowerCase().trim()] || null;
}

/**
 * Detects the user's preferred language from the browser/OS settings.
 * Checks navigator.languages (array) and navigator.language (single).
 */
function detectBrowserLang(): SupportedLang | null {
  if (typeof navigator === 'undefined') return null;

  // navigator.languages is an ordered list of preferred languages
  const candidates = [
    ...(navigator.languages || []),
    navigator.language,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolveLang(candidate);
    if (resolved) return resolved;
  }

  return null;
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useAuth();

  const lang = useMemo(() => {
    // Priority: 1) explicit profile lang, 2) country code, 3) browser/OS lang, 4) default (sl)
    const fromLang = resolveLang(session?.profileLang);
    const fromCountry = resolveCountry(session?.profileCountry);
    const fromBrowser = detectBrowserLang();
    const resolved = fromLang ?? fromCountry ?? fromBrowser ?? DEFAULT_LANG;
    console.log('[i18n] lang:', JSON.stringify(session?.profileLang), '| country:', JSON.stringify(session?.profileCountry), '| browser:', fromBrowser, '→', resolved);
    return resolved;
  }, [session?.profileLang, session?.profileCountry]);

  return (
    <I18nContext.Provider value={{ lang }}>
      {children}
    </I18nContext.Provider>
  );
};

/**
 * Hook that returns a translator function `t` bound to the given dictionary.
 *
 * Usage:
 * ```ts
 * const { t, lang } = useTranslation(myTranslations);
 * t('greeting')            // → "Hello"
 * t('hello', { name: 'X' }) // → "Hello X"
 * ```
 */
export function useTranslation<K extends string>(dict: TranslationDict<K>) {
  const { lang } = useContext(I18nContext);

  const t = useMemo(() => {
    const langDict = dict[lang] ?? dict.en;
    const enDict = dict.en;

    return (key: K, vars?: Record<string, string | number>): string => {
      let str = langDict[key] ?? enDict[key] ?? key;

      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }

      return str;
    };
  }, [lang, dict]);

  return { t, lang };
}
