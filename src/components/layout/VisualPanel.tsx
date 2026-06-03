import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, RefreshCw, Loader } from "lucide-react";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { toAssetUrl } from "@/utils/tauriBridge";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useLongPress } from "@/hooks/useLongPress";
import AmbientSceneLayer, { type AmbientPhase } from "@/components/visual/AmbientSceneLayer";
import type { SemanticMap } from "@/types";

// ─── Waiting phase resolver ───────────────────────────────────────────────────
// Determines the precise ambient state when no image is being displayed.
// Prevents "First scene forming…" from showing when nothing is actually queued.

function resolveWaitingPhase({
  apiKeyConfigured,
  activeSemanticMap,
  isGenerating,
  hasPendingInQueue,
}: {
  apiKeyConfigured: boolean;
  activeSemanticMap: SemanticMap | null;
  isGenerating: boolean;
  hasPendingInQueue: boolean;
}): AmbientPhase {
  if (!apiKeyConfigured)       return "needs_key";
  if (!activeSemanticMap)      return "needs_analysis";
  if (isGenerating)            return "generating";
  if (hasPendingInQueue)       return "waiting";
  return "idle";
}

// Ambient palette per arc shape — used as graceful failure fallback
const ARC_AMBIENT_GRADIENTS: Record<string, string> = {
  "rise":             "radial-gradient(ellipse at 30% 70%, #1a2840 0%, #0c1520 60%, #080e18 100%)",
  "fall":             "radial-gradient(ellipse at 70% 30%, #1a1010 0%, #100808 60%, #080506 100%)",
  "fall-rise":        "radial-gradient(ellipse at 50% 60%, #101820 0%, #181010 40%, #101820 100%)",
  "rise-fall":        "radial-gradient(ellipse at 50% 40%, #1a2030 0%, #100810 60%, #080810 100%)",
  "rise-fall-rise":   "radial-gradient(ellipse at 30% 50%, #102018 0%, #101018 50%, #102018 100%)",
  "fall-rise-fall":   "radial-gradient(ellipse at 60% 60%, #18100c 0%, #0c1018 50%, #18100c 100%)",
  "default":          "radial-gradient(ellipse at 50% 50%, #111118 0%, #0c0c10 100%)",
};


export default function VisualPanel() {
  const { currentImage, currentThemes, isTransitioning, isGenerating, queue, setCurrentImage, setCurrentThemes, addToCache } = useImageStore();
  const { activeBook, isAnalyzing, analysisProgress, activeSemanticMap, activeStyleSeed, setAnalysisRequested } = useBookStore();
  const { imageGenerationEnabled, apiKeyConfigured } = useSettingsStore();
  const { isTablet } = useDeviceLayout();
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const ambientGradient = activeSemanticMap
    ? ARC_AMBIENT_GRADIENTS[activeSemanticMap.arcShape] ?? ARC_AMBIENT_GRADIENTS.default
    : ARC_AMBIENT_GRADIENTS.default;

  // Desktop: right-click or double-click opens the regenerate menu.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (currentImage) setShowRegenerate(true);
  }, [currentImage]);

  const handleDoubleClick = useCallback(() => {
    if (!isTablet && currentImage) setShowRegenerate(true);
  }, [isTablet, currentImage]);

  // Tablet: long-press opens the regenerate menu.
  const longPress = useLongPress(
    useCallback(() => { if (currentImage) setShowRegenerate(true); }, [currentImage])
  );

  const handleRegenerate = useCallback(async () => {
    if (!currentImage || !activeBook || !activeSemanticMap || !activeStyleSeed) return;
    setShowRegenerate(false);
    setIsRegenerating(true);

    try {
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");
      const styleSeed = getStyleSeedById(activeStyleSeed);
      if (!googleKey || !styleSeed) return;

      const scene = activeSemanticMap.scenes.find((s) => s.id === currentImage.sceneId);
      if (!scene) return;

      const newImage = await generateImage({
        scene,
        styleSeed,
        bookId: activeBook.id,
        googleApiKey: googleKey,
        falApiKey: falKey ?? undefined,
        onComplete: async (img) => {
          addToCache(img);
          setCurrentImage(img);
          setCurrentThemes(img.emotionalThemes);
          // Image already persisted inside storage.saveImage() — no extra save needed
        },
      });

      setHasFailed(false);
    } catch (err) {
      console.error("[Regenerate] Failed:", err);
      setHasFailed(true);
    } finally {
      setIsRegenerating(false);
    }
  }, [currentImage, activeBook, activeSemanticMap, activeStyleSeed, addToCache, setCurrentImage, setCurrentThemes]);

  return (
    <div className="flex flex-col h-full bg-surface-darker">
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 flex-shrink-0">
        <Sparkles size={12} className="text-lumina-gold" />
        <span className="text-xs font-semibold tracking-widest text-white/30 uppercase">
          Visual Interpretation
        </span>
      </div>

      {/* Image Area */}
      <div
        className="flex-1 relative overflow-hidden cursor-default select-none"
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        {...(isTablet ? longPress : {})}
      >
        {!activeBook ? (
          <AmbientSceneLayer phase="empty" />
        ) : !imageGenerationEnabled ? (
          <DisabledState />
        ) : isAnalyzing ? (
          <AmbientSceneLayer
            arcShape={activeSemanticMap?.arcShape}
            phase="analyzing"
            progressText={analysisProgress}
          />
        ) : hasFailed ? (
          <AmbientFailureState gradient={ambientGradient} onRetry={handleRegenerate} />
        ) : currentImage ? (
          <ImageDisplay
            src={currentImage.filePath}
            isTransitioning={isTransitioning}
            isGenerating={isGenerating}
          />
        ) : (() => {
          const waitingPhase = resolveWaitingPhase({
            apiKeyConfigured,
            activeSemanticMap: activeSemanticMap ?? null,
            isGenerating,
            hasPendingInQueue: queue.some((q) => q.status === "pending"),
          });
          return (
            <AmbientSceneLayer
              arcShape={activeSemanticMap?.arcShape}
              phase={waitingPhase}
              // "Analyze This Book" — only shown when no analysis has run yet
              onAction={waitingPhase === "needs_analysis"
                ? () => setAnalysisRequested(true)
                : undefined}
              actionLabel="Analyze This Book"
            />
          );
        })()}

        {/* Tablet: always-visible action button (44×44px touch target) */}
        {isTablet && currentImage && !isRegenerating && (
          <button
            onClick={() => setShowRegenerate((v) => !v)}
            className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-black/60 border border-white/15 flex items-center justify-center backdrop-blur-sm active:bg-black/80 transition-colors z-10"
            aria-label="Image actions"
          >
            <RefreshCw size={15} className="text-white/50" />
          </button>
        )}

        {/* Regenerating overlay */}
        <AnimatePresence>
          {isRegenerating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader size={20} className="text-lumina-gold animate-spin" />
                <p className="text-xs text-white/40">Generating new image…</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Regenerate context menu */}
        <AnimatePresence>
          {showRegenerate && !isRegenerating && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-4 right-4"
              onMouseLeave={() => setShowRegenerate(false)}
            >
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-2 px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-xs text-white/70 hover:text-white hover:border-lumina-gold/40 transition-colors backdrop-blur-sm"
              >
                <RefreshCw size={12} />
                Regenerate Image
              </button>
              <p className="text-xs text-white/20 text-center mt-1.5">Uses your API quota</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Themes Footer */}
      <AnimatePresence>
        {currentThemes.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-4 py-3 border-t border-white/5 flex-shrink-0"
          >
            <span className="text-xs text-white/20 font-medium tracking-wider uppercase">
              Themes
            </span>
            <div className="flex items-center gap-0 flex-wrap">
              {currentThemes.map((theme, i) => (
                <span key={i} className="text-xs text-white/45 capitalize">
                  {i > 0 && <span className="text-white/15 mx-1.5">·</span>}
                  {theme}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ImageDisplay({
  src,
  isTransitioning,
  isGenerating,
}: {
  src: string;
  isTransitioning: boolean;
  isGenerating: boolean;
}) {
  // Convert stored file path to a WebView-safe URL.
  // On desktop, file:// works natively; on Android, we need the asset:// protocol.
  const displaySrc = toAssetUrl(src);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={src}
        initial={{ opacity: 0 }}
        animate={{ opacity: isTransitioning ? 0 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: LUMINA_CONFIG.IMAGE_TRANSITION_DURATION_MS / 1000, ease: "easeInOut" }}
        className="absolute inset-0"
      >
        <img
          src={displaySrc}
          alt="Symbolic visual interpretation"
          className="w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30 pointer-events-none" />

        {/* Subtle generation anticipation indicator — visible over the current image
            only when the system is generating the *next* scene */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute bottom-3 left-4 flex items-center gap-1.5 pointer-events-none"
            >
              <div className="w-1 h-1 rounded-full bg-lumina-gold/40 animate-pulse" />
              <span className="text-xs text-white/20 tracking-wide">next scene forming</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

function DisabledState() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-white/15">Image generation is disabled.</p>
    </div>
  );
}

function AmbientFailureState({
  gradient,
  onRetry,
}: {
  gradient: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4"
      style={{ background: gradient }}
    >
      <p className="text-xs text-white/15">Image generation unavailable</p>
      <button
        onClick={onRetry}
        className="text-xs text-white/20 hover:text-white/40 transition-colors flex items-center gap-1.5"
      >
        <RefreshCw size={11} />
        Try again
      </button>
    </div>
  );
}
