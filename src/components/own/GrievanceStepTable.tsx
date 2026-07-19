import { CheckCircle2, Circle } from "lucide-react";
import type { Grievance } from "@/hooks/useOwnGrievances";

// The four-step grievance table — one row per grievance, one column per
// milestone. Shared so the /own/matrix Matrica and a participant's own
// detail view read identically (the same being sees the same picture).
export interface GrievanceStepLabels {
  grievances: string;
  responded: string;
  accepted: string;
  apologized: string;
  owned: string;
}

export default function GrievanceStepTable({
  grievances, nameOf, labels, highlightPubkey,
}: {
  grievances: Grievance[];
  nameOf: (pk: string) => string;
  labels: GrievanceStepLabels;
  /** When set, this person's name is emphasized in every from → to pair. */
  highlightPubkey?: string;
}) {
  const me = (highlightPubkey || "").toLowerCase();
  const party = (pk: string) => (
    <span className={pk.toLowerCase() === me ? "font-semibold text-foreground" : undefined}>{nameOf(pk)}</span>
  );
  const StepCell = ({ done }: { done: boolean }) => (
    <td className="p-2 text-center">
      {done
        ? <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
        : <Circle className="h-4 w-4 text-muted-foreground/30 inline" />}
    </td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left p-2 font-medium">{labels.grievances}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.responded}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.accepted}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.apologized}</th>
            <th className="p-2 font-medium text-center whitespace-nowrap">{labels.owned}</th>
          </tr>
        </thead>
        <tbody>
          {grievances.map((g) => (
            <tr key={g.id} className="border-b border-border/40 align-top">
              <td className="p-2 min-w-[12rem]">
                <div className="font-medium">{party(g.fromPubkey)} → {party(g.toPubkey)}</div>
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
  );
}
