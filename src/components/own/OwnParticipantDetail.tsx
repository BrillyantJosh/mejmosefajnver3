import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle, Archive, ChevronDown } from "lucide-react";
import { splitLatestPerBeing, withFloatedGuidance, guidanceKindKey } from "@/lib/ownTimeline";
import GrievanceStepTable from "@/components/own/GrievanceStepTable";
import { useOwnAssessments, type AssessmentEntry, type PhaseState } from "@/hooks/useOwnAssessments";
import { useOwnGrievances, type Grievance } from "@/hooks/useOwnGrievances";
import { useOwnGuidance, type GuidanceEntry } from "@/hooks/useOwnGuidance";
import { useOwnEmotions, HEAVY_EMOTIONS, LIGHT_EMOTIONS, EMOTION_LABELS } from "@/hooks/useOwnEmotions";
import EmotionJourneySparkline from "@/components/own/EmotionJourneySparkline";
import EgoPathBar from "@/components/own/EgoPathBar";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor, ASSESSED_PHASES } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    back: "Nazaj na klepet",
    latest: "Zadnje mnenje vsakega bitja",
    noneLatest: "Nobeno bitje še ni ocenilo tega udeleženca.",
    timeline: "Zadnje mnenje vsakega bitja",
    archiveOpen: "Arhiv — starejša mnenja", archiveHide: "Skrij arhiv", archiveNote: "Presežena mnenja, od najnovejšega proti starejšim.",
    noOpinions: "Ni mnenj.", loading: "Nalagam…",
    reflection: "Refleksija", alignment: "Uskladitev", change: "Sprememba",
    done: "opravljeno", inProgress: "v teku", notYet: "še ne",
    met: "izpolnjeno",
    grievTitle: "Očitki",
    grievGiven: "Dani", grievReceived: "Prejeti",
    grievAccepted: "Sprejeto", grievOpen: "Odprto", grievApologized: "opravičeno",
    stepResponded: "odgovorjen", stepOwned: "zabloda sprejeta",
    needsResponse: "čaka odgovor", needsOwn: "sprejmi kot svojo zablodo",
    grievLegend: "Vsak očitek gre skozi štiri korake: prejemnik nanj odgovori (vsak odziv šteje, tudi obramba), ga brezpogojno sprejme in se zanj opraviči (opravičilo je obvezno), dajalec pa ga sprejme kot del svoje zablode. Refleksija je zaključena šele, ko je udeleženec tudi sam izrazil vsaj en očitek IN odgovoril na vse prejete; uskladitev šele, ko so vsi prejeti sprejeti in opravičeni IN vsi dani vzeti nase. Ko fasilitator prestopi v uskladitev, se matrica zapečati — novi očitki ne vstopajo več.",
    colResponded: "Odgovorjen", colAccepted: "Sprejet", colApologized: "Opravičen", colOwned: "Zabloda sprejeta",
    grievColorHint: "Vsak udeleženec ima svojo barvo. Odgovor, sprejem in opravičilo so na prejemniku očitka, priznanje zablode na dajalcu. Tvoje ime je podčrtano. Poln krogec s kljukico = opravljeno, obroč = še odprto.",
    grievDone: "opravljeno", grievOpen: "še ne",
    kind: { direction: "Smer", acceptance: "Sprejetost", space: "Prostor", reminder: "Opomnik", movingOn: "Umik", closingCall: "Zaključni klic", pause: "Pavza", celebration: "Praznovanje", guidance: "Vodenje" } as Record<string, string>,
    grievDetail: "Podrobno — kaj še čaka", grievEmptyBeing: "To bitje zate še ni zabeležilo očitkov.",
    compTitle: "Primerjava bitij za to osebo",
    compIntro: "Vsako bitje bere isti pogovor, a ga destilira samostojno — ⚠ pokaže, kje se bitja razhajajo.",
    compCount: "očitkov", compMissing: "pri kakem bitju manjka", compCountDiff: "razlika v številu", compStepDiff: "nestrinjanje o koraku", compNone: "—",
    compSteps: ["odg", "spr", "opr", "zab"],
    emTitle: "Čustva", emDepth: "Globina vstopa", emHeavy: "Težka", emLight: "Svetla", emSwing: "nihaj",
    egoPending: "Pot predaje ega se še izračunava …",
    egoL: {
      title: "Pot predaje ega",
      st: { ego: "Ego", razpoka: "Razpoka", poniznost: "Ponižnost", "v-sebi": "V sebi", lahkotnost: "Lahkotnost" },
      gate: "Do lahkotnosti ni bližnjice — vodi le skozi ponižnost (sram, krivda), kjer ego popusti. Levo od vrat je svetel ton še vedno površina ega.",
      readBright: "Svetel ton, a ego je še cel — nase še ni vzel(a) ničesar ({y}/{c}).",
      readCracking: "Težka čustva vzniknejo, ego še ni popustil ({y}/{c} vzetih nase).",
      readUntouched: "Ego še nedotaknjen — ne globine ne predaje.",
      readPassage: "Sredi prehoda: šel(a) je v težko IN nekaj vzel(a) nase ({y}/{c}).",
      readStanding: "Skozi ponižnost — stoji v sebi, vzel(a) nase vse ({y}/{c}). Svetloba se še ni vrnila.",
      readEarned: "Zaslužena lahkotnost — skozi ponižnost, vzel(a) nase vse ({y}/{c}); trdota se je raztopila.",
      legend: "",
    },
    emVuln: "ranljivost", emEmbody: "utelešenost", emPeak: "vrh",
    tabOpinions: "Mnenja", tabGrievances: "Očitki", tabEmotions: "Čustva",
    potTitle: "Pot", potWalked: "Pot prehojena ✓", potStuckDark: "zataknjen v temi", potStuckLight: "ostaja v svetlem", potOnWay: "še na poti",
    noGriev: "Ni zabeleženih očitkov za to osebo.", noEmotions: "Bitja še niso zaznala čustev pri tej osebi.",
  },
  en: {
    back: "Back to chat",
    latest: "Latest opinion from each being",
    noneLatest: "No being has assessed this participant yet.",
    timeline: "Each being's latest opinion",
    archiveOpen: "Archive — older opinions", archiveHide: "Hide archive", archiveNote: "Superseded opinions, newest first.",
    noOpinions: "No opinions.", loading: "Loading…",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    done: "done", inProgress: "in progress", notYet: "not yet",
    met: "met",
    grievTitle: "Grievances",
    grievGiven: "Given", grievReceived: "Received",
    grievAccepted: "Accepted", grievOpen: "Open", grievApologized: "apologized",
    stepResponded: "responded", stepOwned: "owned as delusion",
    needsResponse: "awaiting response", needsOwn: "own it as your delusion",
    grievLegend: "Every grievance passes four steps: the receiver responds to it (any reaction counts, defense too), unconditionally accepts it and apologizes for it (the apology is mandatory), and the giver accepts it as part of their own delusion. Reflection completes only once the participant has also expressed at least one grievance of their own AND responded to every received one; alignment only once all received are accepted and apologized AND all given are owned. Once the facilitator moves to alignment the matrix is sealed — new grievances no longer enter.",
    colResponded: "Responded", colAccepted: "Accepted", colApologized: "Apologized", colOwned: "Owned as delusion",
    grievColorHint: "Each participant has their own colour. Respond, accept and apologize are the receiver's; owning the delusion is the giver's. Your name is underlined. Filled check = done, hollow ring = still open.",
    grievDone: "done", grievOpen: "not yet",
    kind: { direction: "Direction", acceptance: "Acceptance", space: "Space", reminder: "Reminder", movingOn: "Moving on", closingCall: "Closing call", pause: "Pause", celebration: "Celebration", guidance: "Guidance" } as Record<string, string>,
    grievDetail: "Detail — what is still pending", grievEmptyBeing: "This being has recorded no grievances for you yet.",
    compTitle: "Being comparison for this person",
    compIntro: "Every being reads the same conversation but distills it independently — ⚠ marks where the beings diverge.",
    compCount: "grievance(s)", compMissing: "missing for some being", compCountDiff: "entry-count differs", compStepDiff: "step disagreement", compNone: "—",
    compSteps: ["resp", "acc", "apo", "own"],
    emTitle: "Emotions", emDepth: "Depth of entry", emHeavy: "Heavy", emLight: "Light", emSwing: "swing",
    egoPending: "The ego-surrender path is still being computed …",
    egoL: {
      title: "The ego-surrender path",
      st: { ego: "Ego", razpoka: "Cracking", poniznost: "Humility", "v-sebi": "In oneself", lahkotnost: "Lightness" },
      gate: "There is no shortcut to lightness — it leads only through humility (shame, guilt), where the ego gives way. Left of the gate a bright tone is still the ego's surface.",
      readBright: "A bright tone, but the ego is still whole — nothing taken on yet ({y}/{c}).",
      readCracking: "Heavy emotions are rising; the ego has not yet given way ({y}/{c} taken on).",
      readUntouched: "The ego is untouched — neither depth nor surrender.",
      readPassage: "Mid-passage: went into the heavy AND took something on ({y}/{c}).",
      readStanding: "Through humility — standing in themselves, took on all of it ({y}/{c}). The light has not returned yet.",
      readEarned: "Earned lightness — through humility, took on all of it ({y}/{c}); the hardness dissolved.",
      legend: "",
    },
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
  // Focus: what each being holds NOW; superseded opinions go to the archive.
  const { current: entriesCurrent, archive: entriesArchive } = useMemo(() => splitLatestPerBeing(myEntries), [myEntries]);
  const [showArchive, setShowArchive] = useState(false);
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

  // One roster across ALL beings' grievances so a person is the same colour in
  // every being's sub-table (colours are assigned by position, not a hash).
  const grievRoster = useMemo(() => {
    const set = new Set<string>();
    for (const l of ledgers) for (const g of l.grievances) {
      set.add((g.fromPubkey || "").toLowerCase());
      set.add((g.toPubkey || "").toLowerCase());
    }
    return Array.from(set);
  }, [ledgers]);

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

  // A being's newest word floats onto its current opinion when its own anchor
  // assessment moved to the archive — otherwise the being looks silent.
  const guidanceForCurrent = useMemo(
    () => withFloatedGuidance(guidanceByAssessment, guidance.filter((g) => g.participantPubkey === me), entriesCurrent),
    [guidanceByAssessment, guidance, entriesCurrent, me],
  );

  const myPalettes = useMemo(
    () => emotionPalettes.filter((pal) => pal.participantPubkey === me).sort((a, b) => a.beingPubkey.localeCompare(b.beingPubkey)),
    [emotionPalettes, me],
  );

  const profilePubkeys = useMemo(() => {
    const set = new Set<string>(beings);
    set.add(me);   // the person being viewed appears in every grievance pair
    grievByBeing.forEach(({ being, given, received }) => {
      set.add(being);
      given.forEach((g) => { set.add(g.fromPubkey); set.add(g.toPubkey); });
      received.forEach((g) => { set.add(g.fromPubkey); set.add(g.toPubkey); });
    });
    // Emotion palettes may come from beings without an 87047 in this case —
    // include them or the Čustva tab shows raw hashes.
    emotionPalettes.forEach((pal) => set.add(pal.beingPubkey));
    return Array.from(set);
  }, [beings, grievByBeing, emotionPalettes, me]);
  const { profiles } = useNostrProfilesCacheBulk(profilePubkeys);
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.full_name || p?.display_name || short(pk);
  };
  const beingLabelOf = (pk: string, bodyName?: string) => {
    const n = nameOf(pk);
    return n === short(pk) && bodyName ? bodyName : n;
  };

  // One opinion card — reused by the current list and the archive.
  const renderEntry = (e: (typeof myEntries)[number], gmap: typeof guidanceByAssessment = guidanceByAssessment) => (
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
      {(gmap.get(e.id) || []).map((g) => (
        <div key={g.id} className="mt-2 ml-4 rounded-md border border-orange-500/25 bg-orange-500/[0.03] p-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold">↳ {L.kind[guidanceKindKey(g)] || L.kind.guidance} · {nameOf(g.beingPubkey)}{g.direction ? <span className="font-normal text-muted-foreground"> · {g.direction}</span> : null}</span>
            <span className="text-[10px] text-muted-foreground">{new Date(g.created_at * 1000).toLocaleString()}</span>
          </div>
          {g.guidance && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{g.guidance}</p>}
          {g.nextStep && <p className="text-xs mt-1">→ {g.nextStep}</p>}
        </div>
      ))}
    </div>
  );

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
              {entriesCurrent.map((e) => renderEntry(e, guidanceForCurrent))}
              {entriesArchive.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowArchive((v) => !v)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-orange-500/40 transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    {showArchive ? L.archiveHide : `${L.archiveOpen} (${entriesArchive.length})`}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showArchive ? "rotate-180" : ""}`} />
                  </button>
                  {showArchive && (
                    <>
                      <p className="text-[11px] text-muted-foreground">{L.archiveNote}</p>
                      <div className="space-y-2.5 opacity-75">{entriesArchive.map((e) => renderEntry(e))}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        </TabsContent>

        <TabsContent value="grievances" className="space-y-4">
          {grievByBeing.length === 0 && (
            <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.noGriev}</CardContent></Card>
          )}
        {/* FIRST: the whole list + its state, exactly as the public Matrica —
            one table per being, both directions, the four milestones. */}
        {grievByBeing.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{L.grievTitle}</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{L.grievLegend}</p>
            <div className="space-y-2.5">
              {grievByBeing.map(({ being, given, received }) => (
                <Card key={`t-${being}`} className="border-orange-500/25 bg-orange-500/[0.04]">
                  <CardContent className="p-3 space-y-2">
                    <span className="text-sm font-medium inline-flex items-center gap-1.5">
                      <Bot className="h-4 w-4 text-orange-500" />{nameOf(being)}
                    </span>
                    {received.length + given.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{L.grievEmptyBeing}</p>
                    ) : (
                      <GrievanceStepTable
                        grievances={[...received, ...given]}
                        nameOf={nameOf}
                        roster={grievRoster}
                        highlightPubkey={me}
                        labels={{ grievances: L.grievTitle, responded: L.colResponded, accepted: L.colAccepted, apologized: L.colApologized, owned: L.colOwned, colorHint: L.grievColorHint, doneWord: L.grievDone, openWord: L.grievOpen }}
                      />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
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
                          <Bot className="h-4 w-4 text-orange-500" />{beingLabelOf(pal.beingPubkey, pal.beingName)}
                        </span>
                        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{L.emVuln} {Math.round(pal.depth.vulnerability * 100)}%</span>
                          <span>{L.emEmbody} {Math.round(pal.depth.embodiment * 100)}%</span>
                          {pal.depth.swing && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0">🎢 {L.emSwing}</Badge>}
                        </span>
                      </div>
                      <div>
                        {/* POT PREDAJE EGA — nadomesti obrnjeni trak težka↔svetla */}
                        {pal.egoPath
                          ? <EgoPathBar ego={pal.egoPath} L={L.egoL} />
                          : <p className="text-[11px] text-muted-foreground">{L.egoPending}</p>}
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
