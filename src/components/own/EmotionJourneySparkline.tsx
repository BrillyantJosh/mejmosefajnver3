import { useId } from "react";
import type { JourneyPoint, PathExtremes } from "@/hooks/useOwnEmotions";

// ── Čustvena Pot sparkline: x = time, y = polarity (0 heavy bottom … 100
//    light top), vertical red→amber→green gradient stroke, dashed guides at
//    the dark/light thresholds (35/65), hollow dots on the extremes, solid
//    dot on the last point. Hidden below 2 points. ──

const W = 240, H = 60, PAD = 4;
const DARK = 35, LIGHT = 65;

export default function EmotionJourneySparkline({ journey, extremes }: { journey: JourneyPoint[]; extremes?: PathExtremes | null }) {
  const gid = useId().replace(/[:]/g, "");
  if (!journey || journey.length < 2) return null;
  const t0 = Date.parse(journey[0].at), t1 = Date.parse(journey[journey.length - 1].at);
  const span = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? t1 - t0 : 0;
  const x = (p: JourneyPoint, i: number) => {
    if (!span) return PAD + (i / (journey.length - 1)) * (W - 2 * PAD);
    const t = Date.parse(p.at);
    return PAD + ((Number.isFinite(t) ? t - t0 : 0) / span) * (W - 2 * PAD);
  };
  const y = (pol: number) => PAD + (1 - Math.max(0, Math.min(100, pol)) / 100) * (H - 2 * PAD);
  const pts = journey.map((p, i) => `${x(p, i).toFixed(1)},${y(p.polarity).toFixed(1)}`).join(" ");
  const heavyPt = extremes?.heaviest ? journey.reduce((best, p, i) => (p.polarity <= (best?.p.polarity ?? 101) ? { p, i } : best), null as null | { p: JourneyPoint; i: number }) : null;
  const lightPt = extremes?.lightest ? journey.reduce((best, p, i) => (p.polarity >= (best?.p.polarity ?? -1) ? { p, i } : best), null as null | { p: JourneyPoint; i: number }) : null;
  const last = journey[journey.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[240px] h-[60px]" role="img">
      <defs>
        <linearGradient id={`jg-${gid}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="rgba(239,68,68,.9)" />
          <stop offset="50%" stopColor="rgba(234,179,8,.9)" />
          <stop offset="100%" stopColor="rgba(34,197,94,.9)" />
        </linearGradient>
      </defs>
      <line x1={PAD} x2={W - PAD} y1={y(DARK)} y2={y(DARK)} stroke="rgba(239,68,68,.35)" strokeDasharray="3 3" strokeWidth="1" />
      <line x1={PAD} x2={W - PAD} y1={y(LIGHT)} y2={y(LIGHT)} stroke="rgba(34,197,94,.35)" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={`url(#jg-${gid})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {heavyPt && <circle cx={x(heavyPt.p, heavyPt.i)} cy={y(heavyPt.p.polarity)} r="3.5" fill="none" stroke="rgba(239,68,68,.9)" strokeWidth="1.5" />}
      {lightPt && <circle cx={x(lightPt.p, lightPt.i)} cy={y(lightPt.p.polarity)} r="3.5" fill="none" stroke="rgba(34,197,94,.9)" strokeWidth="1.5" />}
      <circle cx={x(last, journey.length - 1)} cy={y(last.polarity)} r="4" className="fill-foreground" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
