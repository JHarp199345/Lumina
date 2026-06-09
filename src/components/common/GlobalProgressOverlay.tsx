import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { AnalysisProgressDetail, AnalysisProgressPhase } from "@/types";

export type GlobalProgressMode = "import" | "analysis";

const PHASE_LABELS: Record<AnalysisProgressPhase, string> = {
  preparing: "Preparing chapters",
  scoring: "Scoring emotional tone",
  mapping: "Mapping story arc",
  scenes: "Finding key scenes",
  prompts: "Writing visual briefs",
  "opening-image": "Composing opening image",
  queueing: "Saving visual plan",
  complete: "Complete",
  error: "Error",
};

function estimateImportPercent(message: string): number {
  const step = message.toLowerCase();
  if (step.includes("failed")) return 0;
  if (step.includes("imported") || step.includes("added")) return 100;
  if (step.includes("mounting") || step.includes("done:")) return 92;
  if (step.includes("saving")) return 82;
  if (step.includes("copying")) return 72;
  if (step.includes("extracting cover")) return 65;
  if (step.includes("gutenberg") || step.includes("edition")) return 58;
  if (step.includes("split") || (step.includes("found") && step.includes("chapters"))) return 52;
  if (step.includes("table of contents") || step.includes("reading table")) return 45;
  if (step.includes("parsing")) return 35;
  if (step.includes("unpacking") || step.includes("reading epub")) return 22;
  if (step.includes("downloading") || step.includes("step 1")) return 12;
  if (step.includes("preparing") || step.includes("step 2")) return 8;
  return 18;
}

function importTitle(message: string): string {
  const step = message.toLowerCase();
  if (step.includes("analysis") || step.includes("visual")) return "Visual Analysis";
  if (step.includes("downloading") || step.includes("step 1")) return "Downloading Book";
  if (step.includes("open shelf") || step.includes("gutenberg")) return "Adding from Open Shelf";
  return "Importing Book";
}

interface GlobalProgressOverlayProps {
  visible: boolean;
  mode: GlobalProgressMode;
  message: string;
  hint?: string;
  percent?: number;
  detail?: AnalysisProgressDetail | null;
  log?: string[];
  failed?: boolean;
  onDismiss?: () => void;
}

export default function GlobalProgressOverlay({
  visible,
  mode,
  message,
  hint,
  percent,
  detail,
  log = [],
  failed = false,
  onDismiss,
}: GlobalProgressOverlayProps) {
  const resolvedPercent = Math.max(
    4,
    Math.min(
      100,
      percent ??
        detail?.percent ??
        (mode === "import" ? estimateImportPercent(message) : 12)
    )
  );

  const title =
    mode === "analysis"
      ? "Visual Analysis"
      : importTitle(message);

  const phaseLabel =
    mode === "analysis" && detail?.phase
      ? PHASE_LABELS[detail.phase] ?? detail.phase.replace(/-/g, " ")
      : mode === "import"
        ? "Import pipeline"
        : "Working";

  const stepDetail =
    detail?.current != null && detail.total != null
      ? `${detail.current} of ${detail.total}${
          detail.itemLabel ? ` · ${detail.itemLabel}` : ""
        }`
      : detail?.itemLabel ?? null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-sky-200/15 bg-[linear-gradient(160deg,rgba(18,28,42,0.96),rgba(8,14,24,0.98))] px-6 py-5 shadow-[0_28px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  {!failed && (
                    <Loader2 size={16} className="shrink-0 animate-spin text-lumina-gold/80" />
                  )}
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-lumina-gold/75">
                    {title}
                  </p>
                </div>

                <p className="mt-3 text-base font-medium text-ink/90">
                  {detail?.message || message}
                </p>

                {hint && (
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-faint">{hint}</p>
                )}

                {stepDetail && (
                  <p className="mt-3 truncate text-sm text-ink-soft">{stepDetail}</p>
                )}
              </div>

              {failed && onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="shrink-0 rounded-md border border-sky-200/15 px-3 py-1.5 text-xs text-ink-soft transition hover:border-hair hover:text-ink"
                >
                  Close
                </button>
              )}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                <span>{phaseLabel}</span>
                <span>{resolvedPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full border border-hair bg-black/30">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-lumina-gold/55 via-lumina-gold/85 to-amber-200/80 shadow-[0_0_18px_rgba(199,169,96,0.35)]"
                  initial={false}
                  animate={{ width: `${resolvedPercent}%` }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                />
              </div>
            </div>

            {log.length > 0 && (
              <div className="mt-5 max-h-40 space-y-1 overflow-auto rounded-lg border border-hair bg-black/25 p-3">
                {log.map((entry, index) => (
                  <p
                    key={`${entry}-${index}`}
                    className="break-words font-mono text-[11px] leading-relaxed text-ink/45"
                  >
                    {entry}
                  </p>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
