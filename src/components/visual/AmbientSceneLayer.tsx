/**
 * AmbientSceneLayer — the living background of the visual pane.
 *
 * Replaces the static dark panel during all non-image states.
 * Three CSS layers: arc-matched gradient, slow particles, status text.
 * No canvas, no JS animation loop — pure CSS keyframes.
 */

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { AnalysisProgressDetail } from "@/types";

// ─── Arc-to-gradient map ──────────────────────────────────────────────────────
// Each gradient is tuned to the emotional world of its arc shape.
// rise-fall-rise (Red Rising's arc) gets the Martian ember palette.

const AMBIENT_GRADIENTS: Record<string, string> = {
  "rise":
    "radial-gradient(ellipse at 20% 80%, #0d1f0e 0%, #071525 55%, #030b12 100%)",
  "fall":
    "radial-gradient(ellipse at 80% 20%, #1f0d0d 0%, #120507 55%, #070308 100%)",
  "fall-rise":
    "radial-gradient(ellipse at 50% 70%, #0a0a14 0%, #1a0c08 40%, #0a1420 100%)",
  "rise-fall":
    "radial-gradient(ellipse at 40% 30%, #141a0a 0%, #0c0a18 50%, #08080e 100%)",
  "rise-fall-rise":
    "radial-gradient(ellipse at 25% 60%, #1a0c0a 0%, #0c0a14 45%, #0a1a0c 100%)",
  "fall-rise-fall":
    "radial-gradient(ellipse at 70% 40%, #0c1010 0%, #160c08 45%, #0c1016 100%)",
  "default":
    "radial-gradient(ellipse at 50% 50%, #0d1018 0%, #070a10 100%)",
};

// ─── Particle colour per arc family ──────────────────────────────────────────

function particleColor(arcShape?: string): string {
  if (!arcShape) return "rgba(150,160,180,";
  if (arcShape === "rise" || arcShape === "rise-fall-rise") return "rgba(180,120,60,";
  if (arcShape === "fall" || arcShape === "fall-rise-fall") return "rgba(100,120,160,";
  return "rgba(150,160,180,";
}

// ─── Status text per phase ────────────────────────────────────────────────────

const PHASE_PRIMARY: Record<string, string> = {
  empty:          "Open a book to begin",
  analyzing:      "Reading the emotional landscape…",
  generating:     "Composing the scene…",
  waiting:        "First scene forming…",
  needs_key:      "Add an API key in settings to enable visuals",
  needs_analysis: "Visual analysis hasn't run for this book yet",
  idle:           "",   // ambient gradient only — no text needed
};

// ─── Particle definitions (baked — no runtime randomness) ────────────────────

const PARTICLES = [
  { cls: "animate-float-1", size: 6,  top: "18%", left: "22%", opacity: 0.12 },
  { cls: "animate-float-2", size: 10, top: "65%", left: "72%", opacity: 0.08 },
  { cls: "animate-float-3", size: 4,  top: "42%", left: "15%", opacity: 0.15 },
  { cls: "animate-float-4", size: 8,  top: "80%", left: "40%", opacity: 0.07 },
  { cls: "animate-float-5", size: 5,  top: "30%", left: "85%", opacity: 0.10 },
  { cls: "animate-float-6", size: 12, top: "55%", left: "55%", opacity: 0.06 },
  { cls: "animate-float-7", size: 4,  top: "10%", left: "60%", opacity: 0.13 },
  { cls: "animate-float-8", size: 7,  top: "70%", left: "28%", opacity: 0.09 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export type AmbientPhase =
  | "empty"
  | "analyzing"
  | "generating"
  | "waiting"
  | "needs_key"
  | "needs_analysis"
  | "idle";

interface AmbientSceneLayerProps {
  arcShape?: string;
  phase: AmbientPhase;
  progressText?: string;
  progressDetail?: AnalysisProgressDetail | null;
  /** If provided, renders a call-to-action button below the status text */
  onAction?: () => void;
  /** Label for the action button. Defaults to "Get Started" */
  actionLabel?: string;
}

export default function AmbientSceneLayer({
  arcShape,
  phase,
  progressText,
  progressDetail,
  onAction,
  actionLabel = "Get Started",
}: AmbientSceneLayerProps) {
  const gradient = AMBIENT_GRADIENTS[arcShape ?? "default"] ?? AMBIENT_GRADIENTS.default;
  const pColor = particleColor(arcShape);
  const primaryText = PHASE_PRIMARY[phase] ?? "";
  // When analyzing, prefer the live progress message over the generic text
  const displayPrimary =
    phase === "analyzing" && (progressDetail?.message || progressText)
      ? progressDetail?.message || progressText || primaryText
      : primaryText;
  const progressPercent = Math.max(0, Math.min(100, progressDetail?.percent ?? 0));

  return (
    <div className="absolute inset-0 overflow-hidden">

      {/* Layer 1 — breathing gradient */}
      <div
        className="absolute inset-0 animate-ambient-pulse"
        style={{ background: gradient }}
      />

      {/* Layer 2 — particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className={`absolute rounded-full ${p.cls}`}
          style={{
            width: p.size,
            height: p.size,
            top: p.top,
            left: p.left,
            opacity: p.opacity,
            background: `${pColor}1)`,
            filter: "blur(4px)",
          }}
        />
      ))}

      {/* Layer 3 — status text (hidden in idle phase) */}
      {phase !== "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          >
            <Sparkles size={16} className="text-lumina-gold/40" />
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={displayPrimary}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex w-full max-w-sm flex-col items-center gap-2 text-center"
            >
              <p className="text-sm text-ink-faint font-light tracking-wide leading-relaxed">
                {displayPrimary}
              </p>

              {phase === "analyzing" && progressDetail && (
                <div className="w-full pt-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                    <motion.div
                      className="h-full rounded-full bg-lumina-gold/70 shadow-[0_0_16px_rgba(199,169,96,0.35)]"
                      initial={false}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                    <span>{progressDetail.phase.replace("-", " ")}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  {progressDetail.current != null && progressDetail.total != null && (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      {progressDetail.current} of {progressDetail.total}
                      {progressDetail.itemLabel ? ` · ${progressDetail.itemLabel}` : ""}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Action button — only rendered when caller provides onAction */}
          {onAction && (
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              onClick={onAction}
              className="mt-2 px-4 py-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 text-xs text-lumina-gold/80 hover:bg-lumina-gold/18 hover:text-lumina-gold active:bg-lumina-gold/22 transition-colors tracking-wide"
            >
              {actionLabel}
            </motion.button>
          )}
        </div>
      )}

    </div>
  );
}
