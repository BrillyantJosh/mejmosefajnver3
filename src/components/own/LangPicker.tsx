import { Languages } from "lucide-react";
import { useLangControl } from "@/i18n/I18nContext";
import { SUPPORTED_LANGS, SupportedLang } from "@/i18n/types";

const LABELS: Record<SupportedLang, string> = {
  sl: "SL", en: "EN", de: "DE", hu: "HU", it: "IT",
};

// The interface language used to be derived only — profile, then country, then
// browser. That is a sensible first guess and a poor final answer: a reader
// looking at somebody's public matrix may simply not know the language it
// guessed. This lets them choose, and choosing changes nothing that is
// published: the override is local to their browser.
export const LangPicker = ({ className = "" }: { className?: string }) => {
  const { lang, setLang, override } = useLangControl();

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <Languages className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5" role="group" aria-label="Jezik / Language">
        {SUPPORTED_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {LABELS[l] || l.toUpperCase()}
          </button>
        ))}
      </div>
      {/* Only offered once an override exists — otherwise it would suggest the
          reader had made a choice they never made. */}
      {override && (
        <button
          type="button"
          onClick={() => setLang(null)}
          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
};
