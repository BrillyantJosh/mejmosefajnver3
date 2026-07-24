import { CheckCircle2 } from "lucide-react";
import type { Grievance } from "@/hooks/useOwnGrievances";

// The four-step grievance table — one row per grievance, one column per
// milestone. Shared so the /own/matrix Matrica and a participant's own
// detail view read identically (the same being sees the same picture).
//
// COLOUR BY PARTICIPANT (Brilly, 2026-07-24): without it the icons were an
// undifferentiated wall and nobody could tell whose step was still open. Each
// person gets one stable colour. The KEY move: every step belongs to ONE
// person — respond / accept / apologize are the RECEIVER's work, owning the
// delusion is the GIVER's — so an OPEN step is drawn in the colour of the
// person who still has to do it. Done stays a neutral green check ("done is
// done"), so a coloured mark always means "this person still owes this".
export interface GrievanceStepLabels {
  grievances: string;
  responded: string;
  accepted: string;
  apologized: string;
  owned: string;
  /** One-line explanation of the colour scheme, shown above the table. */
  colorHint?: string;
  /** "opravljeno" — used only in the accessible title of a done cell. */
  doneWord?: string;
  /** "še ne" — used only in the accessible title of an open cell. */
  openWord?: string;
}

// Full static class strings (Tailwind cannot see interpolated names). Six
// hues, all clearly distinct from the green "done" check and from each other.
const PALETTE = [
  { name: "text-sky-600 dark:text-sky-400", ring: "border-sky-500", fill: "bg-sky-500/15", dot: "bg-sky-500" },
  { name: "text-violet-600 dark:text-violet-400", ring: "border-violet-500", fill: "bg-violet-500/15", dot: "bg-violet-500" },
  { name: "text-amber-600 dark:text-amber-400", ring: "border-amber-500", fill: "bg-amber-500/15", dot: "bg-amber-500" },
  { name: "text-fuchsia-600 dark:text-fuchsia-400", ring: "border-fuchsia-500", fill: "bg-fuchsia-500/15", dot: "bg-fuchsia-500" },
  { name: "text-cyan-600 dark:text-cyan-400", ring: "border-cyan-500", fill: "bg-cyan-500/15", dot: "bg-cyan-500" },
  { name: "text-orange-600 dark:text-orange-400", ring: "border-orange-500", fill: "bg-orange-500/15", dot: "bg-orange-500" },
] as const;

// Stable colour per pubkey — identical in every table on every surface, no
// matter which subset of grievances a given being shows.
function colorFor(pubkey: string) {
  const s = (pubkey || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
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

  const party = (pk: string) => {
    const c = colorFor(pk);
    const isMe = pk.toLowerCase() === me;
    return <span className={`${c.name} ${isMe ? "font-semibold underline decoration-dotted underline-offset-2" : "font-medium"}`}>{nameOf(pk)}</span>;
  };

  // owner = whose step this is; the open mark is drawn in THEIR colour.
  const StepCell = ({ done, ownerPubkey, label }: { done: boolean; ownerPubkey: string; label: string }) => {
    const c = colorFor(ownerPubkey);
    const title = `${nameOf(ownerPubkey)} · ${label} — ${done ? (labels.doneWord || "✓") : (labels.openWord || "…")}`;
    return (
      <td className="p-2 text-center">
        <span title={title} role="img" aria-label={title} className="inline-flex items-center justify-center">
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            // open: a filled ring in the responsible person's colour — it POPS,
            // because an open coloured mark is exactly "someone still owes this".
            <span className={`inline-block h-3.5 w-3.5 rounded-full border-2 ${c.ring} ${c.fill}`} />
          )}
        </span>
      </td>
    );
  };

  // The distinct people who actually appear in this table, in a stable order,
  // for the legend chips.
  const parties: string[] = [];
  for (const g of grievances) for (const pk of [g.fromPubkey, g.toPubkey]) {
    if (pk && !parties.some((p) => p.toLowerCase() === pk.toLowerCase())) parties.push(pk);
  }

  return (
    <div className="overflow-x-auto">
      {parties.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          {parties.map((pk) => {
            const c = colorFor(pk);
            return (
              <span key={pk} className="inline-flex items-center gap-1.5 text-[11px]">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.dot}`} />
                <span className={c.name}>{nameOf(pk)}</span>
              </span>
            );
          })}
        </div>
      )}
      {labels.colorHint && (
        <p className="text-[10px] leading-snug text-muted-foreground/80 mb-2">{labels.colorHint}</p>
      )}
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
                <div>{party(g.fromPubkey)} → {party(g.toPubkey)}</div>
                {g.summary && <div className="text-muted-foreground leading-snug mt-0.5">{g.summary}</div>}
              </td>
              {/* respond / accept / apologize = the RECEIVER's (toPubkey) work */}
              <StepCell done={g.respondedByTarget} ownerPubkey={g.toPubkey} label={labels.responded} />
              <StepCell done={g.status === "accepted"} ownerPubkey={g.toPubkey} label={labels.accepted} />
              <StepCell done={g.apologyNoted} ownerPubkey={g.toPubkey} label={labels.apologized} />
              {/* owning the delusion = the GIVER's (fromPubkey) work */}
              <StepCell done={g.acceptedByGiver} ownerPubkey={g.fromPubkey} label={labels.owned} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
