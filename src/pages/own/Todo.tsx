import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, ListChecks, MessageSquare, HeartHandshake, Sparkles, Bot, Telescope } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/i18n/I18nContext";
import { useNostrOpenProcesses } from "@/hooks/useNostrOpenProcesses";
import { useOwnGrievances } from "@/hooks/useOwnGrievances";
import { mergeTodo, STEP_ORDER, type StepKey } from "@/lib/ownTodo";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";

// ─────────────────────────────────────────────────────────────────
//  TO-DO — what THIS person still has to do about the grievances.
//
//  The Matrica shows the whole picture; this page answers one question only:
//  "what is waiting for ME right now?" Four kinds of step, in the order the
//  process itself walks them:
//    1. respond to a grievance addressed to you (any honest reaction counts)
//    2. accept it unconditionally
//    3. apologize where you can
//    4. own a grievance YOU gave as your own delusion
//
//  Beings keep independent ledgers, so the same grievance can sit at different
//  steps for different beings. We merge by (from → to → summary) and keep the
//  LEAST advanced step — the work is only truly done when no being still sees
//  it pending — and say how many beings still wait for it.
// ─────────────────────────────────────────────────────────────────

const TXT = {
  sl: {
    title: "Kaj moram narediti",
    lead: "Zbrani koraki, ki čakajo nate pri očitkih — po procesih. Ko korak narediš v pogovoru, bitja to zaznajo sama in vrstica izgine.",
    back: "Nazaj na OWN",
    loading: "Nalagam …",
    noProcesses: "Trenutno nisi v nobenem odprtem procesu.",
    allDone: "Nič ne čaka nate. Vse, kar je bilo na tebi, je narejeno.",
    caseDone: "V tem procesu nič ne čaka nate.",
    openChat: "Odpri pogovor",
    openSelf: "Podrobno o sebi — mnenja · očitki · čustva",
    steps: {
      respond: "Odgovori",
      accept: "Sprejmi",
      apologize: "Opraviči se",
      own: "Sprejmi kot svojo zablodo",
    },
    how: {
      respond: "Odzovi se nanj — iskren odziv šteje, tudi če se z njim ne strinjaš.",
      accept: "Sprejmi ga brezpogojno: brez »ampak«, brez pojasnjevanja.",
      apologize: "Opraviči se tam, kjer prepoznaš svoj del.",
      own: "Poglej ga kot svojo projekcijo in to izreci — to je zabloda, ki je tvoja.",
    },
    from: "od",
    to: "za",
    byBeing: "Zaznalo bitje",
    stillWaiting: "Še čaka pri",
    alreadyDone: "Že opravljeno pri",
    waiting: "čaka nate",
  },
  en: {
    title: "What I need to do",
    lead: "The steps still waiting for you across your grievances, per process. Do the step in the conversation — the beings notice it themselves and the row disappears.",
    back: "Back to OWN",
    loading: "Loading …",
    noProcesses: "You are not in any open process right now.",
    allDone: "Nothing is waiting for you. Everything that was yours is done.",
    caseDone: "Nothing waits for you in this process.",
    openChat: "Open the conversation",
    openSelf: "My detail — opinions · grievances · emotions",
    steps: {
      respond: "Respond",
      accept: "Accept",
      apologize: "Apologize",
      own: "Own it as your delusion",
    },
    how: {
      respond: "React to it — an honest reaction counts, even if you disagree.",
      accept: "Accept it unconditionally: no 'but', no explaining.",
      apologize: "Apologize where you recognize your part.",
      own: "See it as your own projection and say so — this delusion is yours.",
    },
    from: "from",
    to: "to",
    byBeing: "Recorded by",
    stillWaiting: "Still waiting at",
    alreadyDone: "Already done at",
    waiting: "waits for you",
  },
};

const STEP_ICON: Record<StepKey, typeof MessageSquare> = {
  respond: MessageSquare,
  accept: HeartHandshake,
  apologize: Sparkles,
  own: CheckCircle2,
};

function CaseTodo({ caseRoot, title, me, onOpen, onOpenSelf, L }: {
  caseRoot: string; title: string; me: string; onOpen: () => void; onOpenSelf: () => void; L: typeof TXT.sl;
}) {
  const { ledgers, isLoading } = useOwnGrievances(caseRoot);
  const items = useMemo(() => mergeTodo(ledgers, me), [ledgers, me]);
  const pubkeys = useMemo(() => {
    const set = new Set<string>([me]);
    items.forEach(({ g, pending, done }) => {
      set.add(g.fromPubkey); set.add(g.toPubkey);
      pending.forEach((x) => set.add(x.beingPubkey));   // the beings, or their names render as hashes
      done.forEach((b) => set.add(b));
    });
    return Array.from(set);
  }, [items, me]);
  const { profiles } = useNostrProfilesCacheBulk(pubkeys);
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.full_name || p?.display_name || `${pk.slice(0, 8)}…`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="leading-snug">{title}</span>
          {items.length > 0 && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40">
              {items.length} · {L.waiting}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {isLoading && ledgers.length === 0 ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : items.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{L.caseDone}</p>
            <Button variant="ghost" size="sm" onClick={onOpenSelf} className="text-orange-700 dark:text-orange-300 hover:text-orange-800 -ml-2">
              <Telescope className="h-4 w-4 mr-2" />{L.openSelf}
            </Button>
          </div>
        ) : (
          <>
            {items.map(({ key, g, step, pending, done, totalBeings }) => {
              const Icon = STEP_ICON[step];
              const mine = String(g.toPubkey).toLowerCase() === me;
              // Which being asks for what — beings judge independently, so the
              // same grievance can sit at different steps for each of them.
              const sameStep = pending.every((x) => x.step === step);
              return (
                <div key={key} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/15">
                      <Icon className="h-3.5 w-3.5 mr-1" />{L.steps[step]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {mine ? `${L.from} ${nameOf(g.fromPubkey)}` : `${L.to} ${nameOf(g.toPubkey)}`}
                    </span>
                  </div>
                  {g.summary && <p className="text-sm leading-snug">{g.summary}</p>}
                  <p className="text-xs text-muted-foreground">→ {L.how[step]}</p>
                  <div className="space-y-0.5 pt-0.5">
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1 flex-wrap">
                      <Bot className="h-3 w-3 text-orange-500 mt-[3px] shrink-0" />
                      <span>
                        <span className="font-medium">{totalBeings > 1 ? L.stillWaiting : L.byBeing}:</span>{" "}
                        {pending.map((x, i) => (
                          <span key={x.beingPubkey}>
                            {i > 0 && ", "}
                            {nameOf(x.beingPubkey)}
                            {!sameStep && <span className="opacity-70"> ({L.steps[x.step]})</span>}
                          </span>
                        ))}
                      </span>
                    </p>
                    {done.length > 0 && (
                      <p className="text-[11px] text-muted-foreground/80 flex items-start gap-1 flex-wrap">
                        <CheckCircle2 className="h-3 w-3 text-green-600 mt-[3px] shrink-0" />
                        <span><span className="font-medium">{L.alreadyDone}:</span> {done.map((b) => nameOf(b)).join(", ")}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-col sm:flex-row gap-2 pt-0.5">
              <Button variant="outline" size="sm" onClick={onOpen} className="w-full sm:w-auto">
                <MessageSquare className="h-4 w-4 mr-2" />{L.openChat}
              </Button>
              <Button variant="ghost" size="sm" onClick={onOpenSelf} className="w-full sm:w-auto text-orange-700 dark:text-orange-300 hover:text-orange-800">
                <Telescope className="h-4 w-4 mr-2" />{L.openSelf}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function OwnTodo() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const me = (session?.nostrHexId || "").toLowerCase();
  const { processes, isLoading } = useNostrOpenProcesses(session?.nostrHexId || null);

  // Only processes this person actually walks (a guest has nothing to do here).
  const mine = useMemo(
    () => processes.filter((p) => [p.initiator, ...p.participants].some((pk) => String(pk).toLowerCase() === me)),
    [processes, me],
  );

  return (
    <div className="space-y-4 md:space-y-6 px-4 md:px-0">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/own")} className="mb-2 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" />{L.back}
        </Button>
        <h2 className="text-base md:text-lg font-semibold flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-orange-600 dark:text-orange-400" /> {L.title}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{L.lead}</p>
      </div>

      {isLoading && processes.length === 0 ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}</div>
      ) : mine.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{L.noProcesses}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {mine.map((p) => (
            <CaseTodo
              key={p.processEventId}
              caseRoot={p.processEventId}
              title={p.title || p.processEventId.slice(0, 12)}
              me={me}
              onOpen={() => navigate(`/own?process=${encodeURIComponent(p.processEventId)}`)}
              onOpenSelf={() => navigate(`/own?process=${encodeURIComponent(p.processEventId)}&self=1`)}
              L={L}
            />
          ))}
        </div>
      )}
    </div>
  );
}
