import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, CheckCircle2, CircleDot, Circle, Telescope, Grid3x3, ChevronRight } from "lucide-react";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    title: "Kje si v procesu",
    intro: "Zadnje mnenje vsakega bitja zate — kje te vidi in katere zahteve (Refleksija → Uskladitev → Sprememba) po njegovi oceni izpolnjuješ.",
    none: "Nobeno bitje te še ni ocenilo v tem procesu.",
    reflection: "Refleksija", alignment: "Uskladitev", change: "Sprememba",
    done: "opravljeno", inProgress: "v teku", notYet: "še ne",
    analyze: "Analiziraj druge udeležence",
    grievLabel: "Očitki", grievAcceptedWord: "sprejeti", grievResp: "odg", grievOwned: "zab",
  },
  en: {
    title: "Where you are in the process",
    intro: "Each being's latest read of you — the phase it places you in and which requirements (Reflection → Alignment → Change) it considers you have met.",
    none: "No being has assessed you in this process yet.",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    done: "done", inProgress: "in progress", notYet: "not yet",
    analyze: "Analyze the other participants",
    grievLabel: "Grievances", grievAcceptedWord: "accepted", grievResp: "resp", grievOwned: "own",
  },
};

interface Props {
  caseRoot: string | null;
  participantPubkey: string;
  phase?: string;
  onAnalyzeOthers?: () => void;
}

// A single participant's slice of the being-assessment matrix: where THEY are,
// and only the LATEST opinion from each being about them.
export default function OwnSelfMatrix({ caseRoot, participantPubkey, phase, onAnalyzeOthers }: Props) {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { entries, states, isLoading } = useOwnAssessments(caseRoot);
  const me = (participantPubkey || "").toLowerCase();

  const myStates = useMemo(() => states.filter((s) => s.participantPubkey === me), [states, me]);
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
  const Req = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => {
    if (status === "done") return (
      <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /><span className="text-xs">{label} <span className="text-green-600">· {L.done}</span></span></div>
    );
    if (status === "current") return (
      <div className="flex items-center gap-1.5"><CircleDot className="h-3.5 w-3.5 text-amber-500 shrink-0" /><span className="text-xs">{label} <span className="text-amber-600">· {L.inProgress}</span></span></div>
    );
    return (
      <div className="flex items-center gap-1.5"><Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" /><span className="text-xs text-muted-foreground/60">{label} · {L.notYet}</span></div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Telescope className="h-4 w-4 text-orange-600 dark:text-orange-400" /> {L.title}
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase, lang)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{L.intro}</p>

      {isLoading && beings.length === 0 ? (
        <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : beings.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.none}</CardContent></Card>
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
                      <Badge variant="outline" className={getPhaseColor(st.currentPhaseEstimate)}>{getPhaseLabel(st.currentPhaseEstimate, lang)}</Badge>
                    )}
                  </div>
                  {st && (
                    <div className="space-y-1">
                      <Req status={reqStatus(st, "reflection")} label={L.reflection} />
                      <Req status={reqStatus(st, "alignment")} label={L.alignment} />
                      <Req status={reqStatus(st, "change")} label={L.change} />
                      {st.grievanceSummary && (
                        <div className="text-[10px] text-muted-foreground">{L.grievLabel}: {L.grievResp} {st.grievanceSummary.received_responded ?? st.grievanceSummary.received_accepted}/{st.grievanceSummary.received} · {st.grievanceSummary.received_accepted}/{st.grievanceSummary.received} {L.grievAcceptedWord} · {L.grievOwned} {st.grievanceSummary.given_accepted_by_me ?? 0}/{st.grievanceSummary.given}</div>
                      )}
                    </div>
                  )}
                  {entry?.summary && <p className="text-xs italic text-muted-foreground leading-snug">“{entry.summary}”</p>}
                  {entry && (
                    <div className="text-[10px] text-muted-foreground/70">{new Date(entry.created_at * 1000).toLocaleString()}</div>
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
            {L.analyze}
          </span>
          <ChevronRight className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
        </button>
      )}
    </div>
  );
}
