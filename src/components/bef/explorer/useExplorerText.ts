import { useCallback } from "react";
import { useTranslation } from "@/i18n/I18nContext";
import explorerText, { fillText, type ExplorerTextKey } from "./explorerText";

/**
 * The Explorer's translator: useTranslation() over ./explorerText.ts, with
 * values filled in by fillText — figures here are money, and "$1,000" must
 * reach the page as written.
 */
export function useExplorerText() {
  const { t: text, lang } = useTranslation(explorerText);
  const t = useCallback(
    (key: ExplorerTextKey, vars?: Record<string, string | number>) => (vars ? fillText(text(key), vars) : text(key)),
    [text],
  );
  return { t, lang };
}
