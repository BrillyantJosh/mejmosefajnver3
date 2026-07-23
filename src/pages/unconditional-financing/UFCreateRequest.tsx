import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlusCircle, Sparkles, Loader2, Hourglass } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/i18n/I18nContext";
import { useUFEligibility } from "@/hooks/useUFEligibility";
import UFRequestForm from "./UFRequestForm";

/**
 * Unconditional Financing — create request page (eligibility gate + form host).
 * Gate: the user must have a Lana8Wonder plan AND at least `requiredSplits`
 * completed Splits since enrollment (server-checked via useUFEligibility).
 */
export default function UFCreateRequest() {
  const navigate = useNavigate();
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { eligibility, isLoading } = useUFEligibility(session?.nostrHexId);

  // While we resolve the user's eligibility, show a small loader rather than
  // flashing a form they may not actually be allowed to submit.
  if (isLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  // Guard: only Lana8Wonder members may request unconditional financing.
  if (!eligibility?.exists) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">
            {sl ? "Potreben je Lana8Wonder plan" : "Lana8Wonder plan required"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {sl
              ? "Brezpogojno financiranje je rezervirano za člane Lana8Wonder. Najprej se pridruži Lana8Wonder, spoznaj delovanje ekosistema in postani del skupnosti."
              : "Unconditional Financing is reserved for Lana8Wonder members. Join Lana8Wonder first, get to know the ecosystem, and become part of the community."}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-6">
            <Button onClick={() => navigate("/lana8wonder")} className="gap-2">
              <Sparkles className="h-4 w-4" />
              {sl ? "Odpri Lana8Wonder" : "Open Lana8Wonder"}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/unconditional-financing/requests")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {sl ? "Nazaj na modul" : "Back to module"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Guard: member exists but has not yet completed enough Splits.
  if (!eligibility.eligible) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <Hourglass className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">
            {sl ? "Še ni pogojev" : "Not yet eligible"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {sl
              ? `Zahtevek za brezpogojno financiranje lahko odda član, ki je v Lana8Wonder vsaj ${eligibility.requiredSplits} zaključenih Splitov. Ta pogoj zagotavlja, da se človek najprej vključi v skupnost in spozna njeno delovanje.`
              : `A request can be submitted by a member who has been in Lana8Wonder for at least ${eligibility.requiredSplits} completed Splits. This ensures a person first becomes part of the community and gets to know how it works.`}
          </p>
          <p className="text-sm font-medium mt-3">
            {sl
              ? `Tvoji zaključeni Spliti od včlanitve: ${eligibility.completedSplitsSinceEnrollment} / ${eligibility.requiredSplits}`
              : `Your completed Splits since enrollment: ${eligibility.completedSplitsSinceEnrollment} / ${eligibility.requiredSplits}`}
          </p>
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() => navigate("/unconditional-financing/requests")}
          >
            <ArrowLeft className="h-4 w-4" />
            {sl ? "Nazaj na modul" : "Back to module"}
          </Button>
        </div>
      </div>
    );
  }

  // Eligible — show the form.
  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/unconditional-financing/requests")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PlusCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">
          {sl ? "Nov zahtevek za financiranje" : "New financing request"}
        </h1>
      </div>

      <UFRequestForm onSuccess={() => navigate("/unconditional-financing/my")} />
    </div>
  );
}
