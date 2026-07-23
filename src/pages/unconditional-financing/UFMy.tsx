import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, HandCoins, Heart, ImageOff, PlusCircle, Undo2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/i18n/I18nContext";
import {
  useUfMySupports,
  useUfMyFinancings,
  ufMaturingDaysLeft,
  UfPhase,
  UfMySupport,
  UfMyFinancing,
} from "@/hooks/useUFData";

/**
 * Unconditional Financing — "My" overview.
 * Section 1: financings I supported as a financier (my share, repaid to me,
 * outstanding to me). Section 2: financing requests I created/received
 * (funded vs goal, repaid, outstanding, repay action).
 */

// ── shared bits ──

const phaseLabel = (phase: UfPhase, sl: boolean): string => {
  switch (phase) {
    case "maturing":
      return sl ? "Zorenje" : "Maturing";
    case "repaying":
      return sl ? "V odplačevanju" : "Repaying";
    case "repaid":
      return sl ? "Poplačano" : "Repaid";
    default:
      return phase;
  }
};

const PhaseBadge = ({ phase, sl }: { phase: UfPhase; sl: boolean }) => {
  const cls =
    phase === "repaid"
      ? "bg-green-500 hover:bg-green-500 text-white"
      : phase === "repaying"
        ? "bg-blue-500 hover:bg-blue-500 text-white"
        : "bg-amber-500 hover:bg-amber-500 text-white";
  return <Badge className={`${cls} text-xs`}>{phaseLabel(phase, sl)}</Badge>;
};

const CoverThumb = ({ src, alt }: { src: string | null; alt: string }) => (
  <div className="w-16 h-16 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
    {src ? (
      <img src={src} alt={alt} className="w-16 h-16 rounded object-cover" />
    ) : (
      <ImageOff className="h-6 w-6 text-muted-foreground/50" />
    )}
  </div>
);

const fiat = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;

const opensInLabel = (days: number, sl: boolean): string => {
  if (sl) return days === 1 ? "Odpre se čez 1 dan" : `Odpre se čez ${days} dni`;
  return days === 1 ? "Opens in 1 day" : `Opens in ${days} days`;
};

const SectionSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-28 w-full" />
    <Skeleton className="h-28 w-full" />
  </div>
);

// ── Section 1: My supports ──

const SupportCard = ({ support, sl }: { support: UfMySupport; sl: boolean }) => {
  const { request } = support;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex gap-3">
          <CoverThumb src={request.coverImage} alt={request.title} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Link
                to={`/unconditional-financing/request/${request.id}`}
                className="font-semibold text-base hover:underline truncate"
              >
                {request.title}
              </Link>
              <PhaseBadge phase={request.phase} sl={sl} />
              <Badge variant="secondary" className="text-xs">
                {support.sharePercent.toFixed(1)}%{" "}
                {sl ? "delež" : "share"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm mt-2">
              <div>
                <span className="text-muted-foreground block text-xs">
                  {sl ? "Moj prispevek" : "My contribution"}
                </span>
                <span className="font-medium">
                  {fiat(support.myFiat, request.currency)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">
                  {sl ? "Že vrnjeno meni" : "Repaid to me"}
                </span>
                <span className="font-medium text-green-600 dark:text-green-500">
                  {fiat(support.repaidToMe, request.currency)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">
                  {sl ? "Odprto do mene" : "Outstanding to me"}
                </span>
                <span className="font-medium text-amber-600 dark:text-amber-500">
                  {fiat(support.outstandingToMe, request.currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ── Section 2: My financings ──

const FinancingCard = ({
  financing,
  sl,
  onRepay,
}: {
  financing: UfMyFinancing;
  sl: boolean;
  onRepay: (id: string) => void;
}) => {
  const { request } = financing;
  const goal = request.fiatGoal || 0;
  const progressPercent =
    goal > 0 ? Math.min((financing.totalFunded / goal) * 100, 100) : 0;
  const maturingDays =
    request.phase === "maturing" ? ufMaturingDaysLeft(request.fundingOpensAt) : 0;
  const canRepay = financing.totalFunded > 0 && !request.isRepaid;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex gap-3">
          <CoverThumb src={request.coverImage} alt={request.title} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Link
                to={`/unconditional-financing/request/${request.id}`}
                className="font-semibold text-base hover:underline truncate"
              >
                {request.title}
              </Link>
              <PhaseBadge phase={request.phase} sl={sl} />
              {request.phase === "maturing" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-medium px-2 py-0.5">
                  <Clock className="h-3 w-3" />
                  {opensInLabel(maturingDays, sl)}
                </span>
              )}
            </div>

            {/* Funding progress */}
            <div className="space-y-1 mt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {sl ? "Financirano" : "Funded"}:{" "}
                  <span className="text-foreground font-medium">
                    {fiat(financing.totalFunded, request.currency)}
                  </span>{" "}
                  / {fiat(goal, request.currency)}
                </span>
                <span className="font-medium">{progressPercent.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm mt-3">
              <div>
                <span className="text-muted-foreground block text-xs">
                  {sl ? "Že vrnjeno" : "Repaid"}
                </span>
                <span className="font-medium text-green-600 dark:text-green-500">
                  {fiat(financing.totalRepaid, request.currency)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">
                  {sl ? "Odprto" : "Outstanding"}
                </span>
                <span className="font-medium text-amber-600 dark:text-amber-500">
                  {fiat(financing.outstanding, request.currency)}
                </span>
              </div>
            </div>

            {canRepay && (
              <div className="flex justify-end mt-3">
                <Button size="sm" className="gap-1" onClick={() => onRepay(request.id)}>
                  <Undo2 className="h-4 w-4" />
                  {sl ? "Vrni sredstva" : "Repay"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ── Page ──

const UFMy = () => {
  const navigate = useNavigate();
  const sl = useLang() === "sl";
  const { session } = useAuth();

  const { supports, isLoading: supportsLoading } = useUfMySupports(session?.nostrHexId);
  const { financings, isLoading: financingsLoading } = useUfMyFinancings(
    session?.nostrHexId,
  );

  if (!session) return null;

  return (
    <div className="container mx-auto p-4 sm:p-6 pb-24 space-y-8">
      <h1 className="text-3xl font-bold">
        {sl ? "Moje brezpogojno financiranje" : "My unconditional financing"}
      </h1>

      {/* ── Section 1: My supports ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">
            {sl ? "Moje podpore" : "My supports"}
          </h2>
        </div>

        {supportsLoading ? (
          <SectionSkeleton />
        ) : supports.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <p className="text-muted-foreground">
                {sl
                  ? "Nisi še podprl nobenega financiranja."
                  : "You haven't supported any financing yet."}
              </p>
              <Button
                className="gap-2"
                onClick={() => navigate("/unconditional-financing")}
              >
                <HandCoins className="h-4 w-4" />
                {sl ? "Preglej financiranja" : "Browse financings"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {supports.map((support) => (
              <SupportCard key={support.request.id} support={support} sl={sl} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: My financings ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <HandCoins className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">
            {sl ? "Moja financiranja" : "My financings"}
          </h2>
        </div>

        {financingsLoading ? (
          <SectionSkeleton />
        ) : financings.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <p className="text-muted-foreground">
                {sl
                  ? "Še ni zahtevkov za financiranje."
                  : "No financing requests yet."}
              </p>
              <Button
                className="gap-2"
                onClick={() => navigate("/unconditional-financing/create")}
              >
                <PlusCircle className="h-4 w-4" />
                {sl ? "Nov zahtevek" : "New request"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {financings.map((financing) => (
              <FinancingCard
                key={financing.request.id}
                financing={financing}
                sl={sl}
                onRepay={(id) => navigate(`/unconditional-financing/repay/${id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default UFMy;
