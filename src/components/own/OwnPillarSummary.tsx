import { useMemo } from "react";
import { CheckCircle2, CircleDot, Circle } from "lucide-react";
import type { PhaseState } from "@/hooks/useOwnAssessments";
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
  },
  en: {
    phases: "Phases", beingsSuffix: "beings",
    reflection: "Reflection", alignment: "Alignment", change: "Change",
    griev: "Grievances", grievDone: "complete ✓", grievNone: "none recorded",
    needResponse: "unanswered", needAccept: "unaccepted", needOwn: "not owned as delusion",
    emotions: "Emotions", depth: "depth", swing: "swing", noEmotions: "none detected yet",
  },
};

export interface PillarAggregate {
  beings: number;
  phases: { key: "reflection" | "alignment" | "change"; met: number }[];
  griev: { anyData: boolean; unresponded: number; unaccepted: number; unowned: number; allDone: boolean };
  emotion: { count: number; avgDepth: number; avgPolarity: number | null; swing: boolean; top: string[] };
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
  return {
    beings,
    phases,
    griev: { anyData, unresponded, unaccepted, unowned, allDone: anyData && !unresponded && !unaccepted && !unowned },
    emotion: { count: ems.length, avgDepth, avgPolarity, swing: ems.some((e) => e.swing === true), top: (deepest?.top || []).slice(0, 3) },
  };
}

export default function OwnPillarSummary({ states, lang }: { states: PhaseState[]; lang: "sl" | "en" }) {
  const L = TXT[lang];
  const agg = useMemo(() => aggregatePillars(states), [states]);
  if (!agg.beings) return null;

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
            <span className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-foreground border border-background" style={{ left: `calc(${agg.emotion.avgPolarity ?? 50}% - 5px)` }} />
          </span>
          {agg.emotion.top.length > 0 && <span>{agg.emotion.top.map((k) => EMOTION_LABELS[k]?.[lang] || k).join(", ")}</span>}
          {agg.emotion.swing && <span>🎢 {L.swing}</span>}
        </div>
      )}
    </div>
  );
}
