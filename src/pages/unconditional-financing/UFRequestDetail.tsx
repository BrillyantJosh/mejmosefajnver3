import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  ExternalLink,
  HandCoins,
  Info,
  Link2,
  Loader2,
  Target,
  Undo2,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/i18n/I18nContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import {
  ufMaturingDaysLeft,
  ufTypeLabel,
  useUfRequest,
  type UfFinancier,
  type UfRepayment,
} from "@/hooks/useUFData";
import UFComments from "./UFComments";

// chainz is the ONLY valid LANA explorer
const CHAINZ_TX = "https://chainz.cryptoid.info/lana/tx.dws?";

/**
 * Unconditional Financing — request detail page.
 * Cover, story, financiers with shares (core transparency feature),
 * repayment history, contribute/repay CTAs and comments.
 */
const UFRequestDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sl = useLang() === "sl";
  const { session } = useAuth();
  const { detail, isLoading, error } = useUfRequest(id);

  const request = detail?.request;
  const financiers: UfFinancier[] = detail?.financiers || [];
  const repayments: UfRepayment[] = detail?.repayments || [];
  const totalFunded = detail?.totalFunded ?? 0;
  const totalRepaid = detail?.totalRepaid ?? 0;

  // Requester + financiers profiles in one bulk lookup
  const profilePubkeys = useMemo(() => {
    if (!request) return [] as string[];
    return [...new Set([request.pubkey, ...financiers.map((f) => f.pubkey)])];
  }, [request?.pubkey, financiers]);
  const { profiles } = useNostrProfilesCacheBulk(profilePubkeys);

  const profileName = (pubkey: string): string => {
    const p = profiles.get(pubkey);
    return p?.display_name || p?.full_name || (sl ? "Anonimen" : "Anonymous");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24">
        <Button
          variant="ghost"
          onClick={() => navigate("/unconditional-financing")}
          className="gap-2 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {sl ? "Nazaj" : "Back"}
        </Button>
        <p className="text-center text-muted-foreground py-12">
          {sl ? "Zahtevek ni bil najden." : "Request not found."}
        </p>
      </div>
    );
  }

  const isRequester = session?.nostrHexId === request.pubkey;
  const fiatGoal = request.fiatGoal || 0;
  const percentFunded = fiatGoal > 0 ? (totalFunded / fiatGoal) * 100 : 0;
  const requesterProfile = profiles.get(request.pubkey);

  const fmtFiat = (n: number) => `${n.toFixed(2)} ${request.currency}`;

  // ── phase badge ──
  const phaseBadge = (() => {
    switch (request.phase) {
      case "maturing": {
        const days = ufMaturingDaysLeft(request.fundingOpensAt);
        const label =
          days === 1
            ? sl ? "Zorenje · odpre se čez 1 dan" : "Maturing · opens in 1 day"
            : sl ? `Zorenje · odpre se čez ${days} dni` : `Maturing · opens in ${days} days`;
        return (
          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/15">
            {label}
          </Badge>
        );
      }
      case "repaying":
        return (
          <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30 hover:bg-green-500/15">
            {sl ? "Odprto za financiranje" : "Open for financing"}
          </Badge>
        );
      case "repaid":
      default:
        return (
          <Badge className="bg-muted text-muted-foreground border border-border hover:bg-muted">
            {sl ? "Poplačano" : "Repaid"}
          </Badge>
        );
    }
  })();

  // ── crowdfunding refs (wellbeing projects only) ──
  const renderCrowdfundingRef = (ref: string, index: number) => {
    if (/^https?:\/\//i.test(ref)) {
      return (
        <a
          key={index}
          href={ref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-primary hover:underline break-all"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          {ref}
        </a>
      );
    }
    const parts = ref.split(":");
    if (parts.length >= 3 && parts[0] === "31234") {
      const dTag = parts.slice(2).join(":");
      return (
        <button
          key={index}
          type="button"
          onClick={() => navigate(`/100millionideas/project/${dTag}`)}
          className="flex items-center gap-2 text-sm text-primary hover:underline break-all text-left"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          {sl ? "Crowdfunding projekt" : "Crowdfunding project"}: {dTag}
        </button>
      );
    }
    return (
      <span key={index} className="text-sm font-mono break-all text-muted-foreground">
        {ref}
      </span>
    );
  };

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2">
          <Button
            variant="ghost"
            onClick={() => navigate("/unconditional-financing")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {sl ? "Nazaj" : "Back"}
          </Button>
        </div>
      </div>

      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-4xl space-y-6">
        {/* Cover image — natural height */}
        <div className="bg-muted rounded-lg overflow-hidden">
          {request.coverImage ? (
            <img
              src={request.coverImage}
              alt={request.title}
              className="w-full h-auto max-h-[28rem] object-contain"
            />
          ) : (
            <div className="w-full h-48 flex items-center justify-center">
              <HandCoins className="h-16 w-16 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Title + badges */}
        <div>
          <h1 className="text-3xl font-bold mb-3">{request.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">{ufTypeLabel(request.requestType, sl)}</Badge>
            {phaseBadge}
            <Badge variant="outline">{request.currency}</Badge>
          </div>
          {request.shortDesc && (
            <p className="text-muted-foreground whitespace-pre-wrap">{request.shortDesc}</p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {sl ? "Objavljeno" : "Published"}{" "}
            {request.publishedAt
              ? format(new Date(request.publishedAt * 1000), "dd/MM/yyyy")
              : "—"}
          </p>
        </div>

        {/* Maturing info */}
        {request.phase === "maturing" && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <Info className="h-4 w-4" />
            <AlertTitle>{sl ? "Obdobje zorenja" : "Maturing period"}</AlertTitle>
            <AlertDescription>
              {sl
                ? `Financiranje se odpre ${new Date(request.fundingOpensAt * 1000).toLocaleString("sl-SI")}. Do takrat prispevki še niso mogoči — vprašanja in komentarji spodaj pa so zelo dobrodošli.`
                : `Funding opens on ${new Date(request.fundingOpensAt * 1000).toLocaleString("en-GB")}. Until then contributions are not yet possible — questions and comments below are very welcome.`}
            </AlertDescription>
          </Alert>
        )}

        {/* Requester */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Users className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold mb-4">
                {sl ? "Prosilec" : "Requester"}
              </h2>
              <div className="flex items-start gap-4">
                <UserAvatar
                  pubkey={request.pubkey}
                  picture={requesterProfile?.picture}
                  name={profileName(request.pubkey)}
                  className="h-12 w-12"
                />
                <div className="flex-1">
                  <h3 className="font-semibold">{profileName(request.pubkey)}</h3>
                  {requesterProfile?.about && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {requesterProfile.about}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Story */}
        <div>
          <h2 className="text-2xl font-bold mb-4">{sl ? "Zgodba" : "Story"}</h2>
          <p className="whitespace-pre-wrap text-muted-foreground">{request.content}</p>
        </div>

        {/* Gallery */}
        {request.galleryImages.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-4">{sl ? "Galerija" : "Gallery"}</h2>
            <div className="grid grid-cols-2 gap-4">
              {request.galleryImages.map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`Gallery ${index + 1}`}
                  className="w-full aspect-video object-cover rounded-lg"
                />
              ))}
            </div>
          </div>
        )}

        {/* Prior crowdfunding — wellbeing projects only */}
        {request.requestType === "wellbeing_project" && request.crowdfundingRefs.length > 0 && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-3">
              {sl ? "Predhodni crowdfunding projekti" : "Prior crowdfunding projects"}
            </h2>
            <div className="space-y-2">
              {request.crowdfundingRefs.map((ref, index) => renderCrowdfundingRef(ref, index))}
            </div>
          </Card>
        )}

        {/* Funding */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Target className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-4">
                {sl ? "Financiranje" : "Funding"}
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                    <span className="text-3xl font-bold text-green-500">
                      {fmtFiat(totalFunded)}
                    </span>
                    <span className="text-muted-foreground">
                      {sl ? "od" : "of"} {fmtFiat(fiatGoal)}
                    </span>
                  </div>
                  <Progress value={Math.min(percentFunded, 100)} className="mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {percentFunded.toFixed(1)} %
                    {" · "}
                    {financiers.length}{" "}
                    {sl
                      ? financiers.length === 1 ? "financer" : "financerjev"
                      : financiers.length === 1 ? "financier" : "financiers"}
                  </p>
                </div>
                {totalRepaid > 0 && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">
                      {sl ? "Že vrnjeno:" : "Repaid so far:"}
                    </span>{" "}
                    <span className="font-semibold">{fmtFiat(totalRepaid)}</span>
                  </p>
                )}
              </div>

              {/* CTAs */}
              <div className="space-y-3 mt-6">
                {request.phase === "repaying" && !isRequester && (
                  <Button
                    className="w-full bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => navigate(`/unconditional-financing/contribute/${request.id}`)}
                  >
                    <HandCoins className="h-4 w-4 mr-2" />
                    {sl ? "Prispevaj" : "Contribute"}
                  </Button>
                )}
                {isRequester && totalFunded > 0 && !request.isRepaid && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate(`/unconditional-financing/repay/${request.id}`)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" />
                    {sl ? "Vrni sredstva" : "Repay"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Financiers — core transparency feature */}
        <div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Users className="h-6 w-6" />
            {sl ? "Financerji" : "Financiers"}
          </h2>
          {financiers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {sl ? "Še ni financerjev." : "No financiers yet."}
            </p>
          ) : (
            <div className="space-y-3">
              {financiers.map((financier) => {
                const p = profiles.get(financier.pubkey);
                return (
                  <Card key={financier.pubkey} className="p-4">
                    <div className="flex items-center gap-4">
                      <UserAvatar
                        pubkey={financier.pubkey}
                        picture={p?.picture}
                        name={profileName(financier.pubkey)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">
                          {profileName(financier.pubkey)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-green-500">
                          {fmtFiat(financier.amountFiat)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {financier.sharePercent.toFixed(1)} %
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Repayment history */}
        <div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Undo2 className="h-6 w-6" />
            {sl ? "Vračila" : "Repayments"}
          </h2>
          {repayments.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {sl ? "Še ni vračil." : "No repayments yet."}
            </p>
          ) : (
            <div className="space-y-3">
              {repayments.map((repayment) => (
                <Card key={repayment.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(repayment.nostrCreatedAt * 1000), "dd MMM yyyy, HH:mm")}
                      </p>
                      {repayment.txId && (
                        <a
                          href={`${CHAINZ_TX}${repayment.txId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                        >
                          {sl ? "Poglej transakcijo" : "View transaction"}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="font-bold text-green-500 shrink-0">
                      {fmtFiat(repayment.totalFiat)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Comments — open through all phases */}
        <UFComments
          requestId={request.id}
          requestPubkey={request.pubkey}
          recipientPubkey={request.pubkey}
        />
      </div>
    </div>
  );
};

export default UFRequestDetail;
