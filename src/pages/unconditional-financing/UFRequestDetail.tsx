import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  CheckCircle,
  Clock,
  ExternalLink,
  HandCoins,
  Info,
  Link2,
  Loader2,
  Pencil,
  ShieldCheck,
  Target,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { useLang } from "@/i18n/I18nContext";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import {
  ufMaturingDaysLeft,
  ufTypeLabel,
  useUfRequest,
  type UfContribution,
  type UfFinancier,
  type UfRepayment,
} from "@/hooks/useUFData";
import { ufContributeCta, ufReadsFunded } from "@/lib/ufFunded";
import { ufRaisedWhole } from "@/lib/ufRaisedWhole";
import UFComments from "./UFComments";
import UFAdminBar from "./UFAdminBar";

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
  const { isUfAdmin } = useAdmin();
  const { detail, isLoading, error, refetch } = useUfRequest(id);

  const request = detail?.request;
  const financiers: UfFinancier[] = detail?.financiers || [];
  const repayments: UfRepayment[] = detail?.repayments || [];
  const totalFunded = detail?.totalFunded ?? 0;
  const totalRepaid = detail?.totalRepaid ?? 0;

  // Messages financiers wrote for the recipient while contributing. A
  // financier card aggregates all of that person's contributions, so collect
  // their messages the same way — newest first, blanks dropped.
  const messagesByFinancier = useMemo(() => {
    const map = new Map<string, UfContribution[]>();
    for (const c of detail?.contributions || []) {
      if (!c.message?.trim()) continue;
      const list = map.get(c.supporterPubkey);
      if (list) list.push(c);
      else map.set(c.supporterPubkey, [c]);
    }
    for (const list of map.values()) list.sort((a, b) => b.nostrCreatedAt - a.nostrCreatedAt);
    return map;
  }, [detail?.contributions]);

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
          onClick={() => navigate("/unconditional-financing/requests")}
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
  // Waiting for approval, or archived: seen only by its author and the administrators
  // (server/lib/ufApproval.ts). Anyone else who follows a link learns only that much.
  const isPending = request.approval === "pending";
  const isArchived = !!request.isArchived;
  const isApproved = request.approval === "approved";
  if ((isPending || isArchived) && !isRequester && !isUfAdmin) {
    return (
      <div className="container mx-auto p-4 sm:p-6 pb-24 max-w-2xl">
        <Button variant="ghost" onClick={() => navigate("/unconditional-financing/requests")} className="gap-2 mb-6">
          <ArrowLeft className="h-4 w-4" />
          {sl ? "Nazaj" : "Back"}
        </Button>
        <div className="flex flex-col items-center text-center py-12 gap-3">
          {isArchived ? <Archive className="h-10 w-10 text-muted-foreground" /> : <Clock className="h-10 w-10 text-muted-foreground" />}
          <p className="text-muted-foreground max-w-sm">
            {isArchived
              ? sl ? "Ta zahtevek je arhiviran in ni več javen." : "This request is archived and no longer public."
              : sl ? "Ta zahtevek še čaka na odobritev skrbnika. Javen bo, ko ga skrbnik odobri." : "This request is waiting for an administrator's approval. It becomes public once approved."}
          </p>
        </div>
      </div>
    );
  }
  const fiatGoal = request.fiatGoal || 0;
  const percentFunded = fiatGoal > 0 ? (totalFunded / fiatGoal) * 100 : 0;
  // The goal is reached: the request reads "Financiran" and "Prispevaj" is no longer active
  // (Jasna, Brilly 16. 11. 2026; src/lib/ufFunded.ts). Repaying is not touched.
  const isFunded = ufReadsFunded(request, totalFunded);
  const contributeCta = ufContributeCta(request, totalFunded, isRequester);
  const requesterProfile = profiles.get(request.pubkey);

  const fmtFiat = (n: number) => `${n.toFixed(2)} ${request.currency}`;

  // ── phase badge ──
  const phaseBadge = (() => {
    switch (request.phase) {
      case "pending":
        return (
          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/15">
            {sl ? "Čaka na odobritev" : "Waiting for approval"}
          </Badge>
        );
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
        return isFunded ? (
          <Badge className="bg-green-600 text-white hover:bg-green-600 gap-1">
            <CheckCircle className="h-3 w-3" />
            {sl ? "Financiran" : "Funded"}
          </Badge>
        ) : (
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
            onClick={() => navigate("/unconditional-financing/requests")}
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
            {/* An archived request is not open for anything: its phase would only mislead. */}
            {(!isArchived || request.phase === "repaid") && phaseBadge}
            {isArchived && (
              <Badge className="bg-muted text-muted-foreground border border-border hover:bg-muted gap-1">
                <Archive className="h-3 w-3" />
                {sl ? "Arhivirano" : "Archived"}
              </Badge>
            )}
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

        {/* Administrators: approve / archive / restore */}
        {isUfAdmin && (
          <Alert className="border-primary/30">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>{sl ? "Skrbnik" : "Administrator"}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                {isArchived
                  ? sl ? "Zahtevek je arhiviran: ni na seznamu in ga ni mogoče financirati." : "The request is archived: not listed and not fundable."
                  : isPending
                    ? sl ? "Zahtevek čaka na tvojo odobritev. Vidita ga samo avtor in skrbnik." : "The request waits for your approval. Only its author and the administrators see it."
                    : sl ? "Zahtevek je odobren in javen. Znesek je zaklenjen." : "The request is approved and public. Its amount is locked."}
              </p>
              <UFAdminBar request={request} onDone={refetch} authorName={profileName(request.pubkey)} />
            </AlertDescription>
          </Alert>
        )}

        {/* The author, while the request waits for approval */}
        {isRequester && isPending && !isArchived && (
          <Alert className="border-sky-500/40 bg-sky-500/5">
            <Clock className="h-4 w-4" />
            <AlertTitle>{sl ? "Čaka na odobritev" : "Waiting for approval"}</AlertTitle>
            <AlertDescription>
              {sl
                ? "Zahtevek je oddan. Dokler ga skrbnik ne odobri, ga vidiš samo ti in skrbnik, financirati ga še ni mogoče. Do takrat ga lahko še urejaš; po odobritvi ga ne bo več mogoče spreminjati — tudi zneska ne."
                : "Your request is submitted. Until an administrator approves it, only you and the administrators see it and it cannot be funded yet. You may still edit it until then; once approved it can no longer be changed — not the amount either."}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 mt-3"
                  onClick={() => navigate(`/unconditional-financing/edit/${request.id}`)}
                >
                  <Pencil className="h-4 w-4" />
                  {sl ? "Uredi zahtevek" : "Edit the request"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* The author, once archived */}
        {isRequester && isArchived && (
          <Alert>
            <Archive className="h-4 w-4" />
            <AlertTitle>{sl ? "Arhivirano" : "Archived"}</AlertTitle>
            <AlertDescription>
              {sl
                ? "Skrbnik je ta zahtevek arhiviral: ni več na seznamu in ga ni mogoče financirati. Kar je bilo financirano, ostane zapisano; vračati lahko še naprej."
                : "An administrator archived this request: it is no longer listed and cannot be funded. What was funded stays recorded; you can keep repaying."}
            </AlertDescription>
          </Alert>
        )}

        {/* Maturing info */}
        {request.phase === "maturing" && !isArchived && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <Info className="h-4 w-4" />
            <AlertTitle>{sl ? "Obdobje zorenja" : "Maturing period"}</AlertTitle>
            <AlertDescription>
              {sl
                ? `Financiranje se odpre ${new Date(request.fundingOpensAt * 1000).toLocaleString("sl-SI")}. Do takrat prispevki še niso mogoči — vprašanja in komentarji spodaj pa so zelo dobrodošli.`
                : `Funding opens on ${new Date(request.fundingOpensAt * 1000).toLocaleString("en-GB")}. Until then contributions are not yet possible — questions and comments below are very welcome.`}
              {isRequester && (
                <>
                  <p className="mt-2">
                    {sl
                      ? "Zahtevek je odobren, zato ga ni več mogoče spreminjati. Zamenjaš lahko le denarnico, na katero prejmeš sredstva — med svojimi denarnicami."
                      : "The request is approved, so it can no longer be changed. You may only switch the wallet that receives the funds — to another of your own."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 mt-3"
                    onClick={() => navigate(`/unconditional-financing/edit/${request.id}`)}
                  >
                    <Wallet className="h-4 w-4" />
                    {sl ? "Zamenjaj denarnico" : "Switch wallet"}
                  </Button>
                </>
              )}
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
                    {/* Raised as a whole number, rounded down (src/lib/ufRaisedWhole.ts); the goal as it was. */}
                    <span className="text-3xl font-bold text-green-500">
                      {ufRaisedWhole(totalFunded)} {request.currency}
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
                {/* The server's own rule: approved, not archived, open — nothing else can be funded.
                    And once the goal is reached, "Financiran" stands in its place, not active. */}
                {contributeCta === "contribute" && (
                  <Button
                    className="w-full bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => navigate(`/unconditional-financing/contribute/${request.id}`)}
                  >
                    <HandCoins className="h-4 w-4 mr-2" />
                    {sl ? "Prispevaj" : "Contribute"}
                  </Button>
                )}
                {contributeCta === "funded" && (
                  <Button
                    disabled
                    aria-disabled="true"
                    className="w-full bg-green-600 text-white disabled:opacity-60"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {sl ? "Financiran" : "Funded"}
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
                {/* Pending: the banner above offers the edit. Maturing: the
                    maturing banner offers the wallet switch. Here it covers the
                    other phases of an approved request: only the receiving
                    wallet may still move (to another of the owner's own). */}
                {isRequester && isApproved && !isArchived && request.phase !== "maturing" && !request.isRepaid && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate(`/unconditional-financing/edit/${request.id}`)}
                  >
                    <Wallet className="h-4 w-4 mr-2" />
                    {sl ? "Zamenjaj denarnico za prejem" : "Switch the receiving wallet"}
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
                const messages = messagesByFinancier.get(financier.pubkey) || [];
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

                    {messages.length > 0 && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {messages.map((c) => (
                          <blockquote
                            key={c.id}
                            className="border-l-2 border-muted-foreground/30 pl-3"
                          >
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {c.message}
                            </p>
                            <footer className="mt-1 text-xs text-muted-foreground">
                              {/* the contribution's own currency, not the request's */}
                              {c.amountFiat.toFixed(2)} {c.currency || request.currency}
                              {c.nostrCreatedAt > 0 && (
                                <> · {format(new Date(c.nostrCreatedAt * 1000), "d MMM yyyy")}</>
                              )}
                            </footer>
                          </blockquote>
                        ))}
                      </div>
                    )}
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
