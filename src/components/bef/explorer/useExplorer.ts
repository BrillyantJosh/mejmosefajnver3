import { useCallback, useEffect, useRef, useState } from "react";
import type { BefClient, ScenarioResponse } from "@/lib/bef/api";
import type { BefProblem } from "@/lib/bef/problems";
import { loadFigures, runScenario, type ExplorerFigures, type ScenarioInput, type ScenarioOutcome } from "./scenarioModel";

export type FiguresState =
  | { kind: "loading" }
  | { kind: "ready"; figures: ExplorerFigures }
  | { kind: "failed"; problem: BefProblem };

/**
 * BEF's published figures for the calculator — bootstrap, splits, companies —
 * read once when the Explorer opens, and again on Try again. An answer that
 * arrives after a newer read started (or after the page closed) is dropped.
 */
export function useExplorerFigures(client: Pick<BefClient, "figures">) {
  const [state, setState] = useState<FiguresState>({ kind: "loading" });
  /** Counts reads; only the newest one's answer is kept. */
  const attempts = useRef({ latest: 0 });

  const load = useCallback(() => {
    const counter = attempts.current;
    const mine = ++counter.latest;
    setState({ kind: "loading" });
    void loadFigures(client).then((answer) => {
      if (mine !== counter.latest) return;
      setState("figures" in answer ? { kind: "ready", figures: answer.figures } : { kind: "failed", problem: answer.problem });
    });
  }, [client]);

  useEffect(() => {
    const counter = attempts.current;
    load();
    return () => {
      counter.latest++;
    };
  }, [load]);

  return { state, reload: load };
}

/** BEF's calculator waits this long after the last change before it asks (Calculator.tsx:158-162). */
export const RECALCULATE_DELAY_MS = 350;

/**
 * The scenario for the chosen inputs, asked for again after every change —
 * a result must never sit under freshly changed inputs as their answer. Only
 * the newest request's answer is kept: a slower earlier one arriving later is
 * dropped. `outcome` is what the latest request came to (null until the first
 * arrives); `scenario` is the last result, kept only while no refusal replaced it.
 * Used once BEF's figures are there: the limits in `input` come from them.
 */
export function useScenario(client: Pick<BefClient, "figures">, input: ScenarioInput) {
  const [outcome, setOutcome] = useState<ScenarioOutcome | null>(null);
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);

  // `binding` must keep its identity while the limit stays the same (the page
  // memoises it), or every render would ask again.
  const { amountText, currency, round, scope, sellerId, treasuryId, binding } = input;

  const calculate = useCallback(async () => {
    const mine = ++sequence.current;
    setLoading(true);
    const next = await runScenario(client, { amountText, currency, round, scope, sellerId, treasuryId, binding });
    if (mine !== sequence.current) return;
    setOutcome(next);
    setScenario(next.kind === "result" ? next.scenario : null);
    setLoading(false);
  }, [client, amountText, currency, round, scope, sellerId, treasuryId, binding]);

  useEffect(() => {
    const timer = setTimeout(() => void calculate(), RECALCULATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [calculate]);

  // Leaving the page drops whatever is still on its way.
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  return { outcome, scenario, loading, recalculate: calculate };
}
