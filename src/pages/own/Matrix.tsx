import { useMemo, useState } from "react";
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

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const PhaseRow = ({ status, label }: { status: "done" | "current" | "todo"; label: string }) => {
  if (status === "done") return (
    <div className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /><span className="text-xs">{label} <span className="text-green-600">· done</span></span></div>
  );
  if (status === "current") return (
    <div className="flex items-center gap-1.5"><CircleDot className="h-4 w-4 text-amber-500 shrink-0" /><span className="text-xs">{label} <span className="text-amber-600">· in progress</span></span></div>
  );
  return (
    <div className="flex items-center gap-1.5"><Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" /><span className="text-xs text-muted-foreground/60">{label} · not yet</span></div>
  );
};

export default function Matrix() {
  const { processes, isLoading: loadingProcs } = useAllOwnProcesses();
  const [selectedCaseRoot, setSelectedCaseRoot] = useState<string | null>(null);

  const selected = useMemo(
    () => processes.find((r) => r.caseEventId === selectedCaseRoot) || null,
    [processes, selectedCaseRoot],
  );

  const { entries, states, isLoading: loadingAssess } = useOwnAssessments(selectedCaseRoot);

  // The people who go THROUGH the process = participants + the initiator
  // (unless the initiator is the facilitator). Both are assessed by the beings.
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

  const phaseStatus = (st: PhaseState, phase: "reflection" | "alignment" | "change"): "done" | "current" | "todo" => {
    const met = phase === "reflection" ? st.reflectionComplete : phase === "alignment" ? st.alignmentComplete : st.changeComplete;
    if (met) return "done";
    if ((st.currentPhaseEstimate || "").toLowerCase() === phase) return "current";
    return "todo";
  };

  // ── Timeline filters (beings' opinions over time) ──
  const [timelineParticipant, setTimelineParticipant] = useState<string>("all");
  const [timelineBeing, setTimelineBeing] = useState<string>("all");
  const timeline = useMemo(
    () => entries
      .filter((e) => (timelineParticipant === "all" || e.participantPubkey === timelineParticipant)
        && (timelineBeing === "all" || e.beingPubkey === timelineBeing))
      .sort((a, b) => b.created_at - a.created_at), // newest first
    [entries, timelineParticipant, timelineBeing],
  );

  // ── LIST VIEW: all active processes ──
  if (!selected) {
    return (
      <div className="space-y-4 md:space-y-6 px-4 md:px-0">
        <div>
          <h2 className="text-base md:text-lg font-semibold flex items-center gap-2">
            <Telescope className="h-5 w-5 text-orange-600 dark:text-orange-400" /> OWN Matrix
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Vsi aktivni OWN procesi in ocene bitij (javno). Izberi proces za matrico po udeležencih in časovnico mnenj bitij.
          </p>
        </div>

        {loadingProcs ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : processes.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Trenutno ni aktivnih OWN procesov.</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {processes.map((p) => (
              <Card
                key={p.caseEventId}
                className="cursor-pointer hover:shadow-md hover:border-orange-500/40 transition-all"
                onClick={() => { setSelectedCaseRoot(p.caseEventId); setTimelineParticipant("all"); setTimelineBeing("all"); }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm md:text-base leading-snug">{p.title || short(p.caseEventId)}</CardTitle>
                    <Badge variant="outline" className={`${getPhaseColor(p.phase)} shrink-0`}>{getPhaseLabel(p.phase)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{(p.participants?.length || 0) + (p.initiator && p.initiator !== p.facilitator ? 1 : 0)} udeležencev</span>
                    <span>Aktiven</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── DETAIL VIEW: matrix + timeline for the selected process ──
  return (
    <div className="space-y-4 md:space-y-6 px-4 md:px-0">
      <Button variant="ghost" size="sm" onClick={() => setSelectedCaseRoot(null)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft size={16} /><span>Vsi procesi</span>
      </Button>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-base md:text-lg font-semibold leading-snug">{selected.title || short(selected.caseEventId)}</h2>
            <Badge variant="outline" className={getPhaseColor(selected.phase)}>Uradna faza: {getPhaseLabel(selected.phase)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-sm text-muted-foreground">
            <span>{participants.length} udeležencev</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-orange-500" />{beings.length} bitij ocenjuje</span>
          </div>
          {/* Quick process switcher so you don't have to go back to the list */}
          {processes.length > 1 && (
            <div className="mt-3">
              <Select value={selectedCaseRoot || ""} onValueChange={(v) => { setSelectedCaseRoot(v); setTimelineParticipant("all"); setTimelineBeing("all"); }}>
                <SelectTrigger className="max-w-md h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {processes.map((r) => (
                    <SelectItem key={r.caseEventId} value={r.caseEventId}>
                      {r.title || short(r.caseEventId)} · <span className="opacity-70">{getPhaseLabel(r.phase)}</span>
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
          <TabsTrigger value="matrix">Matrica</TabsTrigger>
          <TabsTrigger value="timeline">Časovnica</TabsTrigger>
        </TabsList>

        {/* ── MATRIX: participant × being current state (37045) ── */}
        <TabsContent value="matrix" className="space-y-4">
          {beings.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingAssess ? "Nalagam ocene…" : "Za ta proces še nobeno bitje ni objavilo ocene."}</CardContent></Card>
          ) : (
            <div className="overflow-x-auto">
              <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
                <div>Vsaka celica = kako to bitje bere udeleženca. Dvoje ločeno:</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span><strong className="text-foreground">Trenutno v</strong> — faza, za katero bitje meni, da je udeleženec zdaj v njej.</span>
                  <span><strong className="text-foreground">Izpolnjene zahteve</strong> — katere faze je zaključil:</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> opravljeno</span>
                  <span className="inline-flex items-center gap-1"><CircleDot className="h-3.5 w-3.5 text-amber-500" /> v teku — še ne izpolnjeno</span>
                  <span className="inline-flex items-center gap-1"><Circle className="h-3.5 w-3.5 text-muted-foreground/40" /> še ne — ni doseženo</span>
                </div>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold">Udeleženec</th>
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
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Trenutno v</div>
                            <Badge variant="outline" className={`${getPhaseColor(st.currentPhaseEstimate)} mb-2`}>{getPhaseLabel(st.currentPhaseEstimate)}</Badge>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Izpolnjene zahteve</div>
                            <div className="space-y-1">
                              <PhaseRow status={phaseStatus(st, "reflection")} label="Refleksija" />
                              <PhaseRow status={phaseStatus(st, "alignment")} label="Uskladitev" />
                              <PhaseRow status={phaseStatus(st, "change")} label="Sprememba" />
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1.5">zaupanje {(st.overallConfidence).toFixed(2)}</div>
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

        {/* ── TIMELINE: the beings' opinions over time (87047) ── */}
        <TabsContent value="timeline" className="space-y-4">
          <p className="text-xs text-muted-foreground">Mnenja bitij skozi čas (najprej najnovejša) — vsako pokaže svojo argumentacijo po fazah za ta proces.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={timelineParticipant} onValueChange={setTimelineParticipant}>
              <SelectTrigger className="w-auto min-w-[10rem] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsi udeleženci</SelectItem>
                {participants.map((p) => <SelectItem key={p} value={p}>{nameOf(p)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={timelineBeing} onValueChange={setTimelineBeing}>
              <SelectTrigger className="w-auto min-w-[9rem] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsa bitja</SelectItem>
                {beings.map((b) => <SelectItem key={b} value={b}>{nameOf(b)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {timeline.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingAssess ? "Nalagam…" : "Za ta proces še nobeno bitje ni objavilo ocene."}</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {timeline.map((e) => (
                <div key={e.id} className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                      <Bot className="h-4 w-4 text-orange-500" />{nameOf(e.beingPubkey)}
                      <span className="font-normal text-muted-foreground">o {nameOf(e.participantPubkey)}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getPhaseColor(e.phaseEstimate)}>{getPhaseLabel(e.phaseEstimate)}</Badge>
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
                            {getPhaseLabel(ph)}
                            <span className="font-normal text-muted-foreground">· {met ? "izpolnjeno" : current ? "v teku" : "še ne"} · zaup {(Number(v.confidence) || 0).toFixed(2)}</span>
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
