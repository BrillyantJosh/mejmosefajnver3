import { useMemo } from "react";
import { CheckCircle2, CircleDot, Circle } from "lucide-react";
import { silenceRollup, formatResumeDate, type PhaseState, type SilenceRollup } from "@/hooks/useOwnAssessments";
import { EMOTION_LABELS } from "@/hooks/useOwnEmotions";

// ── The condensed three-pillar cross-section (presek) of ONE participant,
//    AGGREGATED across all beings — the left-column summary on /own.
//    Pillar 1: phases (how many beings consider each requirement met),
//    Pillar 2: grievances (what still AWAITS them — worst case across beings),
//    Pillar 3: emotions (average depth of entry + the pendulum swing). ──

const TXT = {
  sl: {
    phases: "Faze", beingsSuffix: "bitij",
    reflection: "Refleksija", alignment: "Uskladitev", change: "Sprememba",
    griev: "Očitki", grievDone: "zaključeni ✓", grievNone: "ni zabeleženih",
    needResponse: "brez odgovora", needAccept: "nesprejeti", needOwn: "zablode nesprejete",
    emotions: "Čustva", depth: "globina", swing: "nihaj", noEmotions: "še ni zaznanih",
    potWalked: "Pot prehojena", potStuckDark: "zataknjen v temi", potStuckLight: "ostaja v svetlem", potOnWay: "še na poti", potOf: "bitij",
    silTitle: "Bitja čakajo v tišini",
    silBody: "Bitja so zaznala čustven izbruh, ki ruši odnose, in čakajo v tišini do {when}, preden nadaljujejo s procesom.",
    silBodyOpen: "Bitja so zaznala čustven izbruh, ki ruši odnose, in čakajo v tišini, preden nadaljujejo s procesom.",
    silStale: "Spodnja ocena je izpred tišine in se med njo ne posodablja.",
    silOfBeings: "V tišini: {n} od {total} bitij.",
  },
  en: {
    phases: "Phases", beingsSuffix: "beings",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    griev: "Grievances", grievDone: "complete ✓", grievNone: "none recorded",
    needResponse: "unanswered", needAccept: "unaccepted", needOwn: "not owned as delusion",
    emotions: "Emotions", depth: "depth", swing: "swing", noEmotions: "none detected yet",
    potWalked: "Path walked", potStuckDark: "stuck in the dark", potStuckLight: "remains in the light", potOnWay: "still on the way", potOf: "beings",
    silTitle: "The beings are waiting in silence",
    silBody: "The beings noticed an emotional outburst that damages relationships, and are waiting in silence until {when} before the process continues.",
    silBodyOpen: "The beings noticed an emotional outburst that damages relationships, and are waiting in silence before the process continues.",
    silStale: "The verdict below predates the silence and is not updated while it holds.",
    silOfBeings: "In silence: {n} of {total} beings.",
  },
};

export interface PillarAggregate {
  beings: number;
  phases: { key: "reflection" | "alignment" | "change"; met: number }[];
  griev: { anyData: boolean; unresponded: number; unaccepted: number; unowned: number; allDone: boolean };
  emotion: { count: number; avgDepth: number; avgPolarity: number | null; swing: boolean; top: string[]; walkedCount: number; pathCount: number; stuck: 'dark' | 'light' | null };
  // Never flattened to a yes/no: beings diverge, so the count is the message.
  silence: SilenceRollup;
}

// Aggregate one participant's per-being states into the cross-section.
// Grievance gaps take the WORST CASE across beings (what still awaits per any
// being's ledger); emotion depth averages; swing is true if ANY being saw it.
export function aggregatePillars(states: PhaseState[]): PillarAggregate {
  const beings = states.length;
  const phases = (["reflection", "alignment", "change"] as const).map((key) => ({
    key,
    met: states.filter((s) => (key === "reflection" ? s.reflectionComplete : key === "alignment" ? s.alignmentComplete : s.changeComplete)).length,
  }));
  let unresponded = 0, unaccepted = 0, unowned = 0, anyData = false;
  for (const s of states) {
    const g = s.grievanceSummary;
    if (!g) continue;
    anyData = true;
    unresponded = Math.max(unresponded, Math.max(0, g.received - (g.received_responded ?? g.received_accepted)));
    unaccepted = Math.max(unaccepted, Math.max(0, g.received - g.received_accepted));
    unowned = Math.max(unowned, Math.max(0, g.given - (g.given_accepted_by_me ?? 0)));
  }
  const ems = states.map((s) => s.emotionSummary).filter((e): e is NonNullable<typeof e> => !!e && Number(e.depth) > 0);
  const avgDepth = ems.length ? Math.round(ems.reduce((sum, e) => sum + (Number(e.depth) || 0), 0) / ems.length) : 0;
  const pols = ems.map((e) => (e as { polarity?: number | null }).polarity).filter((v): v is number => typeof v === 'number');
  const avgPolarity = pols.length ? Math.round(pols.reduce((sum, v) => sum + v, 0) / pols.length) : null;
  const deepest = ems.slice().sort((a, b) => (Number(b.depth) || 0) - (Number(a.depth) || 0))[0];
  const paths = ems.map((e) => e.path).filter((p): p is NonNullable<typeof p> => !!p);
  const walkedCount = paths.filter((p) => p.walked).length;
  const stuckDark = paths.filter((p) => p.stuck === 'dark').length;
  const stuckLight = paths.filter((p) => p.stuck === 'light').length;
  const stuck = walkedCount === 0 && paths.length > 0
    ? (stuckDark > paths.length / 2 ? 'dark' as const : stuckLight > paths.length / 2 ? 'light' as const : null)
    : null;
  return {
    beings,
    phases,
    griev: { anyData, unresponded, unaccepted, unowned, allDone: anyData && !unresponded && !unaccepted && !unowned },
    emotion: { count: ems.length, avgDepth, avgPolarity, swing: ems.some((e) => e.swing === true), top: (deepest?.top || []).slice(0, 3), walkedCount, pathCount: paths.length, stuck },
    silence: silenceRollup(states),
  };
}

// `showSilence={false}` when the PARENT already states the silence in full
// (OwnSelfMatrix does) — otherwise the same notice would appear twice inside
// one card. The parent then also owns the de-emphasis and the stale line.
export default function OwnPillarSummary({ states, lang, showSilence = true }: { states: PhaseState[]; lang: "sl" | "en"; showSilence?: boolean }) {
  const L = TXT[lang];
  const agg = useMemo(() => aggregatePillars(states), [states]);
  if (!agg.beings) return null;
  const silent = showSilence && agg.silence.any;
  const silWhen = agg.silence.openEnded ? null : formatResumeDate(agg.silence.resumeAt, lang);

  const PhaseRow = ({ label, met }: { label: string; met: number }) => {
    const all = met === agg.beings && agg.beings > 0;
    const some = met > 0 && !all;
    return (
      <span className="inline-flex items-center gap-1 mr-3" title={`${label}: ${met}/${agg.beings} ${L.beingsSuffix}`}>
        {all ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
          : some ? <CircleDot className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          : <Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />}
        <span className={`text-xs ${all ? "" : some ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/60"}`}>{label} {met}/{agg.beings}</span>
      </span>
    );
  };

  const gaps: string[] = [];
  if (agg.griev.unresponded) gaps.push(`${agg.griev.unresponded} ${L.needResponse}`);
  if (agg.griev.unaccepted) gaps.push(`${agg.griev.unaccepted} ${L.needAccept}`);
  if (agg.griev.unowned) gaps.push(`${agg.griev.unowned} ${L.needOwn}`);

  return (
    <div className="space-y-1.5">
      {/* Bitja čakajo — nad vsemi tremi stebri, ker med tišino ničesar ne ocenjujejo */}
      {silent && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5">
          <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">🤲 {L.silTitle}</div>
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
            {silWhen ? L.silBody.replace("{when}", silWhen) : L.silBodyOpen}
          </p>
          <p className="text-[10px] text-muted-foreground/80 mt-0.5">
            {L.silOfBeings.replace("{n}", String(agg.silence.waiting)).replace("{total}", String(agg.silence.total))}
          </p>
          {/* Stoji NAD oceno — besedilo govori o »spodnji oceni«. */}
          <p className="text-[10px] text-muted-foreground/80 italic leading-snug mt-1">{L.silStale}</p>
        </div>
      )}
      <div className={`space-y-1.5 ${silent ? "opacity-60" : ""}`}>
      {/* Steber 1 — faze, agregirano čez bitja */}
      <div className="flex flex-wrap items-center">
        <PhaseRow label={L.reflection} met={agg.phases[0].met} />
        <PhaseRow label={L.alignment} met={agg.phases[1].met} />
        <PhaseRow label={L.change} met={agg.phases[2].met} />
      </div>
      {/* Steber 2 — očitki: kaj še čaka (najslabši primer čez bitja) */}
      {agg.griev.anyData && (
        <div className="text-[11px]">
          <span className="text-muted-foreground">{L.griev}: </span>
          {agg.griev.allDone
            ? <span className="text-green-600">{L.grievDone}</span>
            : <span className="text-amber-700 dark:text-amber-400">{gaps.join(" · ")}</span>}
        </div>
      )}
      {/* Steber 3 — čustva: povprečna globina + nihaj + vrh palete */}
      {agg.emotion.count > 0 && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>{L.emotions}: <span className="font-semibold text-foreground">{L.depth} {agg.emotion.avgDepth}/100</span></span>
          <span className="relative inline-block h-1.5 w-16 rounded-full align-middle" style={{ background: "linear-gradient(90deg, rgba(239,68,68,.45), rgba(234,179,8,.35), rgba(34,197,94,.45))" }}>
            <span className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-foreground/40" style={{ left: "50%" }} />
            <span className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-foreground border border-background" style={{ left: `calc(${agg.emotion.avgPolarity ?? 50}% - 5px)` }} />
          </span>
          {agg.emotion.top.length > 0 && <span>{agg.emotion.top.map((k) => EMOTION_LABELS[k]?.[lang] || k).join(", ")}</span>}
          {agg.emotion.swing && <span>🎢 {L.swing}</span>}
          {agg.emotion.pathCount > 0 && (
            agg.emotion.walkedCount > 0
              ? <span className="text-green-600">🛤 {L.potWalked} ({agg.emotion.walkedCount}/{agg.emotion.pathCount} {L.potOf})</span>
              : agg.emotion.stuck
                ? <span className="text-amber-700 dark:text-amber-400">🛤 {agg.emotion.stuck === 'dark' ? L.potStuckDark : L.potStuckLight}</span>
                : <span>🛤 {L.potOnWay}</span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
