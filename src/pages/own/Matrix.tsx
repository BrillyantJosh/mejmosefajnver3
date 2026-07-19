import { useMemo, useState } from "react";
import { splitLatestPerBeing } from "@/lib/ownTimeline";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, Circle, Users, Telescope, Archive, ChevronDown } from "lucide-react";
import { useAllOwnProcesses } from "@/hooks/useAllOwnProcesses";
import { useOwnAssessments, type PhaseState } from "@/hooks/useOwnAssessments";
import { useOwnGrievances, type Grievance } from "@/hooks/useOwnGrievances";
import { useOwnGuidance, type GuidanceEntry } from "@/hooks/useOwnGuidance";
import { useOwnEmotions, HEAVY_EMOTIONS, LIGHT_EMOTIONS, EMOTION_LABELS, type EmotionPalette } from "@/hooks/useOwnEmotions";
import { useAuth } from "@/contexts/AuthContext";
import EmotionJourneySparkline from "@/components/own/EmotionJourneySparkline";
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
    timelineIntro: "Zadnje mnenje vsakega bitja o vsakem udeležencu — to, kar bitje o njem drži ZDAJ. Starejša mnenja so v arhivu spodaj.",
    archiveOpen: "Arhiv — starejša mnenja", archiveHide: "Skrij arhiv", archiveNote: "Presežena mnenja, od najnovejšega proti starejšim.",
    allParts: "Vsi udeleženci", allBeings: "Vsa bitja",
    loading: "Nalagam…", on: "o", met: "izpolnjeno", conf: "zaup",
    tabGrievances: "Očitki",
    grievIntro: "Očitki, kot jih beleži vsako bitje posebej (javno). Bitja se lahko razhajajo — vsak seznam je pogled enega bitja.",
    grievNone: "Bitja še niso zabeležila očitkov.",
    grievEmptyBeing: "Brez zabeleženih očitkov.",
    grievAccepted: "Sprejeto", grievOpen: "Odprto", grievApologized: "opravičeno",
    grievLabel: "Očitki", grievAcceptedWord: "sprejeti",
    rollupOf: "od", rollupAccepted: "sprejetih",
    tlGriev: "očitki", tlReceived: "prejeti", tlGiven: "dani", tlDirection: "Smer",
    gvMatrix: "Matrica", gvMine: "Zame",
    gvLegend: "Vsak očitek gre skozi štiri korake: prejemnik nanj odgovori in ga brezpogojno sprejme (z opravičilom, če se le da), dajalec pa ga sprejme kot del svoje zablode.",
    colResponded: "Odgovorjen", colAccepted: "Sprejet", colApologized: "Opravičen", colOwned: "Zabloda sprejeta",
    gvForPerson: "Pogled za", gvMyReceived: "Name naslovljeni", gvMyReceivedDesc: "odgovori nanje in jih brezpogojno sprejmi",
    gvMyGiven: "Moji dani očitki", gvMyGivenDesc: "sprejmi jih kot del svoje zablode in se zaveži, da ne bodo več nastajali",
    gvNeedsResponse: "čaka odgovor", gvNeedsAccept: "čaka sprejetje", gvNeedsApology: "opravičilo manjka", gvNeedsOwn: "sprejmi kot svojo zablodo",
    gvDone: "zaključeno", gvNoneForPerson: "Za to osebo ni zabeleženih očitkov.", gvFrom: "od", gvTo: "za",
    rollupResponded: "odgovorjeni", rollupOwned: "zablode",
    gvCompare: "Primerjava",
    gvStepExpl: [
      ["Odgovorjen", "prejemnik se je na očitek kakorkoli odzval — tudi obramba ali jeza šteje kot odgovor (refleksija je zaključena šele, ko je odgovorjeno na vse prejete)."],
      ["Sprejet", "prejemnik ga je brezpogojno sprejel — razumel, slišal, brez »ampak«."],
      ["Opravičen", "prejemnik se je zanj pristno opravičil (kjer se le da)."],
      ["Zabloda sprejeta", "dajalec je očitek vzel nase kot del svoje lastne zablode/projekcije (uskladitev je zaključena šele, ko so sprejeti vsi prejeti IN vsi dani vzeti nase)."],
    ] as [string, string][],
    gvCompIntro: "Isti proces skozi oči vsakega bitja: vrstica = kdo komu očita, stolpec = bitje. Vsako bitje bere ISTI pogovor, a ga destilira samostojno — manjše razlike so normalne, velike (⚠) pomenijo, da bitja dogajanje berejo različno.",
    gvCompCount: "očitkov", gvCompMissing: "ta par pri tem bitju ni zabeležen", gvCompMissingShort: "pri kakem bitju manjka", gvCompNone: "—",
    gvCompCountDiff: "razlika v številu zapisov", gvCompStepDiff: "bitja se o tem koraku ne strinjajo",
    gvCompAgree: "Ujemanje mejnikov med bitji", gvCompAgreeDesc: "delež korakov (na parih, ki jih beleži več bitij), kjer so vsa bitja enakega mnenja",
    gvCompNeedTwo: "Primerjava potrebuje vsaj dve bitji z evidenco za ta proces.",
    gvStepShort: ["odg", "spr", "opr", "zab"],
    tabEmotions: "Čustva",
    emIntro: "Steber 3 — čustvena ocena: koliko si je udeleženec DOVOLIL čustvovati. Vsako bitje vodi svojo paleto (javno, abstraktno) — spodaj je naštetih vseh 26 čustev; obarvana so tista, ki jih je bitje zaznalo.",
    emLegend: "Globina vstopa (0–100, številka) meri pogum čutenja: intenzivnost + ranljivost + utelešenost + širina palete. KAZALEC na traku kaže RAVEN ZAVESTI po Hawkinsu (20–600): vsako čustvo nosi svojo raven (sram 20 · krivda 30 · nemoč 50 · žalost 75 · strah 100 · jeza 150 · ponos 175 · ⬥ POGUM 200 = sredina traku ⬥ · olajšanje 250 · upanje 310 · sočutje/toplina 500 · hvaležnost 510 · veselje 540 · mir 600), utežena s trenutnimi valovi IN načinom izraza (utelešeno > govorjeno-o > zadržano). Levo od sredine = sila/odpor (tudi ponos!), desno = moč in samoodgovornost. Nihalo: jeza JE napredek glede na nemoč — Pot gre stopničko za stopničko; 🎢 nihaj, ko se svetlo prvič pojavi PO vrhu težkega.",
    emHeavy: "Težka", emLight: "Svetla", emDepth: "Globina vstopa", emSwing: "nihaj",
    emModeExpressed: "iz čustva", emModeNamed: "o čustvu", emModeHeld: "zadržano",
    emNone: "Bitja še niso zaznala čustev.", emNoneBeing: "To bitje še ni zaznalo čustev pri tej osebi.",
    emByBeing: "Globina po bitjih", emVuln: "ranljivost", emEmbody: "utelešenost", emPeak: "vrh",
    potTitle: "Pot", potWalked: "Pot prehojena ✓", potStuckDark: "zataknjen v temi", potStuckLight: "ostaja v svetlem", potOnWay: "še na poti",
    emLevel: "raven", emCourage: "prag poguma (200) — levo sila/odpor, desno moč/samoodgovornost",
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
    timelineIntro: "Each being's LATEST opinion on each participant — what it holds about them NOW. Older opinions live in the archive below.",
    archiveOpen: "Archive — older opinions", archiveHide: "Hide archive", archiveNote: "Superseded opinions, newest first.",
    allParts: "All participants", allBeings: "All beings",
    loading: "Loading…", on: "on", met: "met", conf: "conf",
    tabGrievances: "Grievances",
    grievIntro: "Grievances as each being records them separately (public). Beings may diverge — every list is one being's view.",
    grievNone: "The beings have not recorded any grievances yet.",
    grievEmptyBeing: "No grievances recorded.",
    grievAccepted: "Accepted", grievOpen: "Open", grievApologized: "apologized",
    grievLabel: "Grievances", grievAcceptedWord: "accepted",
    rollupOf: "of", rollupAccepted: "accepted",
    tlGriev: "grievances", tlReceived: "received", tlGiven: "given", tlDirection: "Direction",
    gvMatrix: "Matrix", gvMine: "For me",
    gvLegend: "Every grievance passes four steps: the receiver responds to it and unconditionally accepts it (apologizing where possible), and the giver accepts it as part of their own delusion.",
    colResponded: "Responded", colAccepted: "Accepted", colApologized: "Apologized", colOwned: "Owned as delusion",
    gvForPerson: "Viewing for", gvMyReceived: "Addressed to me", gvMyReceivedDesc: "respond to them and accept them unconditionally",
    gvMyGiven: "Grievances I gave", gvMyGivenDesc: "accept them as part of your own delusion and commit so they stop arising",
    gvNeedsResponse: "awaiting response", gvNeedsAccept: "awaiting acceptance", gvNeedsApology: "apology missing", gvNeedsOwn: "own it as your delusion",
    gvDone: "complete", gvNoneForPerson: "No grievances recorded for this person.", gvFrom: "from", gvTo: "to",
    rollupResponded: "responded", rollupOwned: "owned",
    gvCompare: "Comparison",
    gvStepExpl: [
      ["Responded", "the receiver reacted to the grievance in ANY way — defense or anger counts too (reflection completes only once every received grievance got a response)."],
      ["Accepted", "the receiver unconditionally accepted it — understood, heard, no \"but\"."],
      ["Apologized", "the receiver genuinely apologized for it (where possible)."],
      ["Owned as delusion", "the giver took the grievance back as part of their OWN delusion/projection (alignment completes only once all received are accepted AND all given are owned)."],
    ] as [string, string][],
    gvCompIntro: "The same process through each being's eyes: row = who reproaches whom, column = being. Every being reads the SAME conversation but distills it independently — small differences are normal; large ones (⚠) mean the beings read the events differently.",
    gvCompCount: "grievance(s)", gvCompMissing: "this pair is not recorded by this being", gvCompMissingShort: "missing for some being", gvCompNone: "—",
    gvCompCountDiff: "entry-count differs", gvCompStepDiff: "beings disagree on this step",
    gvCompAgree: "Milestone agreement between beings", gvCompAgreeDesc: "share of steps (on pairs recorded by more than one being) where all beings hold the same view",
    gvCompNeedTwo: "Comparison needs at least two beings with a ledger for this process.",
    gvStepShort: ["resp", "acc", "apo", "own"],
    tabEmotions: "Emotions",
    emIntro: "Pillar 3 — the emotional read: how much the participant ALLOWED themselves to feel. Each being keeps its own palette (public, abstract) — all 26 emotions are listed below; the colored ones were detected by the being.",
    emLegend: "Depth of entry (0–100, the number) measures the courage of feeling: intensity + vulnerability + embodiment + breadth. The MARKER shows the Hawkins CONSCIOUSNESS LEVEL (20–600): every emotion carries its level (shame 20 · guilt 30 · helplessness 50 · sadness 75 · fear 100 · anger 150 · pride 175 · ⬥ COURAGE 200 = the bar midpoint ⬥ · relief 250 · hope 310 · compassion/warmth 500 · gratitude 510 · joy 540 · peace 600), weighted by the current waves AND the expression mode (embodied > talked-about > held). Left of the midpoint = force/resistance (pride included!), right = power and self-responsibility. Anger IS progress from helplessness — the path climbs step by step; 🎢 swing when a light emotion first appears AFTER a heavy peak.",
    emHeavy: "Heavy", emLight: "Light", emDepth: "Depth of entry", emSwing: "swing",
    emModeExpressed: "from the feeling", emModeNamed: "about the feeling", emModeHeld: "held back",
    emNone: "The beings have not detected any emotions yet.", emNoneBeing: "This being has not detected emotions for this person yet.",
    emByBeing: "Depth per being", emVuln: "vulnerability", emEmbody: "embodiment", emPeak: "peak",
    potTitle: "Path", potWalked: "Path walked ✓", potStuckDark: "stuck in the dark", potStuckLight: "remains in the light", potOnWay: "still on the way",
    emLevel: "level", emCourage: "courage threshold (200) — left force/resistance, right power/self-responsibility",
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
  const { ledgers, isLoading: loadingGriev } = useOwnGrievances(selectedCaseRoot);
  const { entries: guidance } = useOwnGuidance(selectedCaseRoot);
  const { palettes: emotionPalettes, isLoading: loadingEmotions } = useOwnEmotions(selectedCaseRoot);

  // Steber 2 nesting: guidance (87048) under the exact assessment (87047) it
  // was based on — join on based_on_state_id; fallback = the nearest OLDER
  // assessment of the same being+participant.
  const guidanceByAssessment = useMemo(() => {
    const m = new Map<string, GuidanceEntry[]>();
    const byId = new Map(entries.map((e) => [e.id, e]));
    const lower = (v: string) => String(v || "").toLowerCase();
    for (const g of guidance) {
      let target = g.basedOnStateId ? byId.get(g.basedOnStateId) || null : null;
      if (!target) {
        for (const e of entries) {
          if (lower(e.beingPubkey) !== g.beingPubkey || lower(e.participantPubkey) !== g.participantPubkey) continue;
          if (e.created_at > g.created_at) continue;
          if (!target || e.created_at > target.created_at) target = e;
        }
      }
      if (!target) continue;
      if (!m.has(target.id)) m.set(target.id, []);
      m.get(target.id)!.push(g);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.created_at - b.created_at);
    return m;
  }, [guidance, entries]);

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

  // Include grievance from/to pubkeys so their names resolve in the tab too.
  const grievPubkeys = useMemo(() => {
    const set = new Set<string>();
    ledgers.forEach((l) => {
      set.add(l.beingPubkey);
      l.grievances.forEach((g) => { set.add(g.fromPubkey); set.add(g.toPubkey); });
      Object.keys(l.participants).forEach((pk) => set.add(pk));
    });
    return Array.from(set);
  }, [ledgers]);
  // Emotion palettes may come from beings that never published an 87047 in
  // this case (e.g. orro/soulstice on a sister process) — without their
  // pubkeys in the profile fetch the Čustva tab shows raw hashes.
  const emotionBeingPubkeys = useMemo(
    () => Array.from(new Set(emotionPalettes.map((pal) => pal.beingPubkey))),
    [emotionPalettes],
  );
  const allPubkeys = useMemo(
    () => Array.from(new Set([...participants, ...beings, ...grievPubkeys, ...emotionBeingPubkeys])),
    [participants, beings, grievPubkeys, emotionBeingPubkeys],
  );
  const { profiles } = useNostrProfilesCacheBulk(allPubkeys);
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || short(pk);
  };
  // For palette headers: KIND 0 name when resolved, else the body's own
  // being_name, else the short hash.
  const beingLabelOf = (pk: string, bodyName?: string) => {
    const n = nameOf(pk);
    return n === short(pk) && bodyName ? bodyName : n;
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

  // ── Matrica Očitkov state ──
  const { session } = useAuth();
  const myPubkey = (session?.nostrHexId || "").toLowerCase();
  const [grievView, setGrievView] = useState<"matrix" | "mine" | "compare">("matrix");
  // »Zame« defaults to the logged-in user when they are in the process; the
  // overseer picks any participant from the same select.
  const [grievPerson, setGrievPerson] = useState<string>("");
  const grievPersonEffective = grievPerson
    || (participants.includes(myPubkey) ? myPubkey : (participants[0] || ""));

  // ── Primerjava: align every being's ledger by directed pair (from→to).
  //    Each being distills the SAME transcript independently — this view makes
  //    the divergence visible: entry-count spread, missing pairs, and steps
  //    where the beings' "fully done for this pair" verdicts disagree. ──
  const grievCompare = useMemo(() => {
    if (ledgers.length < 2) return null;
    const STEPS = ["resp", "acc", "apo", "own"] as const;
    const done = (g: Grievance) => ({ resp: g.respondedByTarget, acc: g.status === "accepted", apo: g.apologyNoted, own: g.acceptedByGiver });
    const pairKeys = new Set<string>();
    for (const l of ledgers) for (const g of l.grievances) pairKeys.add(`${g.fromPubkey}|${g.toPubkey}`);
    let agree = 0, total = 0;
    const rows = [...pairKeys].sort().map((key) => {
      const [from, to] = key.split("|");
      const cells = ledgers.map((l) => {
        const gs = l.grievances.filter((g) => g.fromPubkey === from && g.toPubkey === to);
        const counts: Record<(typeof STEPS)[number], number> = { resp: 0, acc: 0, apo: 0, own: 0 };
        for (const g of gs) { const d = done(g); for (const s of STEPS) if (d[s]) counts[s]++; }
        return { being: l.beingPubkey, n: gs.length, counts };
      });
      const present = cells.filter((c) => c.n > 0);
      const ns = present.map((c) => c.n);
      const countDiff = present.length >= 2 && Math.max(...ns) - Math.min(...ns) > 1;
      const missing = cells.some((c) => c.n === 0) && present.length > 0;
      // per-step: does every recording being reach the same "all entries done" verdict?
      const stepDisagree: Record<string, boolean> = {};
      for (const s of STEPS) {
        const verdicts = present.map((c) => c.counts[s] === c.n);
        if (verdicts.length >= 2) {
          total++;
          if (verdicts.every((v) => v === verdicts[0])) agree++;
          else stepDisagree[s] = true;
        }
      }
      return { from, to, cells, countDiff, missing, stepDisagree };
    });
    return { rows, agreePct: total ? Math.round((100 * agree) / total) : null };
  }, [ledgers]);
  const timeline = useMemo(
    () => entries
      .filter((e) => (timelineParticipant === "all" || e.participantPubkey === timelineParticipant)
        && (timelineBeing === "all" || e.beingPubkey === timelineBeing))
      .sort((a, b) => b.created_at - a.created_at),
    [entries, timelineParticipant, timelineBeing],
  );
  // Focus on what each being holds NOW; superseded opinions go to the archive.
  const { current: timelineCurrent, archive: timelineArchive } = useMemo(() => splitLatestPerBeing(timeline), [timeline]);
  const [showArchive, setShowArchive] = useState(false);

  // One opinion card — reused by the current list and the archive.
  const renderTimelineEntry = (e: (typeof timeline)[number]) => (
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
      {e.grievanceSummary && (
        <div className="text-[11px] text-muted-foreground mt-2">
          {L.tlGriev}: {L.tlReceived} {e.grievanceSummary.received_accepted}/{e.grievanceSummary.received} {L.grievAcceptedWord} · {L.tlGiven} {e.grievanceSummary.given}
        </div>
      )}
      {/* ↳ Smer (Steber 2): guidance nested under this exact assessment */}
      {(guidanceByAssessment.get(e.id) || []).map((g) => (
        <div key={g.id} className="mt-2 ml-4 rounded-md border border-orange-500/25 bg-orange-500/[0.03] p-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold">↳ {L.tlDirection} · {nameOf(g.beingPubkey)}{g.direction ? <span className="font-normal text-muted-foreground"> · {g.direction}</span> : null}</span>
            <span className="text-[10px] text-muted-foreground">{new Date(g.created_at * 1000).toLocaleString()}</span>
          </div>
          {g.guidance && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{g.guidance}</p>}
          {g.nextStep && <p className="text-xs mt-1">→ {g.nextStep}</p>}
        </div>
      ))}
    </div>
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
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="matrix">{L.tabMatrix}</TabsTrigger>
          <TabsTrigger value="timeline">{L.tabTimeline}</TabsTrigger>
          <TabsTrigger value="grievances">{L.tabGrievances}</TabsTrigger>
          <TabsTrigger value="emotions">{L.tabEmotions}</TabsTrigger>
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
                            {st.grievanceSummary && (
                              <div className="text-[10px] text-muted-foreground mt-1.5">{L.grievLabel}: {st.grievanceSummary.received_accepted}/{st.grievanceSummary.received} {L.grievAcceptedWord}</div>
                            )}
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
              {timelineCurrent.map(renderTimelineEntry)}
              {timelineArchive.length > 0 && (
                <div className="space-y-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowArchive((v) => !v)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-orange-500/40 transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    {showArchive ? L.archiveHide : `${L.archiveOpen} (${timelineArchive.length})`}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showArchive ? "rotate-180" : ""}`} />
                  </button>
                  {showArchive && (
                    <>
                      <p className="text-[11px] text-muted-foreground">{L.archiveNote}</p>
                      <div className="space-y-3 opacity-75">{timelineArchive.map(renderTimelineEntry)}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── GRIEVANCES — Matrica Očitkov ── */}
        <TabsContent value="grievances" className="space-y-4">
          <p className="text-xs text-muted-foreground">{L.grievIntro}</p>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div>{L.gvLegend}</div>
            {L.gvStepExpl.map(([name, desc]) => (
              <div key={name} className="pl-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline mr-1 align-[-2px]" /><strong className="text-foreground">{name}</strong> — {desc}</div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={grievView === "matrix" ? "default" : "outline"} onClick={() => setGrievView("matrix")}>{L.gvMatrix}</Button>
            <Button size="sm" variant={grievView === "compare" ? "default" : "outline"} onClick={() => setGrievView("compare")}>{L.gvCompare}</Button>
            <Button size="sm" variant={grievView === "mine" ? "default" : "outline"} onClick={() => setGrievView("mine")}>{L.gvMine}</Button>
            {grievView === "mine" && (
              <>
                <span className="text-xs text-muted-foreground ml-1">{L.gvForPerson}</span>
                <Select value={grievPersonEffective} onValueChange={setGrievPerson}>
                  <SelectTrigger className="w-auto min-w-[10rem] h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {participants.map((p) => <SelectItem key={p} value={p}>{nameOf(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          {ledgers.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingGriev ? L.loading : L.grievNone}</CardContent></Card>
          ) : grievView === "compare" ? (
            /* ── PRIMERJAVA: isti proces skozi oči vsakega bitja ── */
            !grievCompare ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">{L.gvCompNeedTwo}</CardContent></Card>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{L.gvCompIntro}</p>
                {grievCompare.agreePct != null && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{L.gvCompAgree}:</span>
                    <span className={`font-bold ${grievCompare.agreePct >= 75 ? "text-green-600" : grievCompare.agreePct >= 50 ? "text-amber-600" : "text-red-600"}`}>{grievCompare.agreePct}%</span>
                    <span className="text-xs text-muted-foreground">({L.gvCompAgreeDesc})</span>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="text-left p-2 font-medium">{L.grievLabel}</th>
                        {ledgers.map((l) => (
                          <th key={l.beingPubkey} className="text-left p-2 font-medium whitespace-nowrap">
                            <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-orange-500" />{nameOf(l.beingPubkey)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grievCompare.rows.map((row) => (
                        <tr key={`${row.from}|${row.to}`} className="border-b border-border/40 align-top">
                          <td className="p-2 min-w-[10rem]">
                            <div className="font-medium">{nameOf(row.from)} → {nameOf(row.to)}</div>
                            <div className="mt-0.5 space-x-2">
                              {row.missing && <span className="text-[10px] text-amber-600">⚠ {L.gvCompMissingShort}</span>}
                              {row.countDiff && <span className="text-[10px] text-amber-600">⚠ {L.gvCompCountDiff}</span>}
                              {Object.keys(row.stepDisagree).length > 0 && <span className="text-[10px] text-amber-600">⚠ {L.gvCompStepDiff}</span>}
                            </div>
                          </td>
                          {row.cells.map((c) => (
                            <td key={c.being} className="p-2 whitespace-nowrap">
                              {c.n === 0 ? (
                                <span className="text-amber-600/80" title={L.gvCompMissing}>{L.gvCompNone}</span>
                              ) : (
                                <div>
                                  <div className="font-medium">{c.n} {L.gvCompCount}</div>
                                  <div className="text-muted-foreground mt-0.5 space-x-1.5">
                                    {(["resp", "acc", "apo", "own"] as const).map((s, i) => (
                                      <span key={s} className={row.stepDisagree[s] ? "text-amber-600 font-semibold" : c.counts[s] === c.n ? "text-green-600" : undefined}>
                                        {L.gvStepShort[i]} {c.counts[s]}/{c.n}
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
              </div>
            )
          ) : (
            <div className="space-y-3">
              {ledgers.map((l) => {
                const StepCell = ({ done }: { done: boolean }) => (
                  <td className="p-2 text-center">
                    {done
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
                      : <Circle className="h-4 w-4 text-muted-foreground/30 inline" />}
                  </td>
                );
                const NextStep = ({ g, side }: { g: Grievance; side: "received" | "given" }) => {
                  let label: string; let done = false;
                  if (side === "given") {
                    done = g.acceptedByGiver;
                    label = done ? L.gvDone : L.gvNeedsOwn;
                  } else if (!g.respondedByTarget) label = L.gvNeedsResponse;
                  else if (g.status !== "accepted") label = L.gvNeedsAccept;
                  else if (!g.apologyNoted) label = L.gvNeedsApology;
                  else { done = true; label = L.gvDone; }
                  return (
                    <Badge variant="outline" className={done
                      ? "bg-green-500/10 text-green-600 border-green-500/30 text-[10px] py-0 shrink-0"
                      : "bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0 shrink-0"}>
                      {label}
                    </Badge>
                  );
                };
                const mineReceived = l.grievances.filter((g) => g.toPubkey === grievPersonEffective);
                const mineGiven = l.grievances.filter((g) => g.fromPubkey === grievPersonEffective);
                return (
                  <Card key={l.beingPubkey} className="border-orange-500/25 bg-orange-500/[0.04]">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                          <Bot className="h-4 w-4 text-orange-500" />{nameOf(l.beingPubkey)}
                        </span>
                        {l.processPhase && (
                          <Badge variant="outline" className={getPhaseColor(l.processPhase)}>{getPhaseLabel(l.processPhase, lang)}</Badge>
                        )}
                      </div>

                      {grievView === "matrix" ? (
                        l.grievances.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{L.grievEmptyBeing}</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  <th className="text-left p-2 font-medium">{L.grievLabel}</th>
                                  <th className="p-2 font-medium text-center whitespace-nowrap">{L.colResponded}</th>
                                  <th className="p-2 font-medium text-center whitespace-nowrap">{L.colAccepted}</th>
                                  <th className="p-2 font-medium text-center whitespace-nowrap">{L.colApologized}</th>
                                  <th className="p-2 font-medium text-center whitespace-nowrap">{L.colOwned}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {l.grievances.map((g) => (
                                  <tr key={g.id} className="border-b border-border/40 align-top">
                                    <td className="p-2 min-w-[12rem]">
                                      <div className="font-medium">{nameOf(g.fromPubkey)} → {nameOf(g.toPubkey)}</div>
                                      {g.summary && <div className="text-muted-foreground leading-snug mt-0.5">{g.summary}</div>}
                                    </td>
                                    <StepCell done={g.respondedByTarget} />
                                    <StepCell done={g.status === "accepted"} />
                                    <StepCell done={g.apologyNoted} />
                                    <StepCell done={g.acceptedByGiver} />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      ) : (
                        /* »Zame« — kaj mora izbrana oseba še odgovoriti / sprejeti / vzeti nase */
                        mineReceived.length === 0 && mineGiven.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{L.gvNoneForPerson}</p>
                        ) : (
                          <div className="space-y-3">
                            {mineReceived.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold">{L.gvMyReceived}</div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">{L.gvMyReceivedDesc}</div>
                                <div className="space-y-1.5">
                                  {mineReceived.map((g) => (
                                    <div key={g.id} className="rounded-md bg-background/60 border border-border/50 p-2.5 flex items-start justify-between gap-2">
                                      <div className="text-xs">
                                        <span className="font-medium">{L.gvFrom} {nameOf(g.fromPubkey)}:</span>{" "}
                                        <span className="text-muted-foreground">{g.summary}</span>
                                      </div>
                                      <NextStep g={g} side="received" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {mineGiven.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold">{L.gvMyGiven}</div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">{L.gvMyGivenDesc}</div>
                                <div className="space-y-1.5">
                                  {mineGiven.map((g) => (
                                    <div key={g.id} className="rounded-md bg-background/60 border border-border/50 p-2.5 flex items-start justify-between gap-2">
                                      <div className="text-xs">
                                        <span className="font-medium">{L.gvTo} {nameOf(g.toPubkey)}:</span>{" "}
                                        <span className="text-muted-foreground">{g.summary}</span>
                                      </div>
                                      <NextStep g={g} side="given" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      )}

                      {Object.keys(l.participants).length > 0 && (
                        <div className="text-[11px] text-muted-foreground space-y-0.5 border-t border-border/50 pt-2">
                          {Object.entries(l.participants).map(([pk, r]) => (
                            <div key={pk}>
                              {nameOf(pk)}: {L.rollupResponded} {r.received_responded}/{r.received} · {L.rollupAccepted} {r.received_accepted} {L.rollupOf} {r.received} · {L.rollupOwned} {r.given_accepted_by_me}/{r.given}
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
        </TabsContent>

        {/* ── EMOTIONS — Steber 3: koliko si je udeleženec dovolil čutiti ── */}
        <TabsContent value="emotions" className="space-y-4">
          <p className="text-xs text-muted-foreground">{L.emIntro}</p>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{L.emLegend}</div>
          {emotionPalettes.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">{loadingEmotions ? L.loading : L.emNone}</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {participants.filter((p) => emotionPalettes.some((pal) => pal.participantPubkey === p)).map((p) => {
                const mine = emotionPalettes.filter((pal) => pal.participantPubkey === p);
                const label = (key: string) => (EMOTION_LABELS[key] ? EMOTION_LABELS[key][lang] : key);
                const modeIcon = (m: string) => (m === "expressed" ? "🔥" : m === "held" ? "🤐" : "💬");
                const modeLabel = (m: string) => (m === "expressed" ? L.emModeExpressed : m === "held" ? L.emModeHeld : L.emModeNamed);
                return (
                  <Card key={p}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm md:text-base flex items-center justify-between flex-wrap gap-2">
                        <span>{nameOf(p)}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {L.emByBeing}: {mine.map((pal) => `${beingLabelOf(pal.beingPubkey, pal.beingName)} ${pal.depth.score}`).join(" · ")}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {mine.map((pal) => {
                        const byKey = new Map(pal.emotions.map((e) => [e.key, e]));
                        const Chip = ({ k, heavy }: { k: string; heavy: boolean }) => {
                          const hit = byKey.get(k);
                          if (!hit) return (
                            <span className="inline-flex items-center rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground/40">{label(k)}</span>
                          );
                          const alpha = 0.15 + 0.55 * hit.peakIntensity;
                          const cls = heavy
                            ? "border-red-500/50 text-red-700 dark:text-red-400"
                            : "border-green-500/50 text-green-700 dark:text-green-400";
                          return (
                            <span
                              title={`${label(k)} · ${L.emPeak} ${hit.peakIntensity.toFixed(2)} · ${modeLabel(hit.mode)}${hit.evidence ? ` — ${hit.evidence}` : ""}`}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
                              style={{ backgroundColor: heavy ? `rgba(239,68,68,${alpha * 0.25})` : `rgba(34,197,94,${alpha * 0.25})` }}
                            >
                              {modeIcon(hit.mode)} {label(k)} <span className="opacity-70">{Math.round(hit.peakIntensity * 100)}</span>
                            </span>
                          );
                        };
                        return (
                          <div key={pal.beingPubkey} className="rounded-lg border border-orange-500/25 bg-orange-500/[0.04] p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-sm font-semibold inline-flex items-center gap-1.5">
                                <Bot className="h-4 w-4 text-orange-500" />{beingLabelOf(pal.beingPubkey, pal.beingName)}
                              </span>
                              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{L.emVuln} {Math.round(pal.depth.vulnerability * 100)}%</span>
                                <span>{L.emEmbody} {Math.round(pal.depth.embodiment * 100)}%</span>
                                {pal.depth.swing && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0">🎢 {L.emSwing}</Badge>}
                              </span>
                            </div>
                            {/* Globina vstopa: dvopolni trak težka ↔ svetla */}
                            <div>
                              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                                <span>{L.emHeavy}</span>
                                <span className="font-semibold normal-case text-foreground">{L.emDepth}: {pal.depth.score}/100{pal.depth.level != null ? <span className="font-normal text-muted-foreground"> · {L.emLevel} {pal.depth.level}</span> : null}</span>
                                <span>{L.emLight}</span>
                              </div>
                              <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(239,68,68,.45), rgba(234,179,8,.35), rgba(34,197,94,.45))" }}>
                                {/* prag poguma (Hawkins 200) = točno sredina traku */}
                                <div title={L.emCourage} className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-foreground/40" style={{ left: "50%" }} />
                                {/* kazalec = POLARNOST (kje na nihalu so ZDAJ), ne globina; bleda markerja = max izlet v vsako stran */}
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
                            {pal.emotions.length === 0 ? (
                              <p className="text-xs text-muted-foreground">{L.emNoneBeing}</p>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap gap-1">{HEAVY_EMOTIONS.map((k) => <Chip key={k} k={k} heavy />)}</div>
                                <div className="flex flex-wrap gap-1">{LIGHT_EMOTIONS.map((k) => <Chip key={k} k={k} heavy={false} />)}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
