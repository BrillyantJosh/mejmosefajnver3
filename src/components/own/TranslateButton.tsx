import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Small inline "Translate to English" control for OWN messages / transcripts, so
 * participants who don't speak the source language can follow along. Calls the
 * server LLM translate endpoint and shows the result below the original text.
 */
export default function TranslateButton({ text, className = "" }: { text: string; className?: string }) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const onClick = async () => {
    // Already fetched → just toggle visibility.
    if (translation !== null) {
      setShow((s) => !s);
      return;
    }
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/voice/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || "Translation failed");
      setTranslation(data.translation || "");
      setShow(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`mt-1.5 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
        <span>{translation !== null ? (show ? "Hide English" : "Show English") : "Translate to English"}</span>
      </button>
      {translation !== null && show && (
        <p className="text-sm whitespace-pre-wrap break-words mt-1 text-foreground/90 border-l-2 border-primary/40 pl-2">
          {translation || "—"}
        </p>
      )}
    </div>
  );
}
