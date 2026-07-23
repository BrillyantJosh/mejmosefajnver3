import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, ListChecks, MessageSquare, HeartHandshake, Sparkles, Bot, Telescope, Languages, PenLine } from "lucide-react";
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
    caseDone: "Trenutno te ne čaka nič.",
    openChat: "Odpri pogovor",
    openSelf: "Podrobno o sebi — mnenja · očitki · čustva",
    translate: "Prevedi v slovenščino",
    original: "Pokaži izvirnik",
    translating: "prevajam …",
    translateNote: "Bitja povzetke zapišejo v jeziku, v katerem je tekel pogovor — prevod je pomoč pri branju, izvirnik ostane zapis na relayih.",
    steps: {
      respond: "Odgovori",
      accept: "Sprejmi",
      apologize: "Opraviči se",
      own: "Sprejmi kot svojo zablodo",
    },
    // Značka sama ljudem ne pove, KAJ naj naredijo — najmanj pri zablodi.
    // Zato vsak korak pove bistvo in kaj NE šteje, nikoli pa ne ponudi
    // stavka, ki bi ga bilo mogoče prepisati. {ime} je druga oseba v očitku.
    guide: {
      respond: {
        lead: "Nekdo je to naslovil nate in proces čaka tvoj odziv.",
        points: [
          "Strinjanje ni pogoj — če se z očitkom ne strinjaš, povej prav to.",
          "Ta korak ustavi samo molk.",
        ],
      },
      accept: {
        lead: "Sprejmi ta očitek brezpogojno.",
        points: [
          "Brezpogojno pomeni: brez »ampak«, brez pojasnjevanja, brez protiočitka.",
          "Sprejem pod pogojem (»sprejmem, če pa on …«) ni sprejem.",
          "Bitja presojajo celotno držo v pogovoru, ne enega samega stavka.",
        ],
      },
      // Ime vedno stoji v IMENOVALNIKU (za pomišljajem ali dvopičjem) — koda ga
      // le vstavi in ga ne zna sklanjati, »kot o Rok« pa bi bilo narobe.
      apologize: {
        lead: "Opraviči se za svoj del — osebno, ne na splošno.",
        points: [
          "Opravičilo naj gre do osebe, ki je očitek izrekla — {ime}.",
          "Povej, za KAJ se opravičuješ. Splošno »oprosti, če je koga prizadelo« ne zadene ničesar.",
          "Če se opravičilo sredi stavka prevesi v razlago, zakaj je bilo tvoje ravnanje upravičeno, ni več opravičilo.",
        ],
      },
      own: {
        lead: "Ta očitek je tvoj — in pokazalo se je, da pove več o tebi kot o drugem.",
        points: [
          "Priznaj svojo zablodo neposredno osebi, ki ji je očitek letel — {ime}. Priznanje mora priti do nje, ne ostati v tvojem razmisleku.",
          "Bistvo ni opravičilo za dejanje, ampak priznanje, da je očitek govoril o tebi.",
          "Razlaga, zakaj se ti je takrat tako kazalo, zablodo spet spremeni v obrambo.",
        ],
      },
    },
    ownWords: "Napiši s svojimi besedami, v pogovoru procesa. Bitja presojajo tvojo držo, ne obrazca — prepisan stavek ne pomeni ničesar.",
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
    caseDone: "Nothing is waiting for you right now.",
    openChat: "Open the conversation",
    openSelf: "My detail — opinions · grievances · emotions",
    translate: "Translate to English",
    original: "Show the original",
    translating: "translating …",
    translateNote: "Beings write the summaries in the language the conversation ran in — the translation is a reading aid; the original stays the record on the relays.",
    steps: {
      respond: "Respond",
      accept: "Accept",
      apologize: "Apologize",
      own: "Own it as your delusion",
    },
    guide: {
      respond: {
        lead: "Someone addressed this to you, and the process is waiting for your reaction.",
        points: [
          "Agreeing is not required — if you disagree with the grievance, say exactly that.",
          "The only thing that stalls this step is silence.",
        ],
      },
      accept: {
        lead: "Accept this grievance unconditionally.",
        points: [
          "Unconditionally means: no 'but', no explaining, no counter-grievance.",
          "Acceptance with a condition ('I accept, if he first …') is not acceptance.",
          "The beings weigh your whole stance in the conversation, not one sentence.",
        ],
      },
      apologize: {
        lead: "Apologize for your part — to {ime}, not in general.",
        points: [
          "Say WHAT you are apologizing for. A general 'sorry if anyone was hurt' lands nowhere.",
          "If the apology turns mid-sentence into why your behaviour was justified, it is no longer an apology.",
        ],
      },
      own: {
        lead: "This grievance is yours — and it turned out to say more about you than about {ime}.",
        points: [
          "Admit the delusion directly to {ime}. The grievance flew at that person, so the admission has to reach them — not just your own reflection.",
          "The point is not to apologize for an act, but to admit that the grievance was speaking about you.",
          "Explaining why it looked that way to you at the time turns the delusion back into a defence.",
        ],
      },
    },
    ownWords: "Write it in your own words, in the process conversation. The beings weigh your stance, not a formula — a copied sentence means nothing.",
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

function CaseTodo({ caseRoot, title, me, onOpen, onOpenSelf, L, lang, translateOn, myPubkey }: {
  caseRoot: string; title: string; me: string; onOpen: () => void; onOpenSelf: () => void;
  L: typeof TXT.sl; lang: "sl" | "en"; translateOn: boolean; myPubkey?: string;
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

  // Translation of the grievance texts themselves (the beings write them in the
  // language the conversation ran in). Cached per row+language, so toggling
  // back and forth never pays twice; the original is never overwritten.
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  useEffect(() => {
    if (!translateOn) return;
    const missing = items.filter((it) => it.g.summary && !translations[`${it.key}:${lang}`]);
    if (missing.length === 0) return;
    let cancelled = false;
    setTranslating(true);
    Promise.allSettled(missing.map((it) =>
      fetch("/api/functions/translate-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: it.g.summary, targetLanguage: lang, format: "plain", nostrHexId: myPubkey }),
      })
        .then((r) => r.json())
        .then((d) => ({ key: `${it.key}:${lang}`, text: d?.translatedText as string | undefined })),
    )).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value?.text) next[r.value.key] = r.value.text;
      }
      if (Object.keys(next).length) setTranslations((prev) => ({ ...prev, ...next }));
      setTranslating(false);
    });
    return () => { cancelled = true; };
  }, [translateOn, lang, items, translations, myPubkey]);
  const summaryOf = (key: string, original: string) =>
    (translateOn && translations[`${key}:${lang}`]) || original;
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.full_name || p?.display_name || `${pk.slice(0, 8)}…`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="leading-snug">{title}</span>
          <span className="inline-flex items-center gap-2">
            {translating && <span className="text-[11px] font-normal text-muted-foreground">{L.translating}</span>}
            {items.length > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40">
                {items.length} · {L.waiting}
              </Badge>
            )}
          </span>
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
                  {g.summary && <p className="text-sm leading-snug">{summaryOf(key, g.summary)}</p>}
                  {(() => {
                    // Druga oseba v očitku: pri prejetih je to tisti, ki ga je dal;
                    // pri zablodi pa tisti, ki mu je bil namenjen — in prav do njega
                    // mora priznanje priti, sicer ostane pri samem sebi.
                    const other = nameOf(mine ? g.fromPubkey : g.toPubkey);
                    const gd = L.guide[step];
                    const fill = (s: string) => s.split("{ime}").join(other);
                    return (
                      <div className="rounded-md border border-border/60 bg-muted/40 p-2.5 space-y-1.5">
                        <p className="text-xs font-medium leading-snug">→ {fill(gd.lead)}</p>
                        <ul className="space-y-1">
                          {gd.points.map((pt, i) => (
                            <li key={i} className="text-[11px] leading-snug text-muted-foreground flex gap-1.5">
                              <span className="text-muted-foreground/50 shrink-0">·</span>
                              <span>{fill(pt)}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-[11px] leading-snug text-orange-700 dark:text-orange-300 flex gap-1.5 pt-0.5">
                          <PenLine className="h-3 w-3 mt-[2px] shrink-0" />
                          <span>{L.ownWords}</span>
                        </p>
                      </div>
                    );
                  })()}
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
  const [translateOn, setTranslateOn] = useState(false);

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
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button
            variant={translateOn ? "default" : "outline"}
            size="sm"
            onClick={() => setTranslateOn((v) => !v)}
          >
            <Languages className="h-4 w-4 mr-2" />
            {translateOn ? L.original : L.translate}
          </Button>
          {translateOn && <span className="text-[11px] text-muted-foreground">{L.translateNote}</span>}
        </div>
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
              lang={en ? "en" : "sl"}
              translateOn={translateOn}
              myPubkey={session?.nostrHexId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
