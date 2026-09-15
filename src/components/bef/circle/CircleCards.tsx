import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, UserPlus } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/I18nContext";
import befCircleText from "@/i18n/modules/befCircle";
import type { CardListView as PublishedList } from "@/lib/bef/api";
import { loadPendingCards, reconcilePending, savePendingCards, shortCardId } from "@/lib/bef/vendor/src/lib/cardList.ts";
import { fmtDateTime } from "@/lib/bef/vendor/src/lib/format.ts";
import { useBefPerson } from "@/pages/bef/BefPersonProvider";
import { CardAddBox } from "./CardAddBox";
import { CardListView } from "./CardListView";
import { PendingCardsView } from "./PendingCardsView";
import {
  allowanceProblem,
  checkCard,
  publishAnswer,
  publishCards,
  publishedMessage,
  type CardAllowance,
  type CardStatusCall,
  type CircleMessage,
} from "./cardChecks";
import { cardInputProblem, readCardInput, type CardCandidate } from "./cardInput";

/** This tab's own storage: waiting changes are dropped with the tab. */
const pendingStorage = () => sessionStorage;

/**
 * My Circle, once BEF Explorer has opened a session: the person's own list of
 * the cards they brought into the Circle of Abundance (KIND 30971). Ported from
 * bef-explorer src/components/person/CardList.tsx.
 *
 * A card is added by scanning or typing its private key (WIF), or by typing the
 * person's Nostr hex id. The key is read in this browser only, to work out the
 * card's hex id (./cardInput.ts); only then does BEF hear the hex id, and says
 * whether the card is free for this person — never who holds it. A card typed
 * as its hex id goes on the list only when a KIND 0 profile exists for it, and
 * the name that profile gives is shown first. 64 hex characters that turn out
 * to be a private key are refused and go nowhere (./cardChecks.ts).
 *
 * New cards and removals wait in this tab (hex ids only, vendored cardList.ts)
 * until the person publishes them: one signature with the key they are logged
 * in to MejmoSefajn with publishes every waiting change as one new list —
 * removals too, after a confirmation. A list is built on the one BEF holds, so
 * a window with an old view is refused instead of wiping out what another
 * window published.
 *
 * New cards are counted over 30 days: the page shows how many can still be
 * added and checks the waiting ones against that before anything is signed. A
 * list is not an agreement and not a promise of any commission.
 */
export function CircleCards({ hex }: { hex: string }) {
  const { t } = useTranslation(befCircleText);
  const { client, withSession } = useBefPerson();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [list, setList] = useState<PublishedList | null>(null);
  const [listedAsCard, setListedAsCard] = useState(false);
  const [allowance, setAllowance] = useState<CardAllowance | null>(null);
  const [pendingAdds, setPendingAdds] = useState<string[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<string[]>([]);
  /** A card is being read or asked about. */
  const [checking, setChecking] = useState(false);
  /** A card whose check found no answer: asked again by its public id. */
  const [retryCard, setRetryCard] = useState<CardCandidate | null>(null);
  /** Names the profile check found for waiting cards typed as hex ids. */
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [addProblem, setAddProblem] = useState<CircleMessage | null>(null);
  const [message, setMessage] = useState<CircleMessage | null>(null);
  /** The changes kept in this tab were read back — before that, nothing is written over them. */
  const restored = useRef(false);

  const ready = loadState === "ready";
  const published = list?.cards.map((card) => card.hex) ?? [];
  const pendingCount = pendingAdds.length + pendingRemoves.length;
  const anyPending = pendingCount > 0;

  /**
   * The list as BEF holds it, and how many new cards can still be added.
   * Waiting changes are set against it: what it already carries is no longer
   * waiting. `quiet`: a failure leaves the page as it is.
   */
  const loadMine = useCallback(
    async (quiet = false): Promise<boolean> => {
      try {
        const mine = await withSession(({ token }) => client.cards.mine(token));
        const cards = mine.list?.cards.map((card) => card.hex) ?? [];
        setList(mine.list);
        setListedAsCard(mine.listedAsCard);
        setAllowance(mine.allowance);
        if (restored.current) {
          setPendingAdds((adds) => reconcilePending({ adds, removes: [] }, cards).adds);
          setPendingRemoves((removes) => reconcilePending({ adds: [], removes }, cards).removes);
        } else {
          const kept = reconcilePending(loadPendingCards(pendingStorage, hex), cards);
          setPendingAdds(kept.adds);
          setPendingRemoves(kept.removes);
          restored.current = true;
        }
        setLoadState("ready");
        return true;
      } catch {
        if (!quiet) setLoadState("failed");
        return false;
      }
    },
    [withSession, client, hex],
  );

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // Every change is kept in this tab at once, so a reload or another page of the app loses nothing.
  useEffect(() => {
    if (restored.current) savePendingCards(pendingStorage, hex, { adds: pendingAdds, removes: pendingRemoves });
  }, [hex, pendingAdds, pendingRemoves]);

  // Closing the tab drops what is waiting: the browser asks first.
  useEffect(() => {
    if (!anyPending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyPending]);

  const clearPending = () => {
    setPendingAdds([]);
    setPendingRemoves([]);
    savePendingCards(pendingStorage, hex, { adds: [], removes: [] });
  };

  const status: CardStatusCall = (cardHex, profile) => withSession(({ token }) => client.cards.status(token, cardHex, profile));

  /** The checks that need no server, then BEF's word on the card. */
  const considerCard = async (card: CardCandidate) => {
    setChecking(true);
    setRetryCard(null);
    setMessage(null);
    try {
      const verdict = await checkCard(card, { self: hex, published, pendingAdds, pendingRemoves, allowance }, status);
      setMessage(verdict.message);
      switch (verdict.kind) {
        case "add": {
          const { name } = verdict;
          setPendingAdds((adds) => (adds.includes(verdict.hex) ? adds : [...adds, verdict.hex]));
          if (name) setPendingNames((names) => ({ ...names, [verdict.hex]: name }));
          break;
        }
        case "yours":
          // Published from another window meanwhile.
          void loadMine(true);
          break;
        case "retry":
          setRetryCard(card);
          break;
      }
    } finally {
      setChecking(false);
    }
  };

  /**
   * A card's key, typed or scanned, or its hex id typed. The field is already
   * empty; what was typed appears in no message, whatever happens.
   */
  const addCard = async (input: string) => {
    if (!ready || checking || publishing) return;
    setAddProblem(null);
    setMessage(null);
    setRetryCard(null);
    setChecking(true);
    let card: CardCandidate;
    try {
      card = await readCardInput(input, hex);
    } catch (err) {
      setAddProblem({ key: cardInputProblem(err), alert: true });
      setChecking(false);
      return;
    }
    await considerCard(card);
  };

  const send = async () => {
    setConfirmRemove(false);
    setPublishing(true);
    setMessage(null);
    try {
      const result = await publishCards(withSession, client, { list, adds: pendingAdds, removes: pendingRemoves });
      setList(result.list);
      clearPending();
      setMessage(publishedMessage(result));
      // What the new cards took of the allowance.
      void loadMine(true);
    } catch (err) {
      const answer = publishAnswer(err);
      if (answer.drop?.length) {
        const refused = new Set(answer.drop);
        setPendingAdds((adds) => adds.filter((card) => !refused.has(card)));
      }
      if (answer.reload === "first") {
        if (await loadMine()) setMessage(answer.message);
      } else {
        setMessage(answer.message);
        if (answer.reload === "quiet") void loadMine(true);
      }
    } finally {
      setPublishing(false);
    }
  };

  const publish = () => {
    if (!ready || publishing || checking || !anyPending) return;
    setMessage(null);
    if (allowance && pendingAdds.length > allowance.remaining) {
      setMessage(allowanceProblem(allowance));
      return;
    }
    // A removed card is free for anyone once the list without it is published: said before signing.
    if (pendingRemoves.length > 0) {
      setConfirmRemove(true);
      return;
    }
    void send();
  };

  const retryLoad = () => {
    setLoadState("loading");
    void loadMine();
  };

  const nameOf = (cardHex: string) => list?.cards.find((card) => card.hex === cardHex)?.name ?? pendingNames[cardHex] ?? null;
  /** New cards that can still be put on the waiting list. */
  const room = allowance ? Math.max(0, allowance.remaining - pendingAdds.length) : 0;

  let allowanceLine: CircleMessage | null = null;
  if (ready && allowance) {
    if (allowance.remaining === 0 && allowance.nextSlotAt) {
      allowanceLine = { key: "cards.allowance.none", vars: { max: allowance.max, date: fmtDateTime(allowance.nextSlotAt) }, alert: false };
    } else if (room === 0) {
      allowanceLine = { key: "cards.allowance.waiting", vars: { max: allowance.max }, alert: false };
    } else {
      allowanceLine = { key: "cards.allowance.left", vars: { max: allowance.max, remaining: room }, alert: false };
    }
  }

  const addBusy = !ready || checking || publishing;
  const addBusyLabel = checking ? t("cards.add.checking") : publishing ? t("cards.publishing") : t("interest.loading");

  return (
    <div className="space-y-4">
      {listedAsCard && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{t("circle.listedAsCard")}</AlertDescription>
        </Alert>
      )}

      {loadState === "loading" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>{t("interest.loading")}</span>
          </CardContent>
        </Card>
      )}
      {loadState === "failed" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p>{t("cards.list.loadFailed")}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={retryLoad}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t("interest.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />
            {t("cards.add.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("cards.add.lead")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {allowanceLine && <p className="text-sm">{t(allowanceLine.key, allowanceLine.vars)}</p>}
          {/* No room for another card: no field to type a card's key into for nothing. */}
          {(!ready || room > 0) && (
            <>
              <CardAddBox
                busy={addBusy}
                busyLabel={addBusyLabel}
                problem={addProblem ? t(addProblem.key, addProblem.vars) : null}
                onSubmit={(input) => void addCard(input)}
              />
              <p className="text-xs text-muted-foreground leading-relaxed">{t("circle.add.keyNote")}</p>
            </>
          )}
          {retryCard && (
            <Button type="button" variant="outline" size="sm" onClick={() => void considerCard(retryCard)} disabled={addBusy}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t("cards.add.checkAgain", { id: shortCardId(retryCard.hex) })}
            </Button>
          )}
        </CardContent>
      </Card>

      {message && <CircleMessageLine message={message} />}

      {anyPending && (
        <PendingCardsView
          adds={pendingAdds}
          removes={pendingRemoves}
          nameOf={nameOf}
          publishing={publishing}
          canPublish={ready && !checking}
          onUndoAdd={(card) => setPendingAdds((adds) => adds.filter((c) => c !== card))}
          onUndoRemove={(card) => setPendingRemoves((removes) => removes.filter((c) => c !== card))}
          onPublish={publish}
        />
      )}

      {ready && (
        <CardListView
          list={list}
          removing={pendingRemoves}
          locked={publishing}
          onRemove={(card) => setPendingRemoves((removes) => (removes.includes(card) ? removes : [...removes, card]))}
        />
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("circle.remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cards.pending.removeConfirm", { count: pendingRemoves.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("interest.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("cards.publish", { count: pendingCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A refusal (role="alert") or news (role="status"), with the short ids it is about. */
function CircleMessageLine({ message }: { message: CircleMessage }) {
  const { t } = useTranslation(befCircleText);
  return (
    <Alert variant={message.alert ? "destructive" : "default"} role={message.alert ? "alert" : "status"}>
      {message.alert ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
      <AlertDescription>
        <p>{t(message.key, message.vars)}</p>
        {message.ids && message.ids.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span>{t("circle.refusedIds")}</span>
            {message.ids.map((id) => (
              <code key={id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {id}
              </code>
            ))}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
