import { Fragment } from "react";
import type { SupportedLang } from "@/i18n/types";

/**
 * BEF Explorer's texts carry emphasis as **double asterisks**. They are split
 * into React nodes here — never injected as HTML: a translation is text, and
 * text it stays (BEF src/i18n/index.tsx rich()).
 */
export function BefText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/** The number and country-name locale for each app language, as BEF uses them. */
export const BEF_LOCALES: Record<SupportedLang, string> = {
  en: "en-GB",
  sl: "sl-SI",
  de: "de-DE",
  hu: "hu-HU",
  it: "it-IT",
};

/** First 6 … last 4 of a wallet address, for the signed-in line. */
export const shortWallet = (wallet: string) => (wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet);
