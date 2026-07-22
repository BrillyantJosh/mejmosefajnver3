import type { EgoPath, EgoStation } from "@/hooks/useOwnEmotions";

// POT PREDAJE EGA — replaces the heavy↔light bar, which inverted the truth:
// it scored the Hawkins level of the tone a person BROADCASTS, so someone
// radiating warmth while accepting nothing came out "lightest" and the two
// doing the real work sat "heaviest". To surrender the ego you must go INTO
// shame and guilt — into humility, where the ego gives way. Only past that
// gate is standing-in-oneself, and then a lightness whose hardness has
// dissolved, real. Lightness LEFT of the gate is the ego's surface.

const STATIONS: EgoStation[] = ["ego", "razpoka", "poniznost", "v-sebi", "lahkotnost"];
const GATE_INDEX = 2; // ponižnost — the passage

export interface EgoPathStrings {
  title: string;
  st: Record<EgoStation, string>;
  gate: string;
  readBright: string;    // {y}/{c}
  readEarned: string;
  readPassage: string;
  readCracking: string;
  readUntouched: string;
  readStanding: string;
  legend: string;
}

export default function EgoPathBar({ ego, L }: { ego: EgoPath; L: EgoPathStrings }) {
  const idx = STATIONS.indexOf(ego.station);
  const y = ego.yielded;
  const c = ego.chances;
  const fill = (t: string) => t.replace("{y}", String(y)).replace("{c}", String(c));

  const reading =
    ego.station === "lahkotnost" ? { text: fill(L.readEarned), tone: "earned" as const }
    : ego.station === "v-sebi" ? { text: fill(L.readStanding), tone: "earned" as const }
    : ego.station === "poniznost" ? { text: fill(L.readPassage), tone: "passage" as const }
    : ego.brightButUnyielded ? { text: fill(L.readBright), tone: "warn" as const }
    : ego.station === "razpoka" ? { text: fill(L.readCracking), tone: "neutral" as const }
    : { text: fill(L.readUntouched), tone: "neutral" as const };

  const toneClass =
    reading.tone === "earned" ? "text-emerald-600 dark:text-emerald-400"
    : reading.tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : reading.tone === "passage" ? "text-sky-600 dark:text-sky-400"
    : "text-muted-foreground";

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{L.title}</div>

      <div className="relative px-1">
        {/* the road: muted before the gate, alive after it */}
        <div className="absolute left-1 right-1 top-[7px] h-[2px] bg-border" />
        <div
          className="absolute top-[7px] h-[2px] bg-emerald-500/45"
          style={{ left: `${(GATE_INDEX / (STATIONS.length - 1)) * 100}%`, right: "4px" }}
        />

        <div className="relative flex items-start justify-between">
          {STATIONS.map((st, i) => {
            const reached = i <= idx;
            const isHere = i === idx;
            const isGate = i === GATE_INDEX;
            const earnedSide = i > GATE_INDEX;

            const dot = isGate
              ? // the gate itself — a diamond you must pass through
                `h-4 w-4 rotate-45 rounded-[3px] border-2 ${
                  reached ? "bg-sky-500 border-sky-500" : "bg-background border-sky-500/50"
                }`
              : `h-3.5 w-3.5 rounded-full border-2 ${
                  reached
                    ? earnedSide
                      ? "bg-emerald-500 border-emerald-500"
                      : "bg-amber-500 border-amber-500"
                    : "bg-background border-border"
                }`;

            return (
              <div key={st} className="flex flex-col items-center gap-1" style={{ width: `${100 / STATIONS.length}%` }}>
                <div className="h-4 flex items-center justify-center">
                  <div
                    className={`${dot} ${isHere ? "ring-2 ring-offset-2 ring-offset-background ring-foreground/40 shadow" : ""}`}
                    title={L.st[st]}
                  />
                </div>
                <span
                  className={`text-[9px] leading-tight text-center ${
                    isHere ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {L.st[st]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className={`mt-2 text-[11px] leading-snug ${toneClass}`}>
        {reading.tone === "warn" ? "⚠ " : reading.tone === "earned" ? "✓ " : ""}
        {reading.text}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">{L.gate}</p>
    </div>
  );
}
