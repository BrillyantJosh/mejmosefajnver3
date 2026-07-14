import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle, Users, Telescope } from "lucide-react";
import { useAllOwnProcesses } from "@/hooks/useAllOwnProcesses";
import { useOwnAssessments, type PhaseState } from "@/hooks/useOwnAssessments";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor, ASSESSED_PHASES } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    title: "OWN Matrica",
    intro: "Vsi aktivni OWN procesi in ocene bitij (javno). Izberi proces za matrico po udeležencih in časovnico mnenj bitij.",
    noProcs: "Trenutno ni aktivnih OWN procesov.",
    participants: "udeležencev", active: "Aktiven",
    allProcesses: "Vsi procesi", officialPhase: "Uradna faza:", beingsAssessing: "bitij ocenjuje",
    tabMatrix: "Matrica", tabTimeline: "Časovnica",
    loadingAssess: "Nalagam ocene…", noAssess: "Za ta proces še nobeno bitje ni objavilo ocene.",
    legendIntro: "Vsaka celica = kako to bitje bere udeleženca. Dvoje ločeno:",
    currentlyIn: "Trenutno v", currentlyInDesc: "faza, za katero bitje meni, da je udeleženec zdaj v njej.",
    reqMet: "Izpolnjene zahteve", reqMetDesc: "katere faze je zaključil:",
    doneLeg: "opravljeno", inProgressLeg: "v teku — še ne izpolnjeno", notYetLeg: "še ne — ni doseženo",
    participant: "Udeleženec", confidence: "zaupanje",
    reflection: "Refleksija", alignment: "Uskladitev", change: "Sprememba",
    done: "opravljeno", inProgress: "v teku", notYet: "še ne",
    timelineIntro: "Mnenja bitij skozi čas (najprej najnovejša) — vsako pokaže svojo argumentacijo po fazah za ta proces.",
    allParts: "Vsi udeleženci", allBeings: "Vsa bitja",
    loading: "Nalagam…", on: "o", met: "izpolnjeno", conf: "zaup",
  },
  en: {
    title: "OWN Matrix",
    intro: "All active OWN processes and the beings' assessments (public). Pick a process for the participant matrix and the beings' timeline.",
    noProcs: "No active OWN processes right now.",
    participants: "participant(s)", active: "Active",
    allProcesses: "All processes", officialPhase: "Official phase:", beingsAssessing: "being(s) assessing",
    tabMatrix: "Matrix", tabTimeline: "Timeline",
    loadingAssess: "Loading assessments…", noAssess: "No being has published an assessment for this process yet.",
    legendIntro: "Each cell = how that being reads the participant. Two separate things:",
    currentlyIn: "Currently in", currentlyInDesc: "the phase the being thinks they are in right now.",
    reqMet: "Requirements met", reqMetDesc: "which phases they have completed:",
    doneLeg: "done", inProgressLeg: "in progress — not yet met", notYetLeg: "not yet — not reached",
    participant: "Participant", confidence: "confidence",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    done: "done", inProgress: "in progress", notYet: "not yet",
    timelineIntro: "The beings' opinions over time (newest first) — each shows its reasoning per phase for this process.",
    allParts: "All participants", allBeings: "All beings",
    loading: "Loading…", on: "on", met: "met", conf: "conf",
  },
};

export default function Matrix() {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { processes, isLoading: loadingProcs } = useAllOwnProcesses();
  // Deep-link: /own/matrix?process=<caseRoot> opens that process directly (from
  // a participant's "Analyze the others" card). Read once as the initial
  // selection so the back button still returns to the full list.
  const [searchParams] = useSearchParams();
  const [selectedCaseRoot, setSelectedCaseRoot] = useState<string | null>(() => {
    const p = searchParams.get("process");
    return p ? p.toLowerCase() : null;
  });

  const selected = useMemo(
    () => processes.find((r) => r.caseEventId === selectedCaseRoot) || null,
    [processes, selectedCaseRoot],
  );

  const { entries, states, isLoading: loadingAssess } = useOwnAssessments(selectedCaseRoot);

  const participants = useMemo(() => {
    if (!selected) return [] as string[];
    const set = [...(selected.participants || [])];
    if (selected.initiator && selected.initiator !== selected.facilitator && !set.includes(selected.initiator)) {
      set.unshift(selected.initiator);
    }
    return set;
  }, [selected]);

  const beings = useMemo(() => {
    const set = new Set<string>();
    states.forEach((s) => set.add(s.beingPubkey));
    entries.forEach((e) => set.add(e.beingPubkey));
    return Array.from(set);
  }, [states, entries]);

  const allPubkeys = useMemo(() => Array.from(new Set([...participants, ...beings])), [participants, beings]);
  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || short(pk);
  };

  const stateFor = (being: string, participant: string) =>
    states.find((s) => s.beingPubkey === being && s.participantPubkey === participant) || null;
  const phaseStatus = (st: PhaseState, ph: "reflection" | "alignment" | "change"): "done" | "current" | "todo" => {
    const met = ph === "reflection" ? st.reflectionComplete : ph === "alignment" ? st.alignmentComplete : st.changeComplete;
    if (met) return "done";
    if ((st.currentPhaseEstimate || "").toLowerCase() === ph) return "current";
    return "todo";
  };
  const PhaseRow = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => {
    if (status === "done") return (
      <div className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /><span className="text-xs">{label} <span className="text-green-600">· {L.done}</span></span></div>
    );
    if (status === "current") return (
      <div className="flex items-center gap-1.5"><CircleDot className="h-4 w-4 text-amber-500 shrink-0" /><span className="text-xs">{label} <span className="text-amber-600">· {L.inProgress}</span></span></div>
    );
    return (
      <div className="flex items-center gap-1.5"><Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" /><span className="text-xs text-muted-foreground/60">{label} · {L.notYet}</span></div>
    );
  };

  const [timelineParticipant, setTimelineParticipant] = useState<string>("all");
  const [timelineBeing, setTimelineBeing] = useState<string>("all");
  const timeline = useMemo(
    () => entries
      .filter((e) => (timelineParticipant === "all" || e.participantPubkey === timelineParticipant)
        && (timelineBeing === "all" || e.beingPubkey === timelineBeing))
      .sort((a, b) => b.created_at - a.created_at),
    [entries, timelineParticipant, timelineBeing],
  );

  // ── LIST VIEW ──
  if (!selected) {
    const procs = processes;
    return (
      <div className="space-y-4 md:space-y-6 px-4 md:px-0">
        <div>
          <h2 className="text-base md:text-lg font-semibold flex items-center gap-2">
            <Telescope className="h-5 w-5 text-orange-600 dark:text-orange-400" /> {L.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{L.intro}</p>
        </div>

        {loadingProcs ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : procs.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">{L.noProcs}</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {procs.map((p) => (
              <Card
                key={p.caseEventId}
                className="cursor-pointer hover:shadow-md hover:border-orange-500/40 transition-all"
                onClick={() => { setSelectedCaseRoot(p.caseEventId); setTimelineParticipant("all"); setTimelineBeing("all"); }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm md:text-base leading-snug">{p.title || short(p.caseEventId)}</CardTitle>
                    <Badge variant="outline" className={`${getPhaseColor(p.phase)} shrink-0`}>{getPhaseLabel(p.phase, lang)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{(p.participants?.length || 0) + (p.initiator && p.initiator !== p.facilitator ? 1 : 0)} {L.participants}</span>
                    <span>{L.active}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── DETAIL VIEW ──
  return (
    <div className="space-y-4 md:space-y-6 px-4 md:px-0">
      <Button variant="ghost" size="sm" onClick={() => setSelectedCaseRoot(null)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft size={16} /><span>{L.allProcesses}</span>
      </Button>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-base md:text-lg font-semibold leading-snug">{selected.title || short(selected.caseEventId)}</h2>
            <Badge variant="outline" className={getPhaseColor(selected.phase)}>{L.officialPhase} {getPhaseLabel(selected.phase, lang)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-sm text-muted-foreground">
            <span>{participants.length} {L.participants}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-orange-500" />{beings.length} {L.beingsAssessing}</span>
          </div>
          {processes.length > 1 && (
            <div className="mt-3">
              <Select value={selectedCaseRoot || ""} onValueChange={(v) => { setSelectedCaseRoot(v); setTimelineParticipant("all"); setTimelineBeing("all"); }}>
                <SelectTrigger className="max-w-md h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {processes.map((r) => (
                    <SelectItem key={r.caseEventId} value={r.caseEventId}>
                      {r.title || short(r.caseEventId)} · <span className="opacity-70">{getPhaseLabel(r.phase, lang)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="matrix" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="matrix">{L.tabMatrix}</TabsTrigger>
          <TabsTrigger value="timeline">{L.tabTimeline}</TabsTrigger>
        </TabsList>

        {/* ── MATRIX ── */}
        <TabsContent value="matrix" className="space-y-4">
          {beings.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingAssess ? L.loadingAssess : L.noAssess}</CardContent></Card>
          ) : (
            <div className="overflow-x-auto">
              <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
                <div>{L.legendIntro}</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span><strong className="text-foreground">{L.currentlyIn}</strong> — {L.currentlyInDesc}</span>
                  <span><strong className="text-foreground">{L.reqMet}</strong> — {L.reqMetDesc}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {L.doneLeg}</span>
                  <span className="inline-flex items-center gap-1"><CircleDot className="h-3.5 w-3.5 text-amber-500" /> {L.inProgressLeg}</span>
                  <span className="inline-flex items-center gap-1"><Circle className="h-3.5 w-3.5 text-muted-foreground/40" /> {L.notYetLeg}</span>
                </div>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold">{L.participant}</th>
                    {beings.map((b) => (
                      <th key={b} className="text-left p-3 font-semibold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-orange-500" />{nameOf(b)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p} className="border-b border-border/50 align-top">
                      <td className="p-3 font-medium whitespace-nowrap">{nameOf(p)}</td>
                      {beings.map((b) => {
                        const st = stateFor(b, p);
                        if (!st) return <td key={b} className="p-3 text-muted-foreground/50">—</td>;
                        return (
                          <td key={b} className="p-3">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{L.currentlyIn}</div>
                            <Badge variant="outline" className={`${getPhaseColor(st.currentPhaseEstimate)} mb-2`}>{getPhaseLabel(st.currentPhaseEstimate, lang)}</Badge>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{L.reqMet}</div>
                            <div className="space-y-1">
                              <PhaseRow status={phaseStatus(st, "reflection")} label={L.reflection} />
                              <PhaseRow status={phaseStatus(st, "alignment")} label={L.alignment} />
                              <PhaseRow status={phaseStatus(st, "change")} label={L.change} />
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1.5">{L.confidence} {(st.overallConfidence).toFixed(2)}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── TIMELINE ── */}
        <TabsContent value="timeline" className="space-y-4">
          <p className="text-xs text-muted-foreground">{L.timelineIntro}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={timelineParticipant} onValueChange={setTimelineParticipant}>
              <SelectTrigger className="w-auto min-w-[10rem] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{L.allParts}</SelectItem>
                {participants.map((p) => <SelectItem key={p} value={p}>{nameOf(p)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={timelineBeing} onValueChange={setTimelineBeing}>
              <SelectTrigger className="w-auto min-w-[9rem] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{L.allBeings}</SelectItem>
                {beings.map((b) => <SelectItem key={b} value={b}>{nameOf(b)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {timeline.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingAssess ? L.loading : L.noAssess}</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {timeline.map((e) => (
                <div key={e.id} className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                      <Bot className="h-4 w-4 text-orange-500" />{nameOf(e.beingPubkey)}
                      <span className="font-normal text-muted-foreground">{L.on} {nameOf(e.participantPubkey)}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getPhaseColor(e.phaseEstimate)}>{getPhaseLabel(e.phaseEstimate, lang)}</Badge>
                      <span className="text-[11px] text-muted-foreground">{new Date(e.created_at * 1000).toLocaleString()}</span>
                    </div>
                  </div>
                  {e.summary && <p className="text-sm mb-3 italic">“{e.summary}”</p>}
                  <div className="space-y-2">
                    {ASSESSED_PHASES.map((ph) => {
                      const v = (e.phases as any)?.[ph];
                      if (!v) return null;
                      const met = !!v.requirement_met;
                      const current = String(e.phaseEstimate || "").toLowerCase() === ph;
                      return (
                        <div key={ph} className="rounded-md bg-background/60 border border-border/50 p-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            {met ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> : current ? <CircleDot className="h-4 w-4 text-amber-500 shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />}
                            {getPhaseLabel(ph, lang)}
                            <span className="font-normal text-muted-foreground">· {met ? L.met : current ? L.inProgress : L.notYet} · {L.conf} {(Number(v.confidence) || 0).toFixed(2)}</span>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
