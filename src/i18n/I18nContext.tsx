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
function resolveLang(raw?: string): SupportedLang {
  if (!raw) return DEFAULT_LANG;

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
  const aliases: Record<string, SupportedLang> = {
    slv: 'sl', slovenian: 'sl', slovenščina: 'sl', slovenscina: 'sl',
    deu: 'de', ger: 'de', german: 'de', deutsch: 'de',
    hun: 'hu', hungarian: 'hu', magyar: 'hu',
    ita: 'it', italian: 'it', italiano: 'it',
    eng: 'en', english: 'en',
  };

  return aliases[lower] || DEFAULT_LANG;
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useAuth();

  const lang = useMemo(() => {
    const resolved = resolveLang(session?.profileLang);
    console.log('[i18n] profileLang raw:', JSON.stringify(session?.profileLang), '→ resolved:', resolved);
    return resolved;
  }, [session?.profileLang]);

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
