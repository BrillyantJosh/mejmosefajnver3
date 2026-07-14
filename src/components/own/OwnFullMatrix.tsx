import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, CheckCircle2, CircleDot, Circle, Grid3x3, ChevronRight } from "lucide-react";
import { useOwnAssessments, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const Dot = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => (
  <span className="inline-flex items-center gap-0.5" title={label}>
    {status === "done" ? <CheckCircle2 className="h-3 w-3 text-green-500" />
      : status === "current" ? <CircleDot className="h-3 w-3 text-amber-500" />
      : <Circle className="h-3 w-3 text-muted-foreground/30" />}
    <span className="text-[10px] text-muted-foreground">{label}</span>
  </span>
);

interface Props {
  /** OWN case root (matches the beings' 87047/37045 #e reference). */
  caseRoot: string | null;
  /** Assessed subjects to show (participants + the initiator). */
  participants: string[];
  phase?: string;
  selectedParticipant?: string | null;
  onSelect: (pk: string) => void;
}

// The overseer (facilitator / guest) view: the whole participant×being matrix,
// compact for a sidebar — every participant with every being's current verdict,
// and a "Več" link opening that participant's timeline on the right.
export default function OwnFullMatrix({ caseRoot, participants, phase, selectedParticipant, onSelect }: Props) {
  const { states, isLoading } = useOwnAssessments(caseRoot);

  const beings = useMemo(() => {
    const set = new Set<string>();
    states.forEach((s) => set.add(s.beingPubkey));
    return Array.from(set).sort();
  }, [states]);

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
          <Grid3x3 className="h-4 w-4 text-orange-600 dark:text-orange-400" /> Matrika udeležencev
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Za vsakega udeleženca zadnja ocena vsakega bitja. »Več« odpre njegovo časovnico in zadnja mnenja.
      </p>

      {isLoading && beings.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : beings.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">Nobeno bitje še ni objavilo ocene za ta proces.</CardContent></Card>
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
                      Več <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                  {beingStates.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70">Še ni ocene.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {beingStates.map(({ b, st }) => (
                        <div key={b} className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs inline-flex items-center gap-1 min-w-0">
                            <Bot className="h-3.5 w-3.5 text-orange-500 shrink-0" /><span className="truncate">{nameOf(b)}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className={`${getPhaseColor(st!.currentPhaseEstimate)} text-[10px] py-0`}>{getPhaseLabel(st!.currentPhaseEstimate)}</Badge>
                            <Dot status={reqStatus(st!, "reflection")} label="R" />
                            <Dot status={reqStatus(st!, "alignment")} label="U" />
                            <Dot status={reqStatus(st!, "change")} label="S" />
                          </span>
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
