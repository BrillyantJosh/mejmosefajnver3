import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, CheckCircle2, CircleDot, Circle, Telescope, Grid3x3, ChevronRight } from "lucide-react";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const Req = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => {
  if (status === "done") return (
    <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /><span className="text-xs">{label} <span className="text-green-600">· opravljeno</span></span></div>
  );
  if (status === "current") return (
    <div className="flex items-center gap-1.5"><CircleDot className="h-3.5 w-3.5 text-amber-500 shrink-0" /><span className="text-xs">{label} <span className="text-amber-600">· v teku</span></span></div>
  );
  return (
    <div className="flex items-center gap-1.5"><Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" /><span className="text-xs text-muted-foreground/60">{label} · še ne</span></div>
  );
};

interface Props {
  /** The OWN case root (matches the beings' 87047/37045 #e reference). */
  caseRoot: string | null;
  /** The viewing participant — we show only THEIR row. */
  participantPubkey: string;
  /** Official process phase (facilitator-set), for header context. */
  phase?: string;
  /** If set, renders an "analyze the other participants" card (→ full matrix). */
  onAnalyzeOthers?: () => void;
}

// A single participant's slice of the being-assessment matrix: where THEY are,
// and only the LATEST opinion from each being about them. Shown to the
// participant inside their own process chat.
export default function OwnSelfMatrix({ caseRoot, participantPubkey, phase, onAnalyzeOthers }: Props) {
  const { entries, states, isLoading } = useOwnAssessments(caseRoot);
  const me = (participantPubkey || "").toLowerCase();

  const myStates = useMemo(() => states.filter((s) => s.participantPubkey === me), [states, me]);

  // Latest 87047 opinion per being for this participant (summary + rationale).
  const latestEntryByBeing = useMemo(() => {
    const m = new Map<string, AssessmentEntry>();
    for (const e of entries) {
      if (e.participantPubkey !== me) continue;
      const cur = m.get(e.beingPubkey);
      if (!cur || e.created_at > cur.created_at) m.set(e.beingPubkey, e);
    }
    return m;
  }, [entries, me]);

  const beings = useMemo(() => {
    const set = new Set<string>();
    myStates.forEach((s) => set.add(s.beingPubkey));
    latestEntryByBeing.forEach((_v, b) => set.add(b));
    return Array.from(set).sort();
  }, [myStates, latestEntryByBeing]);

  const { profiles } = useNostrProfilesCacheBulk(beings);
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || short(pk);
  };

  const stateOf = (b: string): PhaseState | null => myStates.find((s) => s.beingPubkey === b) || null;
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
          <Telescope className="h-4 w-4 text-orange-600 dark:text-orange-400" /> Kje si v procesu
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Zadnje mnenje vsakega bitja zate — kje te vidi in katere zahteve (Refleksija → Uskladitev → Sprememba) po njegovi oceni izpolnjuješ.
      </p>

      {isLoading && beings.length === 0 ? (
        <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : beings.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">Nobeno bitje te še ni ocenilo v tem procesu.</CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {beings.map((b) => {
            const st = stateOf(b);
            const entry = latestEntryByBeing.get(b);
            return (
              <Card key={b} className="border-orange-500/25 bg-orange-500/[0.04]">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium inline-flex items-center gap-1.5">
                      <Bot className="h-4 w-4 text-orange-500" />{nameOf(b)}
                    </span>
                    {st?.currentPhaseEstimate && (
                      <Badge variant="outline" className={getPhaseColor(st.currentPhaseEstimate)}>{getPhaseLabel(st.currentPhaseEstimate)}</Badge>
                    )}
                  </div>
                  {st && (
                    <div className="space-y-1">
                      <Req status={reqStatus(st, "reflection")} label="Refleksija" />
                      <Req status={reqStatus(st, "alignment")} label="Uskladitev" />
                      <Req status={reqStatus(st, "change")} label="Sprememba" />
                    </div>
                  )}
                  {entry?.summary && <p className="text-xs italic text-muted-foreground leading-snug">“{entry.summary}”</p>}
                  {entry && (
                    <div className="text-[10px] text-muted-foreground/70">
                      {new Date(entry.created_at * 1000).toLocaleString()}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {onAnalyzeOthers && (
        <button
          onClick={onAnalyzeOthers}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-orange-500/40 bg-orange-500/[0.06] hover:bg-orange-500/10 hover:border-orange-500/60 transition-colors p-3 text-left"
        >
          <span className="text-sm font-medium inline-flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
            Analiziraj druge udeležence
          </span>
          <ChevronRight className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
        </button>
      )}
    </div>
  );
}
