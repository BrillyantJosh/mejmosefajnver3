import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, HelpCircle } from "lucide-react";
import { EligibilityCriteria, eligibilityContent } from "@/components/100millionideas/EligibilityCriteria";
import { useLang } from "@/i18n/I18nContext";

/**
 * Full-page version of the "What kind of projects are eligible for
 * crowdfunding?" criteria (previously shown as an info dialog on the Projects
 * page). Language follows the KIND 0 profile via useLang().
 */
export default function Eligibility() {
  const navigate = useNavigate();
  const lang = useLang();
  const c = eligibilityContent(lang);

  return (
    <div className="container mx-auto p-6 max-w-2xl pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/100millionideas/projects")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <HelpCircle className="h-6 w-6 text-primary shrink-0" />
        <h1 className="text-2xl font-bold">{c.eligibilityTitle}</h1>
      </div>

      <EligibilityCriteria lang={lang} />
    </div>
  );
}
