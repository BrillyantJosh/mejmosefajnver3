import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/i18n/I18nContext";
import befInterestText from "@/i18n/modules/befInterest";
import type { InterestView, InterestWindows } from "@/lib/bef/api";
import type { InterestPrefill } from "@/lib/bef/prefill";
import { problemCode } from "@/lib/bef/problems";
import type { InterestDraft, InterestStatus } from "@/lib/bef/vendor/server/lib/interestEvent.ts";
import { countryByCode } from "@/lib/bef/vendor/server/lib/countries.ts";
import { flagEmoji } from "@/lib/bef/vendor/src/lib/format.ts";
import { useBefPerson, type BefStage } from "@/pages/bef/BefPersonProvider";
import { BefText } from "../BefText";
import { InterestSplitCard } from "./InterestSplitCard";
import {
  arrivedInterest,
  blankEditor,
  defaultCurrency,
  interestSendProblem,
  prefillEditor,
  readInterestForm,
  sendInterest,
  visibleWindows,
  withdrawalDraft,
  type InterestEditor,
  type InterestOutcome,
  type InterestProblem,
} from "./interestModel";

type SignedIn = Extract<BefStage, { kind: "signedIn" }>;

/**
 * Expressing interest, once signed in to BEF Explorer.
 *
 * For every split with a round open for interest (KIND 38888
 * split_interest_open, only ever the current and the next split), the person
 * picks a currency and says how much they would co-create in each open round —
 * within the round sizes, the most one co-creator may put into a round, and the
 * split's co-creation maximum. The limits are checked here with the function
 * BEF refuses with, BEFORE anything is signed, so a refusal after signing is
 * the exception.
 *
 * The KIND 30970 is built by the vendored interestEvent.ts and signed in this
 * browser with the key the person is logged in to MejmoSefajn with — never
 * typed, never sent. One live interest per person per split: a change replaces
 * it, a withdrawal is the same event with no rounds.
 *
 * Ported from bef-explorer src/components/person/InterestForm.tsx. Left out:
 * the key field (there is no key to type) and Sign out (logging out of
 * MejmoSefajn signs out of BEF Explorer too).
 */
export function InterestForm({ signedIn, prefill }: { signedIn: SignedIn; prefill: InterestPrefill }) {
  const { t } = useTranslation(befInterestText);
  const { client, withSession } = useBefPerson();
  const { person } = signedIn;

  const [windows, setWindows] = useState<InterestWindows | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "no_parameters" | "failed">("loading");
  const [mine, setMine] = useState<InterestView[]>([]);
  const [editors, setEditors] = useState<Record<number, InterestEditor>>({});
  const [busySplit, setBusySplit] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, InterestOutcome>>({});
  const [problems, setProblems] = useState<Record<number, InterestProblem>>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState<number | null>(null);
  const prefilled = useRef(false);

  const fallbackCurrency = defaultCurrency(person.country);

  // Read through a ref, so a new prefill or profile does not restart the loading below.
  const latest = useRef({ prefill, fallbackCurrency });
  latest.current = { prefill, fallbackCurrency };

  /** `quiet`: a read again after a send — its failure leaves the page and the send's words as they are. */
  const loadWindows = useCallback(
    async (quiet = false): Promise<InterestWindows | null> => {
      try {
        const next = await client.interest.windows();
        setWindows(next);
        return next;
      } catch (err) {
        if (!quiet) setLoadState(problemCode(err) === "no_parameters" ? "no_parameters" : "failed");
        return null;
      }
    },
    [client],
  );

  const loadMine = useCallback(
    async (quiet = false): Promise<InterestView[] | null> => {
      try {
        // A session BEF no longer knows is replaced once; a sign-in that is refused
        // then takes the page back to the door by itself.
        const next = await withSession(({ token }) => client.interest.mine(token));
        setMine(next.interests);
        return next.interests;
      } catch {
        if (!quiet) setLoadState("failed");
        return null;
      }
    },
    [client, withSession],
  );

  const loadAll = useCallback(async () => {
    setLoadState("loading");
    const [w, m] = await Promise.all([loadWindows(), loadMine()]);
    if (!w || !m) return;
    setLoadState("ready");
    // The calculator's choice, once.
    if (!prefilled.current) {
      prefilled.current = true;
      const filled = prefillEditor(latest.current.prefill, w, m, latest.current.fallbackCurrency);
      if (filled) setEditors((all) => ({ ...all, [filled.split]: filled.editor }));
    }
  }, [loadWindows, loadMine]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const editorFor = (split: number): InterestEditor =>
    editors[split] ?? blankEditor(mine.find((i) => i.split === split), fallbackCurrency);

  const patchEditor = (split: number, patch: Partial<InterestEditor>) =>
    setEditors((all) => ({
      ...all,
      [split]: { ...(all[split] ?? blankEditor(mine.find((i) => i.split === split), fallbackCurrency)), ...patch },
    }));

  const setProblem = (split: number, problem: InterestProblem | null) =>
    setProblems((all) => {
      const next = { ...all };
      if (problem) next[split] = problem;
      else delete next[split];
      return next;
    });

  const setOutcome = (split: number, outcome: InterestOutcome | null) =>
    setOutcomes((all) => {
      const next = { ...all };
      if (outcome) next[split] = outcome;
      else delete next[split];
      return next;
    });

  const send = async (split: number, status: InterestStatus) => {
    if (!windows || busySplit != null) return;
    const win = windows.windows.find((w) => w.split === split);
    if (!win) return;
    const existing = mine.find((i) => i.split === split);

    let draft: InterestDraft;
    if (status === "withdrawn") {
      if (!existing || existing.status !== "active") return;
      draft = withdrawalDraft(existing, person.wallet, windows.paramsEventId);
    } else {
      const form = readInterestForm(win, editorFor(split), person.wallet, windows.paramsEventId);
      if (form.notWhole.length || form.limitErrors.length || form.draft.rounds.length === 0) {
        patchEditor(split, { tried: true });
        return;
      }
      draft = form.draft;
    }

    setBusySplit(split);
    setProblem(split, null);
    setOutcome(split, null);
    const signed: string[] = [];
    try {
      const result = await sendInterest({ client, withSession, win, draft, previous: existing, onSigned: (eventId) => signed.push(eventId) });
      setMine((list) => [...list.filter((i) => i.split !== split), result.interest]);
      setOutcome(split, { status, eventId: result.interest.eventId, relays: result.relays });
      patchEditor(split, { editing: false, tried: false, amounts: {} });
    } catch (err) {
      const problem = interestSendProblem(err, draft.currency);
      if (problem.reload === "windows") await loadWindows(true);
      if (problem.reload === "mine") {
        const now = await loadMine(true);
        if (problem.code === "outcome_unknown") {
          // The answer never came: what BEF holds now says whether it went through.
          const arrived = arrivedInterest(now, split, signed);
          if (arrived) {
            setOutcome(split, { status, eventId: arrived.eventId, relays: null });
            patchEditor(split, { editing: false, tried: false, amounts: {} });
            return;
          }
          // Not there (yet): the card shows what BEF holds right under the words;
          // what was typed is kept.
          patchEditor(split, { editing: false, tried: false });
        }
      }
      setProblem(split, problem);
    } finally {
      setBusySplit(null);
    }
  };

  const startChange = (existing: InterestView) => {
    const amounts: Record<number, string> = {};
    for (const r of existing.rounds) amounts[r.round] = String(r.amount);
    patchEditor(existing.split, { currency: existing.currency, amounts, editing: true, tried: false });
    setOutcome(existing.split, null);
  };

  const country = countryByCode(person.country);

  const header = (
    <div className="space-y-1 text-xs sm:text-sm text-muted-foreground">
      <p className="min-w-0 break-all">
        {country && (
          <>
            {flagEmoji(country.code)} {country.code} ·{" "}
          </>
        )}
        {t("interest.wallet")}: <code className="font-mono text-foreground">{person.wallet}</code>
      </p>
      <p>{t("reg.signedWithSession")}</p>
    </div>
  );

  if (loadState === "loading" && !windows) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{t("interest.loading")}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadState === "no_parameters" || loadState === "failed" || !windows) {
    return (
      <div className="space-y-4">
        {header}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p>{t(loadState === "no_parameters" ? "interest.noParameters" : "interest.loadError")}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void loadAll()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t("interest.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const problemSplits = Object.keys(problems).map(Number);
  const visible = visibleWindows(windows, mine, problemSplits);
  // A refusal for a split no longer listed at all (the split moved on) is said above the cards.
  const unlisted = problemSplits.filter((split) => !windows.windows.some((w) => w.split === split));
  const unlistedProblems = unlisted.map((split) => (
    <Alert key={`unlisted-${split}`} variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        {t("interest.splitTitle", { number: split })}: <BefText text={t(problems[split].text, problems[split].vars)} />
      </AlertDescription>
    </Alert>
  ));

  return (
    <div className="space-y-4">
      {header}
      {visible.length > 0 && <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{t("interest.howItWorks")}</p>}
      {unlistedProblems}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h3 className="text-lg font-semibold">{t("interest.noneOpen")}</h3>
            <p className="text-sm text-muted-foreground">{t("interest.noneOpenText")}</p>
            <Link to="/bef" className="inline-block text-sm font-medium text-primary hover:underline">
              {t("interest.backToCalculator")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        visible.map((w) => (
          <InterestSplitCard
            key={w.split}
            win={w}
            existing={mine.find((i) => i.split === w.split)}
            editor={editorFor(w.split)}
            wallet={person.wallet}
            paramsEventId={windows.paramsEventId}
            busy={busySplit === w.split}
            locked={busySplit != null}
            outcome={outcomes[w.split]}
            problem={problems[w.split]}
            onPatch={(patch) => patchEditor(w.split, patch)}
            onSend={() => void send(w.split, "active")}
            onChange={() => {
              const existing = mine.find((i) => i.split === w.split);
              if (existing) startChange(existing);
            }}
            onWithdraw={() => setConfirmWithdraw(w.split)}
          />
        ))
      )}

      <AlertDialog open={confirmWithdraw != null} onOpenChange={(open) => !open && setConfirmWithdraw(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("interest.withdraw")}</AlertDialogTitle>
            <AlertDialogDescription>{t("interest.withdrawConfirm", { number: confirmWithdraw ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("interest.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmWithdraw != null) void send(confirmWithdraw, "withdrawn");
                setConfirmWithdraw(null);
              }}
            >
              {t("interest.withdraw")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
