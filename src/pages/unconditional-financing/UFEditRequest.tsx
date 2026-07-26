import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/i18n/I18nContext";
import { useUfRequest } from "@/hooks/useUFData";
import UFRequestForm from "./UFRequestForm";

/**
 * Refine a request that is still maturing.
 *
 * Only the author may edit, and only their own request. Saving republishes the
 * same addressable event (same d-tag), which restarts the maturing period so
 * the community reviews the version it will actually fund.
 */
const UFEditRequest = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { detail, isLoading } = useUfRequest(id);

  const request = detail?.request ?? null;
  const isOwner = !!session?.nostrHexId && request?.pubkey === session.nostrHexId;

  const back = () => navigate(`/unconditional-financing/request/${id}`);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground">
            {sl ? "Zahtevka ni bilo mogoče naložiti." : "Could not load the request."}
          </p>
          <Button
            variant="outline"
            className="mt-6 gap-2"
            onClick={() => navigate("/unconditional-financing/requests")}
          >
            <ArrowLeft className="h-4 w-4" />
            {sl ? "Nazaj na seznam" : "Back to the list"}
          </Button>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">
            {sl ? "Ni tvoj zahtevek" : "Not your request"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {sl
              ? "Zahtevek lahko ureja samo tisti, ki ga je objavil."
              : "Only the person who published a request can edit it."}
          </p>
          <Button variant="outline" className="mt-6 gap-2" onClick={back}>
            <ArrowLeft className="h-4 w-4" />
            {sl ? "Nazaj na zahtevek" : "Back to the request"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
      <Button variant="ghost" onClick={back} className="gap-2 mb-4">
        <ArrowLeft className="h-4 w-4" />
        {sl ? "Nazaj na zahtevek" : "Back to the request"}
      </Button>

      <h1 className="text-2xl font-bold mb-1">
        {sl ? "Dodelaj zahtevek" : "Refine the request"}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {sl
          ? "Dopolni predstavitev, dokler zahtevek še zori."
          : "Improve the presentation while the request is still maturing."}
      </p>

      <UFRequestForm existing={request} onSuccess={back} />
    </div>
  );
};

export default UFEditRequest;
