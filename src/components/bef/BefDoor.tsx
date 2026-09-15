import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/i18n/I18nContext";
import befText from "@/i18n/modules/befText";
import { BEF_PUBLIC_URL } from "@/lib/bef/base";
import { offersBef, type BefProblem } from "@/lib/bef/problems";
import { useBefPerson, type BefStage } from "@/pages/bef/BefPersonProvider";
import { BefRegistration } from "./BefRegistration";
import { BefText, shortWallet } from "./BefText";

type SignedIn = Extract<BefStage, { kind: "signedIn" }>;

/**
 * The door in front of a BEF page that needs the person signed in (Interest,
 * My Circle). There is nothing to press: opening the page signs in on its own
 * (BefPersonProvider), the page's content shows once BEF has opened a session,
 * and a short note says what BEF Explorer checks and keeps — information,
 * never a step to get past.
 *
 * Until then it shows the sign-in running, BEF's registration card when the
 * wallet or profile is missing, or the refusal in plain words with the one
 * thing the person can do about it.
 */
export function BefDoor({
  children,
  interestOpen = null,
}: {
  children: (signedIn: SignedIn) => ReactNode;
  /** For the registration card: whether any split is open for interest (null: not known). */
  interestOpen?: boolean | null;
}) {
  const { t } = useTranslation(befText);
  const { stage, ensureSignedIn, retry } = useBefPerson();

  useEffect(() => {
    if (stage.kind === "idle") ensureSignedIn();
  }, [stage.kind, ensureSignedIn]);

  const note = (
    <div className="flex gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs sm:text-sm text-muted-foreground">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium text-foreground">{t("door.noteTitle")}</p>
        <p className="mt-1 leading-relaxed">{t("door.note")}</p>
      </div>
    </div>
  );

  switch (stage.kind) {
    case "idle":
    case "checking":
      return (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>{t("door.signingIn")}</span>
            </CardContent>
          </Card>
          {note}
        </div>
      );

    case "signedIn": {
      const name = stage.person.displayName || stage.person.name || `${stage.hex.slice(0, 8)}…`;
      return (
        <div className="space-y-4">
          {/* Wraps rather than cuts: the wallet comes last, and on a phone a cut
              line never shows which wallet BEF signed the person in with. */}
          <div className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="min-w-0 break-words">
              {t("door.signedInAs", { name, wallet: shortWallet(stage.person.wallet) })}
            </span>
          </div>
          <details className="group text-xs sm:text-sm text-muted-foreground">
            <summary className="cursor-pointer select-none">{t("door.noteTitle")}</summary>
            <p className="mt-2 leading-relaxed">{t("door.note")}</p>
          </details>
          {children(stage)}
        </div>
      );
    }

    case "register":
      return (
        <div className="space-y-4">
          <BefRegistration mode={stage.mode} address={stage.address} interestOpen={interestOpen} />
          {note}
        </div>
      );

    case "refused":
    case "failed":
      return (
        <div className="space-y-4">
          <DoorProblem problem={stage.problem} onRetry={retry} />
          {note}
        </div>
      );
  }
}

function DoorProblem({ problem, onRetry }: { problem: BefProblem; onRetry: () => void }) {
  const { t } = useTranslation(befText);
  return (
    <Alert variant={problem.action === "retry" ? "default" : "destructive"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p className="leading-relaxed">
          <BefText text={t(problem.text, problem.vars)} />
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {problem.action === "openProfile" && (
            <Button asChild size="sm" variant="outline">
              <Link to="/profile">{t("door.openProfile")}</Link>
            </Button>
          )}
          {offersBef(problem) && (
            <Button asChild size="sm" variant="outline">
              <a href={BEF_PUBLIC_URL} target="_blank" rel="noopener noreferrer">
                {t("door.openBef")}
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {(problem.action === "retry" || problem.action === "openProfile") && (
            <Button size="sm" onClick={onRetry}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t("door.tryAgain")}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
