import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle } from "lucide-react";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor, ASSESSED_PHASES } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    back: "Nazaj na klepet",
    latest: "Zadnje mnenje vsakega bitja",
    noneLatest: "Nobeno bitje še ni ocenilo tega udeleženca.",
    timeline: "Časovnica mnenj (najnovejša zgoraj)",
    noOpinions: "Ni mnenj.", loading: "Nalagam…",
    reflection: "Refleksija", alignment: "Uskladitev", change: "Sprememba",
    done: "opravljeno", inProgress: "v teku", notYet: "še ne",
    met: "izpolnjeno",
  },
  en: {
    back: "Back to chat",
    latest: "Latest opinion from each being",
    noneLatest: "No being has assessed this participant yet.",
    timeline: "Timeline of opinions (newest first)",
    noOpinions: "No opinions.", loading: "Loading…",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    done: "done", inProgress: "in progress", notYet: "not yet",
    met: "met",
  },
};

interface Props {
  caseRoot: string | null;
  participantPubkey: string;
  participantName: string;
  phase?: string;
  onBack: () => void;
}

// The right-side detail (overseer view): one participant's timeline (all 87047
// opinions over time) + the latest verdict from each being about them.
export default function OwnParticipantDetail({ caseRoot, participantPubkey, participantName, phase, onBack }: Props) {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { entries, states, isLoading } = useOwnAssessments(caseRoot);
  const me = (participantPubkey || "").toLowerCase();

  const myStates = useMemo(() => states.filter((s) => s.participantPubkey === me), [states, me]);
  const myEntries = useMemo(
    () => entries.filter((e) => e.participantPubkey === me).sort((a, b) => b.created_at - a.created_at),
    [entries, me],
  );
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
  const phaseKeyLabel = (ph: string) => getPhaseLabel(ph, lang);

  return (
    <div className="h-full overflow-y-auto space-y-4 px-4 md:px-2">
      <div className="flex items-center justify-between gap-2 sticky top-0 bg-background/95 backdrop-blur py-2 z-10">
        <Button variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground -ml-2">
          <ArrowLeft size={16} /><span>{L.back}</span>
        </Button>
        {phase && <Badge variant="outline" className={getPhaseColor(phase)}>{getPhaseLabel(phase, lang)}</Badge>}
      </div>

      <h3 className="text-base font-semibold">{participantName}</h3>

      {/* Latest verdict from each being */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">{L.latest}</h4>
        {isLoading && beings.length === 0 ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
        ) : beings.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.noneLatest}</CardContent></Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
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
                      </div>
                    )}
                    {entry?.summary && <p className="text-xs italic text-muted-foreground leading-snug">“{entry.summary}”</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Timeline of opinions */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">{L.timeline}</h4>
        {myEntries.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{isLoading ? L.loading : L.noOpinions}</CardContent></Card>
        ) : (
          <div className="space-y-2.5">
            {myEntries.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                    <Bot className="h-4 w-4 text-orange-500" />{nameOf(e.beingPubkey)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getPhaseColor(e.phaseEstimate)}>{getPhaseLabel(e.phaseEstimate, lang)}</Badge>
                    <span className="text-[11px] text-muted-foreground">{new Date(e.created_at * 1000).toLocaleString()}</span>
                  </div>
                </div>
                {e.summary && <p className="text-sm mb-2 italic">“{e.summary}”</p>}
                <div className="space-y-1.5">
                  {ASSESSED_PHASES.map((ph) => {
                    const v = (e.phases as any)?.[ph];
                    if (!v) return null;
                    const met = !!v.requirement_met;
                    const current = String(e.phaseEstimate || "").toLowerCase() === ph;
                    return (
                      <div key={ph} className="rounded-md bg-muted/40 border border-border/50 p-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          {met ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : current ? <CircleDot className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />}
                          {phaseKeyLabel(ph)}
                          <span className="font-normal text-muted-foreground">· {met ? L.met : current ? L.inProgress : L.notYet}</span>
                        </div>
                        {v.rationale && <p className="text-xs text-muted-foreground mt-1" style={{ paddingLeft: "1.4rem" }}>{v.rationale}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
