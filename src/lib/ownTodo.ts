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

/** Merge the same grievance across beings; keep the LEAST advanced step. */
export function mergeTodo(
  ledgers: { beingPubkey: string; grievances: Grievance[] }[],
  me: string,
): { key: string; g: Grievance; step: StepKey; pendingBeings: number; totalBeings: number }[] {
  const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
  const byKey = new Map<string, { g: Grievance; step: StepKey; pendingBeings: number; seen: Set<string> }>();
  const involved = new Map<string, Set<string>>();   // key → beings that record this grievance at all
  for (const l of ledgers) {
    for (const g of l.grievances) {
      const key = `${String(g.fromPubkey).toLowerCase()}|${String(g.toPubkey).toLowerCase()}|${norm(g.summary)}`;
      if (!involved.has(key)) involved.set(key, new Set());
      involved.get(key)!.add(l.beingPubkey);
      const step = pendingStepFor(g, me);
      if (!step) continue;
      const cur = byKey.get(key);
      if (!cur) { byKey.set(key, { g, step, pendingBeings: 1, seen: new Set([l.beingPubkey]) }); continue; }
      if (!cur.seen.has(l.beingPubkey)) { cur.seen.add(l.beingPubkey); cur.pendingBeings += 1; }
      // least advanced wins — the work is done only when no being waits
      if (STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(cur.step)) { cur.step = step; cur.g = g; }
    }
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, g: v.g, step: v.step, pendingBeings: v.pendingBeings, totalBeings: involved.get(key)?.size || v.pendingBeings }))
    .sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}
