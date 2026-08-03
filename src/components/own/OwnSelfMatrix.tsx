import { useMemo } from "react";
import { FreezeNotice } from "@/components/own/FreezeBadge";
import type { PersonFreezeState } from "@/lib/ownFreeze";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Telescope, Grid3x3, ChevronRight, Bot, ListChecks } from "lucide-react";
import { useOwnAssessments, silenceRollup, formatResumeDate, type AssessmentEntry } from "@/hooks/useOwnAssessments";
import OwnPillarSummary from "@/components/own/OwnPillarSummary";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const TXT = {
  sl: {
    title: "Moj presek",
    intro: "Zbran pogled treh stebrov zate — faze (koliko bitij jih vidi izpolnjene), očitki (kaj še čaka nate) in čustva (globina vstopa). Podrobnosti odpre »Podrobni pogled«.",
    none: "Nobeno bitje te še ni ocenilo v tem procesu.",
    detail: "Podrobni pogled — vse skupaj",
    analyze: "Analiziraj druge udeležence",
    todo: "Kaj moram narediti",
    latestVoice: "Zadnje mnenje",
    silTitle: "Bitja čakajo v tišini",
    silBody: "Bitja zaznavajo premalo introspekcije in preveč ukvarjanja z drugimi ter nedopuščanje oz. nepriznavanje možnosti lastne zmote oz. zablode naših prepričanj. Naredi korak v smeri ponižnosti in lastne zmotljivosti. V tišini čakajo do {when}, preden nadaljujejo s procesom.",
    silBodyOpen: "Bitja zaznavajo premalo introspekcije in preveč ukvarjanja z drugimi ter nedopuščanje oz. nepriznavanje možnosti lastne zmote oz. zablode naših prepričanj. Naredi korak v smeri ponižnosti in lastne zmotljivosti. V tišini čakajo, preden nadaljujejo s procesom.",
    silStale: "Spodnja ocena je izpred tišine in se med njo ne posodablja.",
    silOfBeings: "V tišini: {n} od {total} bitij.",
  },
  en: {
    title: "My cross-section",
    intro: "The condensed three-pillar view of you — phases (how many beings see them met), grievances (what still awaits you) and emotions (depth of entry). “Detailed view” opens everything.",
    none: "No being has assessed you in this process yet.",
    detail: "Detailed view — everything together",
    analyze: "Analyze the other participants",
    todo: "What I need to do",
    latestVoice: "Latest opinion",
    silTitle: "The beings are waiting in silence",
    silBody: "The beings see too little looking inward and too much attention on others, and no room for the possibility that one’s own beliefs may be mistaken. Take a step toward humility and your own fallibility. They are waiting in silence until {when} before the process continues.",
    silBodyOpen: "The beings see too little looking inward and too much attention on others, and no room for the possibility that one’s own beliefs may be mistaken. Take a step toward humility and your own fallibility. They are waiting in silence before the process continues.",
    silStale: "The verdict below predates the silence and is not updated while it holds.",
    silOfBeings: "In silence: {n} of {total} beings.",
  },
};

interface Props {
  caseRoot: string | null;
  participantPubkey: string;
  phase?: string;
  onAnalyzeOthers?: () => void;
  onOpenTodo?: () => void;
  onOpenDetail?: () => void;
  /** KIND 87057 freeze state per person, handed down so every surface on
   *  /own reads ONE fetch and they can never disagree about who is frozen. */
  freezes?: Map<string, PersonFreezeState>;
}

// The participant's own condensed cross-section (presek): the three pillars
// AGGREGATED across all beings — not one card per being. The detail button
// opens the full per-being breakdown (verdicts, grievances, emotions, smer).
export default function OwnSelfMatrix({ caseRoot, participantPubkey, phase, onAnalyzeOthers, onOpenDetail, onOpenTodo, freezes }: Props) {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { entries, states, isLoading } = useOwnAssessments(caseRoot);
  const me = (participantPubkey || "").toLowerCase();

  const myStates = useMemo(() => states.filter((s) => s.participantPubkey === me), [states, me]);
  // Beings diverge: one may be waiting while another is not, so this states HOW
  // MANY are waiting rather than collapsing it to a single yes/no.
  const silence = useMemo(() => silenceRollup(myStates), [myStates]);
  // Open-ended for ANY waiting being ⇒ no single end date is true for all.
  const silenceWhen = silence.openEnded ? null : formatResumeDate(silence.resumeAt, lang);
  // One recent voice keeps the summary human — the newest abstract summary.
  const latestEntry = useMemo(() => {
    let best: AssessmentEntry | null = null;
    for (const e of entries) {
      if (e.participantPubkey !== me || !e.summary) continue;
      if (!best || e.created_at > best.created_at) best = e;
    }
    return best;
  }, [entries, me]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Telescope className="h-4 w-4 text-orange-600 dark:text-orange-400" /> {L.title}
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase, lang)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{L.intro}</p>

      {isLoading && myStates.length === 0 ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : myStates.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.none}</CardContent></Card>
      ) : (
        <Card className="border-orange-500/25 bg-orange-500/[0.04]">
          <CardContent className="p-3 space-y-2">
            <FreezeNotice state={freezes?.get((participantPubkey || '').toLowerCase())} en={en} />
            {silence.any && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2.5">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">🤲 {L.silTitle}</div>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {silenceWhen ? L.silBody.replace("{when}", silenceWhen) : L.silBodyOpen}
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                  {L.silOfBeings.replace("{n}", String(silence.waiting)).replace("{total}", String(silence.total))}
                </p>
                {/* Nad presekom, ker besedilo govori o »spodnji oceni«. */}
                <p className="text-[10px] text-muted-foreground/80 italic leading-snug mt-1">{L.silStale}</p>
              </div>
            )}
            {/* showSilence={false}: obvestilo je že zgoraj, v celoti — brez podvajanja. */}
            <div className={silence.any ? "opacity-60" : undefined}>
              <OwnPillarSummary states={myStates} lang={lang} showSilence={false} />
            </div>
            {latestEntry?.summary && (
              <p className="text-xs italic text-muted-foreground leading-snug border-t border-border/50 pt-2">
                <Bot className="h-3 w-3 text-orange-500 inline mr-1 align-[-2px]" />
                {L.latestVoice}: “{latestEntry.summary}”
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {onOpenTodo && (
        <button
          onClick={onOpenTodo}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-amber-500/50 bg-amber-500/[0.08] hover:bg-amber-500/15 hover:border-amber-500/70 transition-colors p-3 text-left"
        >
          <span className="text-sm font-medium inline-flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            {L.todo}
          </span>
          <ChevronRight className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        </button>
      )}

      {onOpenDetail && myStates.length > 0 && (
        <button
          onClick={onOpenDetail}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-orange-500/40 bg-orange-500/[0.06] hover:bg-orange-500/10 hover:border-orange-500/60 transition-colors p-3 text-left"
        >
          <span className="text-sm font-medium">{L.detail}</span>
          <ChevronRight className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
        </button>
      )}

      {onAnalyzeOthers && (
        <button
          onClick={onAnalyzeOthers}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-orange-500/40 bg-orange-500/[0.06] hover:bg-orange-500/10 hover:border-orange-500/60 transition-colors p-3 text-left"
        >
          <span className="text-sm font-medium inline-flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
            {L.analyze}
          </span>
          <ChevronRight className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
        </button>
      )}
    </div>
  );
}
