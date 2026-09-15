import { SUPPORTED_LANGS, type TranslationDict } from "../../../i18n/types";
import befText, { type BefTextKey } from "../../../i18n/modules/befText";
import befExplorerTranslations, { type BefExplorerKey } from "../../../i18n/modules/befExplorer";

// The Explorer reads one dictionary: the module's (BEF Explorer's calculator
// texts and the door's words, ../../../i18n/modules/befText.ts) and the
// Explorer's own (../../../i18n/modules/befExplorer.ts), which share no key. A
// language one of them lacks falls back to English key by key, as
// useTranslation() does for any dictionary.
export type ExplorerTextKey = BefTextKey | BefExplorerKey;

const explorerText = { en: { ...befText.en, ...befExplorerTranslations.en } } as TranslationDict<ExplorerTextKey>;

for (const lang of SUPPORTED_LANGS) {
  if (lang === "en") continue;
  const shared = befText[lang];
  const own = befExplorerTranslations[lang];
  if (shared || own) explorerText[lang] = { ...shared, ...own } as Record<ExplorerTextKey, string>;
}

/**
 * Fills {name} in a text the way BEF Explorer does (bef-explorer
 * src/i18n/index.tsx): each value goes in exactly as it is. useTranslation()'s
 * own filling hands values to String.replace, which reads "$&" or "$'" in a
 * value as a pattern — and money in dollars starts with "$".
 */
export function fillText(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Whether a key the server names (a status, an assumption) has words here. */
export const hasExplorerText = (key: string): key is ExplorerTextKey => Object.prototype.hasOwnProperty.call(explorerText.en, key);

export default explorerText;
