import type { Grievance } from "@/hooks/useOwnGrievances";

// The four steps a person walks with a grievance, in the order the process
// itself walks them. Pure logic — the page only renders what this decides.
export type StepKey = "respond" | "accept" | "apologize" | "own";
export const STEP_ORDER: StepKey[] = ["respond", "accept", "apologize", "own"];

/** The step a single grievance still waits for from THIS person — null when nothing does. */
export function pendingStepFor(g: Grievance, me: string): StepKey | null {
  const lower = (v: string) => String(v || "").toLowerCase();
  if (lower(g.toPubkey) === me) {
    if (!g.respondedByTarget) return "respond";
    if (g.status !== "accepted") return "accept";
    if (!g.apologyNoted) return "apologize";
    return null;
  }
  if (lower(g.fromPubkey) === me) return g.acceptedByGiver ? null : "own";
  return null;
}

export interface TodoItem {
  key: string;
  g: Grievance;
  /** The least advanced step any being still waits for. */
  step: StepKey;
  /** Which beings still wait — and at which step each of them waits. */
  pending: { beingPubkey: string; step: StepKey }[];
  /** Beings that record this grievance but consider this person's part done. */
  done: string[];
  pendingBeings: number;
  totalBeings: number;
}

/** Merge the same grievance across beings; keep the LEAST advanced step. */
export function mergeTodo(
  ledgers: { beingPubkey: string; grievances: Grievance[] }[],
  me: string,
): TodoItem[] {
  const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  const byKey = new Map<string, { g: Grievance; step: StepKey; pending: Map<string, StepKey> }>();
  const involved = new Map<string, Set<string>>();   // key → beings that record this grievance at all
  for (const l of ledgers) {
    for (const g of l.grievances) {
      const key = `${String(g.fromPubkey).toLowerCase()}|${String(g.toPubkey).toLowerCase()}|${norm(g.summary)}`;
      if (!involved.has(key)) involved.set(key, new Set());
      involved.get(key)!.add(l.beingPubkey);
      const step = pendingStepFor(g, me);
      if (!step) continue;
      const cur = byKey.get(key);
      if (!cur) { byKey.set(key, { g, step, pending: new Map([[l.beingPubkey, step]]) }); continue; }
      // A being may record the same grievance twice — keep ITS least advanced read.
      const prevForBeing = cur.pending.get(l.beingPubkey);
      if (!prevForBeing || STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(prevForBeing)) cur.pending.set(l.beingPubkey, step);
      // least advanced wins — the work is done only when no being waits
      if (STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(cur.step)) { cur.step = step; cur.g = g; }
    }
  }
  return [...byKey.entries()]
    .map(([key, v]) => {
      const pending = [...v.pending.entries()].map(([beingPubkey, step]) => ({ beingPubkey, step }));
      const all = involved.get(key) || new Set(v.pending.keys());
      const done = [...all].filter((b) => !v.pending.has(b));
      return { key, g: v.g, step: v.step, pending, done, pendingBeings: pending.length, totalBeings: all.size };
    })
    .sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}
