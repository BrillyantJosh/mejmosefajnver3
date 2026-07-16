import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle } from "lucide-react";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useOwnGrievances, type Grievance } from "@/hooks/useOwnGrievances";
import { useOwnGuidance, type GuidanceEntry } from "@/hooks/useOwnGuidance";
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
    grievTitle: "Očitki",
    grievGiven: "Dani", grievReceived: "Prejeti",
    grievAccepted: "Sprejeto", grievOpen: "Odprto", grievApologized: "opravičeno",
    stepResponded: "odgovorjen", stepOwned: "zabloda sprejeta",
    needsResponse: "čaka odgovor", needsOwn: "sprejmi kot svojo zablodo",
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
    grievTitle: "Grievances",
    grievGiven: "Given", grievReceived: "Received",
    grievAccepted: "Accepted", grievOpen: "Open", grievApologized: "apologized",
    stepResponded: "responded", stepOwned: "owned as delusion",
    needsResponse: "awaiting response", needsOwn: "own it as your delusion",
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
  const { ledgers } = useOwnGrievances(caseRoot);
  const { entries: guidance } = useOwnGuidance(caseRoot);
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

  // This participant's grievances per being — kept per being (divergence is by
  // design), only beings with at least one grievance involving them show up.
  const grievByBeing = useMemo(() => {
    const out: { being: string; given: Grievance[]; received: Grievance[] }[] = [];
    for (const l of ledgers) {
      const given = l.grievances.filter((g) => g.fromPubkey === me);
      const received = l.grievances.filter((g) => g.toPubkey === me);
      if (given.length || received.length) out.push({ being: l.beingPubkey, given, received });
    }
    return out;
  }, [ledgers, me]);

  // Steber 2 nesting: this participant's guidance (87048) under the exact
  // assessment (87047) — join on basedOnStateId, fallback nearest OLDER
  // assessment by the same being.
  const guidanceByAssessment = useMemo(() => {
    const map = new Map<string, GuidanceEntry[]>();
    const mine = guidance.filter((g) => g.participantPubkey === me);
    const byId = new Map(myEntries.map((e) => [e.id, e]));
    for (const g of mine) {
      let target: AssessmentEntry | null = g.basedOnStateId ? byId.get(g.basedOnStateId) || null : null;
      if (!target) {
        for (const e of myEntries) {
          if (String(e.beingPubkey).toLowerCase() !== g.beingPubkey) continue;
          if (e.created_at > g.created_at) continue;
          if (!target || e.created_at > target.created_at) target = e;
        }
      }
      if (!target) continue;
      if (!map.has(target.id)) map.set(target.id, []);
      map.get(target.id)!.push(g);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.created_at - b.created_at);
    return map;
  }, [guidance, myEntries, me]);

  const profilePubkeys = useMemo(() => {
    const set = new Set<string>(beings);
    grievByBeing.forEach(({ being, given, received }) => {
      set.add(being);
      given.forEach((g) => set.add(g.toPubkey));
      received.forEach((g) => set.add(g.fromPubkey));
    });
    return Array.from(set);
  }, [beings, grievByBeing]);
  const { profiles } = useNostrProfilesCacheBulk(profilePubkeys);
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

  // Steber 1.5: the full four-step life of a grievance, viewed from one side.
  // received → responded / accepted / apologized matter; given → giver-owned.
  const GrievStatus = ({ g, side }: { g: Grievance; side: "given" | "received" }) => (
    <span className="inline-flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
      {side === "received" && !g.respondedByTarget && (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0">{L.needsResponse}</Badge>
      )}
      {side === "received" && g.respondedByTarget && g.status !== "accepted" && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
          <CheckCircle2 className="h-3 w-3 text-green-500" /> {L.stepResponded}
        </span>
      )}
      {g.apologyNoted && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
          <CheckCircle2 className="h-3 w-3 text-green-500" /> {L.grievApologized}
        </span>
      )}
      {side === "given" && (g.acceptedByGiver ? (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
          <CheckCircle2 className="h-3 w-3 text-green-500" /> {L.stepOwned}
        </span>
      ) : (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0">{L.needsOwn}</Badge>
      ))}
      <Badge
        variant="outline"
        className={g.status === "accepted"
          ? "bg-green-500/10 text-green-600 border-green-500/30 text-[10px] py-0"
          : "bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0"}
      >
        {g.status === "accepted" ? L.grievAccepted : L.grievOpen}
      </Badge>
    </span>
  );

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

      {/* Grievances involving this participant — per being, omitted when empty */}
      {grievByBeing.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">{L.grievTitle}</h4>
          <div className="space-y-2.5">
            {grievByBeing.map(({ being, given, received }) => (
              <Card key={being} className="border-orange-500/25 bg-orange-500/[0.04]">
                <CardContent className="p-3 space-y-2">
                  <span className="text-sm font-medium inline-flex items-center gap-1.5">
                    <Bot className="h-4 w-4 text-orange-500" />{nameOf(being)}
                  </span>
                  {given.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{L.grievGiven}</div>
                      {given.map((g) => (
                        <div key={g.id} className="rounded-md bg-muted/40 border border-border/50 p-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-medium">→ {nameOf(g.toPubkey)}</span>
                            <GrievStatus g={g} side="given" />
                          </div>
                          {g.summary && <p className="text-xs text-muted-foreground leading-snug">{g.summary}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {received.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{L.grievReceived}</div>
                      {received.map((g) => (
                        <div key={g.id} className="rounded-md bg-muted/40 border border-border/50 p-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-medium">← {nameOf(g.fromPubkey)}</span>
                            <GrievStatus g={g} side="received" />
                          </div>
                          {g.summary && <p className="text-xs text-muted-foreground leading-snug">{g.summary}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

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
                {/* ↳ Smer (Steber 2): guidance nested under this exact assessment */}
                {(guidanceByAssessment.get(e.id) || []).map((g) => (
                  <div key={g.id} className="mt-2 ml-4 rounded-md border border-orange-500/25 bg-orange-500/[0.03] p-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-semibold">↳ {en ? "Direction" : "Smer"} · {nameOf(g.beingPubkey)}{g.direction ? <span className="font-normal text-muted-foreground"> · {g.direction}</span> : null}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(g.created_at * 1000).toLocaleString()}</span>
                    </div>
                    {g.guidance && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{g.guidance}</p>}
                    {g.nextStep && <p className="text-xs mt-1">→ {g.nextStep}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
