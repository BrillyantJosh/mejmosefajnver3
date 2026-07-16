import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, CheckCircle2, CircleDot, Circle, Grid3x3, ChevronRight } from "lucide-react";
import { useOwnAssessments, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    title: "Matrika udeležencev",
    intro: "Za vsakega udeleženca zadnja ocena vsakega bitja. »Več« odpre njegovo časovnico in zadnja mnenja.",
    none: "Nobeno bitje še ni objavilo ocene za ta proces.",
    more: "Več",
    noAssessment: "Še ni ocene.",
    r: "R", a: "U", c: "S", // Refleksija / Uskladitev / Sprememba
    grievLabel: "Očitki", grievAcceptedWord: "sprejeti", grievResp: "odg", grievOwned: "zab",
  },
  en: {
    title: "Participant matrix",
    intro: "Each being's latest verdict on every participant. “More” opens their timeline and latest opinions.",
    none: "No being has published an assessment for this process yet.",
    more: "More",
    noAssessment: "No assessment yet.",
    r: "R", a: "A", c: "C", // Reflection / Alignment / Change
    grievLabel: "Grievances", grievAcceptedWord: "accepted", grievResp: "resp", grievOwned: "own",
  },
};

const Dot = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => (
  <span className="inline-flex items-center gap-0.5" title={label}>
    {status === "done" ? <CheckCircle2 className="h-3 w-3 text-green-500" />
      : status === "current" ? <CircleDot className="h-3 w-3 text-amber-500" />
      : <Circle className="h-3 w-3 text-muted-foreground/30" />}
    <span className="text-[10px] text-muted-foreground">{label}</span>
  </span>
);

interface Props {
  caseRoot: string | null;
  participants: string[];
  phase?: string;
  selectedParticipant?: string | null;
  onSelect: (pk: string) => void;
}

// The overseer (facilitator / guest) view: the whole participant×being matrix,
// compact for a sidebar, with a "More" link opening a participant's timeline.
export default function OwnFullMatrix({ caseRoot, participants, phase, selectedParticipant, onSelect }: Props) {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { states, entries, isLoading } = useOwnAssessments(caseRoot);

  // Union of 37045 AND 87047 authors (same as the Matrix page) — a being
  // whose entries arrived but whose phase-state didn't must still be listed.
  const beings = useMemo(() => {
    const set = new Set<string>();
    states.forEach((s) => set.add(s.beingPubkey));
    entries.forEach((e) => set.add(e.beingPubkey));
    return Array.from(set).sort();
  }, [states, entries]);

  const { profiles } = useNostrProfilesCacheBulk(useMemo(() => Array.from(new Set([...participants, ...beings])), [participants, beings]));
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || short(pk);
  };

  const stateFor = (being: string, participant: string): PhaseState | null =>
    states.find((s) => s.beingPubkey === being && s.participantPubkey === participant) || null;
  const reqStatus = (st: PhaseState, ph: "reflection" | "alignment" | "change"): "done" | "current" | "todo" => {
    const met = ph === "reflection" ? st.reflectionComplete : ph === "alignment" ? st.alignmentComplete : st.changeComplete;
    if (met) return "done";
    if ((st.currentPhaseEstimate || "").toLowerCase() === ph) return "current";
    return "todo";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Grid3x3 className="h-4 w-4 text-orange-600 dark:text-orange-400" /> {L.title}
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase, lang)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{L.intro}</p>

      {isLoading && beings.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : beings.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.none}</CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {participants.map((p) => {
            const beingStates = beings.map((b) => ({ b, st: stateFor(b, p) })).filter((x) => x.st);
            return (
              <Card key={p} className={selectedParticipant === p ? "border-orange-500/60 ring-1 ring-orange-500/30" : ""}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{nameOf(p)}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-orange-600 dark:text-orange-400 hover:text-orange-700 shrink-0" onClick={() => onSelect(p)}>
                      {L.more} <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                  {beingStates.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70">{L.noAssessment}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {beingStates.map(({ b, st }) => (
                        <div key={b}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs inline-flex items-center gap-1 min-w-0">
                              <Bot className="h-3.5 w-3.5 text-orange-500 shrink-0" /><span className="truncate">{nameOf(b)}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className={`${getPhaseColor(st!.currentPhaseEstimate)} text-[10px] py-0`}>{getPhaseLabel(st!.currentPhaseEstimate, lang)}</Badge>
                              <Dot status={reqStatus(st!, "reflection")} label={L.r} />
                              <Dot status={reqStatus(st!, "alignment")} label={L.a} />
                              <Dot status={reqStatus(st!, "change")} label={L.c} />
                            </span>
                          </div>
                          {st!.grievanceSummary && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 pl-5">{L.grievLabel}: {L.grievResp} {st!.grievanceSummary.received_responded ?? st!.grievanceSummary.received_accepted}/{st!.grievanceSummary.received} · {st!.grievanceSummary.received_accepted}/{st!.grievanceSummary.received} {L.grievAcceptedWord} · {L.grievOwned} {st!.grievanceSummary.given_accepted_by_me ?? 0}/{st!.grievanceSummary.given}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
