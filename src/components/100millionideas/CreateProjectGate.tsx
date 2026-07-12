import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { SupportedLang } from "@/i18n/types";
import { EligibilityCriteria, eligibilityContent } from "./EligibilityCriteria";

/**
 * Intro / agreement step shown before the create-project form. The applicant
 * reads the basis for participation + what kind of projects crowdfunding
 * encourages (shared EligibilityCriteria), then confirms to open the form.
 */
export default function CreateProjectGate({ lang, onAgree }: { lang: SupportedLang; onAgree: () => void }) {
  const c = eligibilityContent(lang);
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-7 space-y-5">
      <EligibilityCriteria lang={lang} />
      <Button size="lg" className="w-full" onClick={onAgree}>
        {c.agree}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
