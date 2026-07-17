import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle } from "lucide-react";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useOwnGrievances, type Grievance } from "@/hooks/useOwnGrievances";
import { useOwnGuidance, type GuidanceEntry } from "@/hooks/useOwnGuidance";
import { useOwnEmotions, HEAVY_EMOTIONS, LIGHT_EMOTIONS, EMOTION_LABELS } from "@/hooks/useOwnEmotions";
import EmotionJourneySparkline from "@/components/own/EmotionJourneySparkline";
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
    grievLegend: "Vsak očitek gre skozi štiri korake: prejemnik nanj odgovori (vsak odziv šteje, tudi obramba) in ga brezpogojno sprejme (z opravičilom, če se le da), dajalec pa ga sprejme kot del svoje zablode. Refleksija je zaključena šele, ko je odgovorjeno na vse prejete; uskladitev šele, ko so sprejeti vsi prejeti IN vsi dani vzeti nase.",
    compTitle: "Primerjava bitij za to osebo",
    compIntro: "Vsako bitje bere isti pogovor, a ga destilira samostojno — ⚠ pokaže, kje se bitja razhajajo.",
    compCount: "očitkov", compMissing: "pri kakem bitju manjka", compCountDiff: "razlika v številu", compStepDiff: "nestrinjanje o koraku", compNone: "—",
    compSteps: ["odg", "spr", "opr", "zab"],
    emTitle: "Čustva", emDepth: "Globina vstopa", emHeavy: "Težka", emLight: "Svetla", emSwing: "nihaj",
    emVuln: "ranljivost", emEmbody: "utelešenost", emPeak: "vrh",
    tabOpinions: "Mnenja", tabGrievances: "Očitki", tabEmotions: "Čustva",
    potTitle: "Pot", potWalked: "Pot prehojena ✓", potStuckDark: "zataknjen v temi", potStuckLight: "ostaja v svetlem", potOnWay: "še na poti",
    noGriev: "Ni zabeleženih očitkov za to osebo.", noEmotions: "Bitja še niso zaznala čustev pri tej osebi.",
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
    grievLegend: "Every grievance passes four steps: the receiver responds to it (any reaction counts, defense too) and unconditionally accepts it (apologizing where possible), and the giver accepts it as part of their own delusion. Reflection completes only once every received grievance got a response; alignment only once all received are accepted AND all given are owned.",
    compTitle: "Being comparison for this person",
    compIntro: "Every being reads the same conversation but distills it independently — ⚠ marks where the beings diverge.",
    compCount: "grievance(s)", compMissing: "missing for some being", compCountDiff: "entry-count differs", compStepDiff: "step disagreement", compNone: "—",
    compSteps: ["resp", "acc", "apo", "own"],
    emTitle: "Emotions", emDepth: "Depth of entry", emHeavy: "Heavy", emLight: "Light", emSwing: "swing",
    emVuln: "vulnerability", emEmbody: "embodiment", emPeak: "peak",
    tabOpinions: "Opinions", tabGrievances: "Grievances", tabEmotions: "Emotions",
    potTitle: "Path", potWalked: "Path walked ✓", potStuckDark: "stuck in the dark", potStuckLight: "remains in the light", potOnWay: "still on the way",
    noGriev: "No grievances recorded for this person.", noEmotions: "No emotions detected for this person yet.",
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
  const { palettes: emotionPalettes } = useOwnEmotions(caseRoot);
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

  // Primerjava bitij za to osebo: pairs involving them, aligned across every
  // being's ledger — same divergence logic as the /own/matrix Primerjava.
  const grievCompare = useMemo(() => {
    const involved = ledgers.filter((l) => l.grievances.some((g) => g.fromPubkey === me || g.toPubkey === me));
    if (involved.length < 2) return null;
    const STEPS = ["resp", "acc", "apo", "own"] as const;
    const done = (g: Grievance) => ({ resp: g.respondedByTarget, acc: g.status === "accepted", apo: g.apologyNoted, own: g.acceptedByGiver });
    const pairKeys = new Set<string>();
    for (const l of involved) for (const g of l.grievances) if (g.fromPubkey === me || g.toPubkey === me) pairKeys.add(`${g.fromPubkey}|${g.toPubkey}`);
    const rows = [...pairKeys].sort().map((key) => {
      const [from, to] = key.split("|");
      const cells = involved.map((l) => {
        const gs = l.grievances.filter((g) => g.fromPubkey === from && g.toPubkey === to);
        const counts: Record<(typeof STEPS)[number], number> = { resp: 0, acc: 0, apo: 0, own: 0 };
        for (const g of gs) { const d = done(g); for (const s of STEPS) if (d[s]) counts[s]++; }
        return { being: l.beingPubkey, n: gs.length, counts };
      });
      const present = cells.filter((c) => c.n > 0);
      const ns = present.map((c) => c.n);
      const stepDisagree: Record<string, boolean> = {};
      for (const s of STEPS) {
        const verdicts = present.map((c) => c.counts[s] === c.n);
        if (verdicts.length >= 2 && !verdicts.every((v) => v === verdicts[0])) stepDisagree[s] = true;
      }
      return { from, to, cells, countDiff: present.length >= 2 && Math.max(...ns) - Math.min(...ns) > 1, missing: cells.some((c) => c.n === 0) && present.length > 0, stepDisagree };
    });
    return { beings: involved.map((l) => l.beingPubkey), rows };
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

  const myPalettes = useMemo(
    () => emotionPalettes.filter((pal) => pal.participantPubkey === me).sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)),
    [emotionPalettes, me],
  );

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

      {/* Trije zavihki — kot na strani Matrix: Mnenja / Očitki / Čustva */}
      <Tabs defaultValue="opinions" className="space-y-3">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="opinions">{L.tabOpinions}</TabsTrigger>
          <TabsTrigger value="grievances">{L.tabGrievances}</TabsTrigger>
          <TabsTrigger value="emotions">{L.tabEmotions}</TabsTrigger>
        </TabsList>

        <TabsContent value="opinions" className="space-y-4">
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
        </TabsContent>

        <TabsContent value="grievances" className="space-y-4">
          {grievByBeing.length === 0 && (
            <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.noGriev}</CardContent></Card>
          )}
        {/* Grievances involving this participant — per being, omitted when empty */}
        {grievByBeing.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{L.grievTitle}</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{L.grievLegend}</p>
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

            {/* ── Primerjava bitij za to osebo (⚠ = razhajanje) ── */}
            {grievCompare && (
              <Card className="border-orange-500/25 bg-orange-500/[0.04]">
                <CardContent className="p-3 space-y-2">
                  <div className="text-sm font-medium">{L.compTitle}</div>
                  <p className="text-[11px] text-muted-foreground">{L.compIntro}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="text-left p-1.5 font-medium">{L.grievTitle}</th>
                          {grievCompare.beings.map((b) => (
                            <th key={b} className="text-left p-1.5 font-medium whitespace-nowrap">
                              <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3 text-orange-500" />{nameOf(b)}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {grievCompare.rows.map((row) => (
                          <tr key={`${row.from}|${row.to}`} className="border-b border-border/40 align-top">
                            <td className="p-1.5 min-w-[8rem]">
                              <div className="font-medium">{nameOf(row.from)} → {nameOf(row.to)}</div>
                              <div className="mt-0.5 space-x-1.5">
                                {row.missing && <span className="text-[10px] text-amber-600">⚠ {L.compMissing}</span>}
                                {row.countDiff && <span className="text-[10px] text-amber-600">⚠ {L.compCountDiff}</span>}
                                {Object.keys(row.stepDisagree).length > 0 && <span className="text-[10px] text-amber-600">⚠ {L.compStepDiff}</span>}
                              </div>
                            </td>
                            {row.cells.map((c) => (
                              <td key={c.being} className="p-1.5 whitespace-nowrap">
                                {c.n === 0 ? (
                                  <span className="text-amber-600/80">{L.compNone}</span>
                                ) : (
                                  <div>
                                    <div className="font-medium">{c.n} {L.compCount}</div>
                                    <div className="text-muted-foreground mt-0.5 space-x-1.5">
                                      {(["resp", "acc", "apo", "own"] as const).map((s, i) => (
                                        <span key={s} className={row.stepDisagree[s] ? "text-amber-600 font-semibold" : c.counts[s] === c.n ? "text-green-600" : undefined}>
                                          {L.compSteps[i]} {c.counts[s]}/{c.n}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
        </TabsContent>

        <TabsContent value="emotions" className="space-y-4">
          {myPalettes.length === 0 && (
            <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.noEmotions}</CardContent></Card>
          )}
        {/* ── Čustva (Steber 3): paleta per bitje za to osebo ── */}
        {myPalettes.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{L.emTitle}</h4>
            <div className="space-y-2.5">
              {myPalettes.map((pal) => {
                const byKey = new Map(pal.emotions.map((e) => [e.key, e]));
                const lang2 = en ? "en" : "sl";
                const modeIcon = (m: string) => (m === "expressed" ? "🔥" : m === "held" ? "🤐" : "💬");
                const Chip = ({ k, heavy }: { k: string; heavy: boolean }) => {
                  const hit = byKey.get(k);
                  const label = EMOTION_LABELS[k]?.[lang2] || k;
                  if (!hit) return <span className="inline-flex items-center rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/40">{label}</span>;
                  const alpha = 0.15 + 0.55 * hit.peakIntensity;
                  return (
                    <span
                      title={`${label} · ${L.emPeak} ${hit.peakIntensity.toFixed(2)} · ${hit.mode}${hit.evidence ? ` — ${hit.evidence}` : ""}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${heavy ? "border-red-500/50 text-red-700 dark:text-red-400" : "border-green-500/50 text-green-700 dark:text-green-400"}`}
                      style={{ backgroundColor: heavy ? `rgba(239,68,68,${alpha * 0.25})` : `rgba(34,197,94,${alpha * 0.25})` }}
                    >
                      {modeIcon(hit.mode)} {label} <span className="opacity-70">{Math.round(hit.peakIntensity * 100)}</span>
                    </span>
                  );
                };
                return (
                  <Card key={pal.beingPubkey} className="border-orange-500/25 bg-orange-500/[0.04]">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium inline-flex items-center gap-1.5">
                          <Bot className="h-4 w-4 text-orange-500" />{nameOf(pal.beingPubkey)}
                        </span>
                        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{L.emVuln} {Math.round(pal.depth.vulnerability * 100)}%</span>
                          <span>{L.emEmbody} {Math.round(pal.depth.embodiment * 100)}%</span>
                          {pal.depth.swing && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0">🎢 {L.emSwing}</Badge>}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          <span>{L.emHeavy}</span>
                          <span className="font-semibold normal-case text-foreground">{L.emDepth}: {pal.depth.score}/100</span>
                          <span>{L.emLight}</span>
                        </div>
                        <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(239,68,68,.45), rgba(234,179,8,.35), rgba(34,197,94,.45))" }}>
                          {/* razponska črta + bleda markerja ekstremov (max v vsako stran) */}
                          {pal.extremes?.heaviest && pal.extremes?.lightest && (
                            <div className="absolute top-1/2 -translate-y-1/2 h-0.5 bg-foreground/25" style={{ left: `${pal.extremes.heaviest.polarity}%`, width: `${Math.max(0, pal.extremes.lightest.polarity - pal.extremes.heaviest.polarity)}%` }} />
                          )}
                          {pal.extremes?.heaviest && <div title={`min ${pal.extremes.heaviest.polarity}`} className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-red-500/80 bg-background" style={{ left: `calc(${pal.extremes.heaviest.polarity}% - 5px)` }} />}
                          {pal.extremes?.lightest && <div title={`max ${pal.extremes.lightest.polarity}`} className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-green-500/80 bg-background" style={{ left: `calc(${pal.extremes.lightest.polarity}% - 5px)` }} />}
                          <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-foreground border-2 border-background shadow" style={{ left: `calc(${pal.depth.polarity ?? 50}% - 7px)` }} />
                        </div>
                        {/* Čustvena Pot: krivulja skozi čas + sodba */}
                        <div className="mt-2 flex items-end gap-3 flex-wrap">
                          <EmotionJourneySparkline journey={pal.journey} extremes={pal.extremes} />
                          {pal.path && (
                            <Badge variant="outline" className={pal.path.walked
                              ? "bg-green-500/10 text-green-600 border-green-500/30 text-[10px] py-0"
                              : pal.path.stuck ? "bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0"
                              : "text-muted-foreground border-border text-[10px] py-0"}>
                              {L.potTitle}: {pal.path.walked ? L.potWalked : pal.path.stuck === "dark" ? L.potStuckDark : pal.path.stuck === "light" ? L.potStuckLight : L.potOnWay}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">{HEAVY_EMOTIONS.map((k) => <Chip key={k} k={k} heavy />)}</div>
                        <div className="flex flex-wrap gap-1">{LIGHT_EMOTIONS.map((k) => <Chip key={k} k={k} heavy={false} />)}</div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
