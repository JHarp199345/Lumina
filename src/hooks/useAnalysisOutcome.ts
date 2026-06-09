/**
 * useAnalysisOutcome
 *
 * The orchestration clears its "complete" progress detail in the same tick it
 * flips isAnalyzing→false, so React never paints a finished state. This hook
 * watches the running→idle transition itself and holds a brief, self-clearing
 * done/failed outcome that the UI can actually show the reader.
 *
 * Shared by the focal gallery and the visual panel so both surface the same
 * confirmation after a (re-)analysis.
 */

import { useEffect, useRef, useState } from "react";
import type { AnalysisProgressPhase } from "@/types";

export interface AnalysisOutcome {
  kind: "done" | "error";
  message: string;
}

const DONE_VISIBLE_MS = 4000;
const ERROR_VISIBLE_MS = 6000;

export function useAnalysisOutcome(
  isAnalyzing: boolean,
  analysisPhase: AnalysisProgressPhase | undefined,
  errorMessage?: string
): AnalysisOutcome | null {
  const wasAnalyzingRef = useRef(false);
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;
  const [outcome, setOutcome] = useState<AnalysisOutcome | null>(null);

  // Clear any held banner only when a new analysis run starts — not on every
  // progress tick (errorMessage changes constantly during analysis).
  useEffect(() => {
    if (!isAnalyzing) return;
    wasAnalyzingRef.current = true;
    setOutcome((prev) => (prev === null ? prev : null));
  }, [isAnalyzing]);

  // Capture done/error once when analysis finishes.
  useEffect(() => {
    if (isAnalyzing) return;
    if (!wasAnalyzingRef.current) return;
    wasAnalyzingRef.current = false;
    setOutcome(
      analysisPhase === "error"
        ? { kind: "error", message: errorMessageRef.current || "Analysis didn't finish. Try again." }
        : { kind: "done", message: "Visual plan refreshed." }
    );
  }, [isAnalyzing, analysisPhase]);

  useEffect(() => {
    if (!outcome) return;
    const ms = outcome.kind === "error" ? ERROR_VISIBLE_MS : DONE_VISIBLE_MS;
    const t = window.setTimeout(() => setOutcome(null), ms);
    return () => window.clearTimeout(t);
  }, [outcome]);

  return outcome;
}
