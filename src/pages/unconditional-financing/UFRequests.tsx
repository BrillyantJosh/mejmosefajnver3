import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Users,
} from "lucide-react";
import { useLang } from "@/i18n/I18nContext";
import {
  UfPhase,
  UfRequest,
  ufMaturingDaysLeft,
  ufTypeLabel,
  useUfFundedRequests,
  useUfRequests,
} from "@/hooks/useUFData";
import {
  CachedProfile,
  useNostrProfilesCacheBulk,
} from "@/hooks/useNostrProfilesCacheBulk";
import { useUfSettings } from "@/hooks/useUFSettings";
import { formatDays } from "@/lib/ufSettings";
import { ufIsFullyFunded, ufReadsFunded } from "@/lib/ufFunded";
import { ufGoalText, ufRaisedText } from "@/lib/ufMainFigures";

/**
 * "All" first and selected by default: the phases split a small set of requests
 * across three tabs, so opening the module on a single phase made the others
 * look like they did not exist.
 */
// The public list holds approved requests only, so a request waiting for approval has no tab here.
// "funded" is not a phase: it is the open requests whose goal is reached (the "Financiran" badge),
// a read-only filter over the same list. Such a request is also in "repaying" (shown in both).
// "repaying" is a filter too: only requests with at least one repayment recorded.
// "open" is likewise a read-only filter: open for funding (fundable) and the goal not yet reached.
type UfTab = "open" | "all" | "funded" | Exclude<UfPhase, "pending">;
const TAB_ORDER: UfTab[] = ["open", "maturing", "funded", "repaying", "repaid", "all"];
const PAGE_SIZE = 20;

/** Slovenian declension for "financer" (1 financer, 2 financerja, 3–4 financerji, 5+ financerjev). */
const financierLabel = (n: number, sl: boolean): string => {
  if (!sl) return n === 1 ? "financier" : "financiers";
  const mod = n % 100;
  if (mod === 1) return "financer";
  if (mod === 2) return "financerja";
  if (mod === 3 || mod === 4) return "financerji";
  return "financerjev";
};

// ── Card (local component — clones the ProjectCard visual language) ──

interface UfRequestCardProps {
  request: UfRequest;
  profile?: CachedProfile;
  sl: boolean;
}

const UfRequestCard = ({ request, profile, sl }: UfRequestCardProps) => {
  const navigate = useNavigate();
  // Graceful fallback when a cover image fails to load.
  const [coverError, setCoverError] = useState(false);

  const goalAmount = request.fiatGoal || 0;
  const totalFunded = request.totalFunded || 0;
  const totalRepaid = request.totalRepaid || 0;
  const financiers = request.financierCount || 0;
  // The goal is reached: "Financiran", and no "Prispevaj" (Jasna, Brilly 16. 11. 2026;
  // src/lib/ufFunded.ts). Below the goal the card never rounds up to "100%".
  const isFunded = ufReadsFunded(request, totalFunded);
  const fundedPercentage =
    goalAmount > 0
      ? ufIsFullyFunded(totalFunded, goalAmount)
        ? 100
        : Math.min(Math.round((totalFunded / goalAmount) * 100), 99)
      : 0;

  const daysLeft = ufMaturingDaysLeft(request.fundingOpensAt);
  const requesterName =
    profile?.display_name ||
    profile?.full_name ||
    `${request.pubkey.slice(0, 8)}...`;

  const openDetail = () => {
    navigate(`/unconditional-financing/request/${request.id}`);
  };

  const publishedTs = request.publishedAt || request.nostrCreatedAt;

  return (
    <Card
      className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer flex flex-col"
      onClick={openDetail}
    >
      {/* Cover Image (gradient + first letter fallback) */}
      <div className="aspect-video w-full overflow-hidden relative">
        {request.coverImage && !coverError ? (
          <img
            src={request.coverImage}
            alt={request.title}
            className="w-full h-full object-cover"
            onError={() => setCoverError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-500/15 to-emerald-500/10">
            <span className="text-6xl font-bold text-green-600/50 select-none">
              {request.title?.trim()?.charAt(0)?.toUpperCase() || "?"}
            </span>
          </div>
        )}
        {isFunded && (
          <Badge className="absolute top-3 right-3 bg-green-600 hover:bg-green-600 text-white gap-1.5 shadow">
            <CheckCircle className="h-4 w-4" />
            {sl ? "Financiran" : "Funded"}
          </Badge>
        )}
        {request.phase === "repaid" && (
          <div className="absolute inset-0 bg-green-600/20 flex items-center justify-center">
            <Badge className="bg-green-600 text-white text-lg px-4 py-1.5 gap-2">
              <CheckCircle className="h-5 w-5" />
              {sl ? "Poplačano" : "Repaid"}
            </Badge>
          </div>
        )}
      </div>

      <CardContent className="p-6 space-y-4 flex-1 flex flex-col">
        {/* Title */}
        <h3 className="text-2xl font-bold text-green-600">{request.title}</h3>

        {/* Request Type Badge */}
        <div>
          <Badge
            variant="outline"
            className="text-xs font-medium border-indigo-300 text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300"
          >
            {ufTypeLabel(request.requestType, sl)}
          </Badge>
        </div>

        {/* Short Description */}
        <p className="text-muted-foreground line-clamp-3">{request.shortDesc}</p>

        {/* Requester */}
        <div className="flex items-center gap-3 pt-2">
          <UserAvatar
            pubkey={request.pubkey}
            picture={profile?.picture}
            name={profile?.display_name || profile?.full_name}
            className="h-10 w-10"
          />
          <div>
            <p className="text-xs text-muted-foreground">
              {sl ? "Prejemnik" : "Recipient"}
            </p>
            <p className="font-medium">{requesterName}</p>
          </div>
        </div>

        {/* Funding Stats — raised as a whole number, rounded down (Jasna, Brilly 16. 11. 2026),
            raised and goal with a thousands separator, the goal never rounded (17. 11. 2026;
            src/lib/ufMainFigures.ts). "Financiran" above stays on the exact cents. */}
        <div className="flex items-baseline justify-between pt-4 mt-auto">
          <div>
            <span className="text-3xl font-bold">{ufRaisedText(totalFunded, sl)}</span>
            <span className="text-lg text-muted-foreground ml-1">
              {request.currency}
            </span>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            {sl ? "Cilj:" : "Goal:"} {ufGoalText(goalAmount, sl)} {request.currency}
          </div>
        </div>

        {/* Progress Bar */}
        <Progress value={fundedPercentage} className="h-2" />

        {/* Financiers, Percentage, Published Date */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>
                {financiers} {financierLabel(financiers, sl)}
              </span>
            </div>
            <span>
              {fundedPercentage}% {sl ? "zbrano" : "funded"}
            </span>
          </div>
          {publishedTs > 0 && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-xs">
                {format(new Date(publishedTs * 1000), "dd MMM yyyy")}
              </span>
            </div>
          )}
        </div>

        {/* Repayment stats (repaying / repaid phases) */}
        {request.phase !== "maturing" && (
          <div className="flex items-center gap-2 text-sm rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
            <span className="text-green-700 dark:text-green-300">
              {sl
                ? `Poplačano ${totalRepaid.toFixed(2)} / zbrano ${totalFunded.toFixed(2)} ${request.currency}`
                : `Repaid ${totalRepaid.toFixed(2)} / funded ${totalFunded.toFixed(2)} ${request.currency}`}
            </span>
          </div>
        )}

        {/* Phase CTA / status */}
        {request.phase === "maturing" ? (
          <Badge className="w-full justify-center bg-amber-500 text-white gap-1.5 py-2 text-sm">
            <Clock className="h-4 w-4" />
            {daysLeft > 0
              ? sl
                ? `Odpre se čez ${daysLeft} ${daysLeft === 1 ? "dan" : daysLeft === 2 ? "dneva" : "dni"}`
                : `Opens in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
              : sl
                ? "Odpre se kmalu"
                : "Opens soon"}
          </Badge>
        ) : request.phase === "repaying" && isFunded ? (
          <Button
            disabled
            aria-disabled="true"
            className="w-full bg-green-600 text-white disabled:opacity-60"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {sl ? "Financiran" : "Funded"}
          </Button>
        ) : request.phase === "repaying" ? (
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/unconditional-financing/contribute/${request.id}`);
            }}
          >
            <Heart className="h-4 w-4 mr-2" />
            {sl ? "Prispevaj" : "Contribute"}
          </Button>
        ) : (
          <Badge className="w-full justify-center bg-green-600 text-white gap-1.5 py-2 text-sm">
            <CheckCircle className="h-4 w-4" />
            {sl ? "Poplačano" : "Repaid"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
};

// ── Skeleton card (loading state) ──

const UfRequestCardSkeleton = () => (
  <Card className="overflow-hidden">
    <Skeleton className="aspect-video w-full rounded-none" />
    <CardContent className="p-6 space-y-4">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <div className="flex items-center gap-3 pt-2">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-9 w-full" />
    </CardContent>
  </Card>
);

// ── Page ──

const UFRequests = () => {
  const sl = useLang() === "sl";
  const [tab, setTab] = useState<UfTab>("open");
  const [page, setPage] = useState(1);

  const { settings: ufSettings } = useUfSettings();
  const isFilterTab = tab === "funded" || tab === "open" || tab === "repaying";
  const base = useUfRequests(isFilterTab ? "repaying" : tab, isFilterTab ? 1 : page, isFilterTab ? 1 : PAGE_SIZE);
  const fundedList = useUfFundedRequests();
  const { counts } = base;
  const filterItems =
    tab === "open" ? fundedList.open : tab === "repaying" ? fundedList.repaying : fundedList.funded;
  const fundedPages = Math.max(1, Math.ceil(filterItems.length / PAGE_SIZE));
  const requests = isFilterTab
    ? filterItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : base.requests;
  const totalPages = isFilterTab ? fundedPages : base.totalPages;
  const isLoading = isFilterTab ? fundedList.isLoading : base.isLoading;
  const error = isFilterTab ? fundedList.error : base.error;
  const refetch = isFilterTab ? fundedList.refetch : base.refetch;
  // "All" is the sum of the phases, so every tab carries a number.
  const tabCount = (t: UfTab): number =>
    t === "all"
      ? counts.maturing + counts.repaying + counts.repaid
      : t === "funded"
        ? fundedList.funded.length
        : t === "open"
          ? fundedList.open.length
          : t === "repaying"
            ? fundedList.repaying.length
            : counts[t];


  // Bulk profile lookup for all requesters on the current page.
  const requesterPubkeys = useMemo(
    () => Array.from(new Set(requests.map((r) => r.pubkey))),
    [requests],
  );
  const { profiles } = useNostrProfilesCacheBulk(requesterPubkeys);

  const tabLabels: Record<UfTab, string> = {
    open: sl ? "Odprti" : "Open",
    all: sl ? "Vsi" : "All",
    maturing: sl ? "V zorenju" : "Maturing",
    funded: sl ? "Financirani" : "Funded",
    repaying: sl ? "V odplačevanju" : "Repaying",
    repaid: sl ? "Poplačani" : "Repaid",
  };

  const emptyStates: Record<UfTab, { title: string; hint: string }> = {
    open: {
      title: sl
        ? "Trenutno ni zahtevkov, odprtih za financiranje."
        : "No requests are open for funding right now.",
      hint: sl
        ? "Ko je zahtevek odprt za financiranje in cilj še ni dosežen, se prikaže tukaj."
        : "A request appears here while it is open for funding and its goal is not yet reached.",
    },
    all: {
      title: sl
        ? "Ni še nobenega zahtevka za financiranje."
        : "There are no financing requests yet.",
      hint: sl
        ? "Bodi prvi — objavi zahtevek za financiranje."
        : "Be the first — publish a financing request.",
    },
    maturing: {
      title: sl
        ? "Trenutno noben zahtevek ne zori."
        : "No requests are maturing right now.",
      hint: sl
        ? "Bodi prvi — objavi zahtevek za financiranje."
        : "Be the first — publish a financing request.",
    },
    funded: {
      title: sl
        ? "Noben zahtevek še ni financiran."
        : "No requests are funded yet.",
      hint: sl
        ? "Ko zahtevek doseže cilj financiranja, se prikaže tukaj."
        : "Once a request reaches its funding goal, it appears here.",
    },
    repaying: {
      title: sl
        ? "Noben zahtevek še ne vrača sredstev."
        : "No request has started repaying yet.",
      hint: sl
        ? "Ko prejemnik vrne prvi znesek, se zahtevek prikaže tukaj."
        : "Once a recipient makes the first repayment, the request appears here.",
    },
    repaid: {
      title: sl
        ? "Noben zahtevek še ni v celoti poplačan."
        : "No requests have been fully repaid yet.",
      hint: sl
        ? "Ko prejemnik v celoti vrne prejeta sredstva, se zahtevek prikaže tukaj."
        : "Once a recipient fully repays the received funds, the request appears here.",
    },
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-bold">
          {sl ? "Brezpogojno financiranje" : "Unconditional Financing"}
        </h1>
        <p className="text-muted-foreground">
          {sl
            ? "Skupnost, ki človeku zaupa"
            : "A community that trusts the person"}
        </p>
      </div>

      {/* Phase Tabs */}
      <div className="flex flex-wrap gap-2">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tabLabels[t]}
            {tabCount(t) > 0 && (
              <span
                className={`ml-1.5 text-xs ${
                  tab === t ? "text-primary-foreground/80" : "text-muted-foreground/80"
                }`}
              >
                {tabCount(t)}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <UfRequestCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">
            {sl
              ? "Zahtevkov ni bilo mogoče naložiti."
              : "Could not load the requests."}
          </p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {sl ? "Poskusi znova" : "Try again"}
          </Button>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{emptyStates[tab].title}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {emptyStates[tab].hint}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {requests.map((request) => (
              <UfRequestCard
                key={request.id}
                request={request}
                profile={profiles.get(request.pubkey)}
                sl={sl}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                {sl ? "Nazaj" : "Prev"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {sl
                  ? `Stran ${page} od ${totalPages}`
                  : `Page ${page} of ${totalPages}`}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                {sl ? "Naprej" : "Next"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UFRequests;
