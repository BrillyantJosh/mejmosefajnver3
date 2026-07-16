import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Grid3x3, ChevronRight, Bot } from "lucide-react";
import { useOwnAssessments } from "@/hooks/useOwnAssessments";
import OwnPillarSummary from "@/components/own/OwnPillarSummary";
import { useNostrProfilesCacheBulk } from "@/hooks/useNostrProfilesCacheBulk";
import { getPhaseLabel, getPhaseColor } from "@/lib/ownPhase";
import { useLang } from "@/i18n/I18nContext";

const short = (pk: string) => (pk ? `${pk.slice(0, 8)}…` : "—");

const TXT = {
  sl: {
    title: "Presek udeležencev",
    intro: "Za vsakega udeleženca zbrane informacije treh stebrov (agregirano čez vsa bitja): faze, kaj še čaka pri očitkih in globina čustev. »Več« odpre podroben pogled.",
    none: "Nobeno bitje še ni objavilo ocene za ta proces.",
    more: "Več",
    noAssessment: "Še ni ocene.",
    beings: "bitij ocenjuje",
  },
  en: {
    title: "Participant cross-section",
    intro: "The condensed three-pillar read of every participant (aggregated across all beings): phases, what still awaits in grievances and emotional depth. “More” opens the detailed view.",
    none: "No being has published an assessment for this process yet.",
    more: "More",
    noAssessment: "No assessment yet.",
    beings: "being(s) assessing",
  },
};

interface Props {
  caseRoot: string | null;
  participants: string[];
  phase?: string;
  selectedParticipant?: string | null;
  onSelect: (pk: string) => void;
}

// The overseer (facilitator / guest) view: ONE condensed three-pillar card
// per participant, aggregated across beings — no per-being rows. "More"
// opens the full per-being detail (verdicts, grievances, emotions, smer).
export default function OwnFullMatrix({ caseRoot, participants, phase, selectedParticipant, onSelect }: Props) {
  const en = useLang() === "en";
  const L = en ? TXT.en : TXT.sl;
  const lang: "en" | "sl" = en ? "en" : "sl";
  const { states, entries, isLoading } = useOwnAssessments(caseRoot);

  const beings = useMemo(() => {
    const set = new Set<string>();
    states.forEach((s) => set.add(s.beingPubkey));
    entries.forEach((e) => set.add(e.beingPubkey));
    return Array.from(set);
  }, [states, entries]);

  const { profiles } = useNostrProfilesCacheBulk(useMemo(() => Array.from(new Set(participants)), [participants]));
  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.full_name || short(pk);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Grid3x3 className="h-4 w-4 text-orange-600 dark:text-orange-400" /> {L.title}
        </h3>
        {phase && <Badge variant="outline" className={`${getPhaseColor(phase)} text-[10px]`}>{getPhaseLabel(phase, lang)}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{L.intro}</p>
      {beings.length > 0 && (
        <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Bot className="h-3 w-3 text-orange-500" /> {beings.length} {L.beings}
        </p>
      )}

      {isLoading && beings.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : beings.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">{L.none}</CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {participants.map((p) => {
            const mine = states.filter((s) => s.participantPubkey === p);
            return (
              <Card key={p} className={selectedParticipant === p ? "border-orange-500/60 ring-1 ring-orange-500/30" : ""}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{nameOf(p)}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-orange-600 dark:text-orange-400 hover:text-orange-700 shrink-0" onClick={() => onSelect(p)}>
                      {L.more} <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                  {mine.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70">{L.noAssessment}</p>
                  ) : (
                    <OwnPillarSummary states={mine} lang={lang} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
