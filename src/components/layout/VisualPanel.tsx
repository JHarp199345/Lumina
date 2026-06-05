import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, RefreshCw, Loader, MapPin, X } from "lucide-react";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import { LUMINA_CONFIG } from "@/config";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useLongPress } from "@/hooks/useLongPress";
import AmbientSceneLayer, { type AmbientPhase } from "@/components/visual/AmbientSceneLayer";
import type { CachedImage, SemanticMap, VisualBeat } from "@/types";

// ─── Waiting phase resolver ───────────────────────────────────────────────────
// Determines the precise ambient state when no image is being displayed.
// Prevents "First scene forming…" from showing when nothing is actually queued.

function resolveWaitingPhase({
  apiKeyConfigured,
  activeSemanticMap,
  isGenerating,
  hasPendingInQueue,
  hasFailedInQueue,
}: {
  apiKeyConfigured: boolean;
  activeSemanticMap: SemanticMap | null;
  isGenerating: boolean;
  hasPendingInQueue: boolean;
  hasFailedInQueue: boolean;
}): AmbientPhase {
  if (!apiKeyConfigured)       return "needs_key";
  if (!activeSemanticMap)      return "needs_analysis";
  if (isGenerating)            return "generating";
  if (hasPendingInQueue)       return "waiting";
  if (hasFailedInQueue)        return "idle";
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
  const {
    currentImage,
    currentThemes,
    imageCache,
    isTransitioning,
    isGenerating,
    queue,
    clearQueue,
    setCurrentImage,
    setCurrentThemes,
    addToCache,
  } = useImageStore();
  const {
    activeBook,
    isAnalyzing,
    analysisProgress,
    analysisProgressDetail,
    activeSemanticMap,
    activeStyleSeed,
    setAnalysisRequested,
  } = useBookStore();
  const { imageGenerationEnabled, apiKeyConfigured } = useSettingsStore();
  const { isTablet } = useDeviceLayout();
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const currentScene = currentImage
    ? activeSemanticMap?.scenes.find((scene) => scene.id === currentImage.sceneId)
    : null;
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

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (!currentImage) return;
    e.stopPropagation();
    setShowGallery(true);
  }, [currentImage]);

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

      addToCache(newImage);
      setCurrentImage(newImage);
      setCurrentThemes(newImage.emotionalThemes);
      setHasFailed(false);
    } catch (err) {
      console.error("[Regenerate] Failed:", err);
      setHasFailed(true);
    } finally {
      setIsRegenerating(false);
    }
  }, [currentImage, activeBook, activeSemanticMap, activeStyleSeed, addToCache, setCurrentImage, setCurrentThemes]);

  const handleGoToScene = useCallback(() => {
    if (!currentScene) return;
    const win = window as Window & {
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNavigate?: (target: string) => void;
    };
    const target = currentScene.anchor?.href || currentScene.chapterId;
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(target, currentScene.anchor?.wordOffset ?? 0);
    } else {
      win.luminaNavigate?.(target);
    }
    setShowRegenerate(false);
  }, [currentScene]);

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
        onClick={currentImage ? handleImageClick : undefined}
      >
        {!activeBook ? (
          <AmbientSceneLayer phase="empty" />
        ) : !imageGenerationEnabled ? (
          <DisabledState />
        ) : currentImage ? (
          <ImageDisplay
            src={currentImage.filePath}
            isTransitioning={isTransitioning}
            isGenerating={isGenerating || isAnalyzing}
          />
        ) : isAnalyzing ? (
          <AmbientSceneLayer
            arcShape={activeSemanticMap?.arcShape}
            phase="analyzing"
            progressText={analysisProgress}
            progressDetail={analysisProgressDetail}
          />
        ) : analysisProgressDetail?.phase === "error" ? (
          <AmbientFailureState
            gradient={ambientGradient}
            message={analysisProgressDetail.message}
            onRetry={() => setAnalysisRequested(true)}
          />
        ) : hasFailed ? (
          <AmbientFailureState gradient={ambientGradient} onRetry={handleRegenerate} />
        ) : (() => {
          const waitingPhase = resolveWaitingPhase({
            apiKeyConfigured,
            activeSemanticMap: activeSemanticMap ?? null,
            isGenerating,
            hasPendingInQueue: queue.some((q) => q.status === "pending"),
            hasFailedInQueue: queue.some((q) => q.status === "failed"),
          });
          if (queue.some((q) => q.status === "failed")) {
            return <AmbientFailureState gradient={ambientGradient} onRetry={() => {
              clearQueue();
              setAnalysisRequested(true);
            }} />;
          }
          return (
            <AmbientSceneLayer
              arcShape={activeSemanticMap?.arcShape}
              phase={waitingPhase}
              // "Analyze This Book" — only shown when no analysis has run yet
              onAction={waitingPhase === "needs_analysis"
                ? () => {
                    console.info("[VisualPanel] Analyze This Book clicked");
                    setAnalysisRequested(true);
                  }
                : undefined}
              actionLabel="Analyze This Book"
            />
          );
        })()}

        {/* Tablet: always-visible action button (44×44px touch target) */}
        {isTablet && currentImage && !isRegenerating && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowRegenerate((v) => !v);
            }}
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

        {/* Image action menu */}
        <AnimatePresence>
          {showRegenerate && !isRegenerating && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-4 right-4 z-20 min-w-42 rounded-lg border border-white/10 bg-black/82 p-1.5 shadow-xl backdrop-blur-sm"
              onMouseLeave={() => setShowRegenerate(false)}
              onClick={(e) => e.stopPropagation()}
            >
              {currentScene && (
                <button
                  onClick={handleGoToScene}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-white/64 transition-colors hover:bg-white/8 hover:text-white"
                >
                  <MapPin size={12} />
                  Go to Scene
                </button>
              )}
              <button
                onClick={handleRegenerate}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-white/64 transition-colors hover:bg-white/8 hover:text-white"
              >
                <RefreshCw size={12} />
                Regenerate Image
              </button>
              <p className="px-3 pb-1 pt-1.5 text-[10px] text-white/20">Regeneration uses your API quota</p>
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

      <AnimatePresence>
        {showGallery && (
          <ImageGalleryModal
            imageCache={imageCache}
            currentSceneId={currentImage?.sceneId}
            activeSemanticMap={activeSemanticMap}
            isAnalyzing={isAnalyzing}
            analysisProgress={analysisProgress}
            analysisProgressDetail={analysisProgressDetail}
            onAnalyze={() => setAnalysisRequested(true)}
            onClose={() => setShowGallery(false)}
          />
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
  const [loadFailed, setLoadFailed] = useState(false);
  const isWebUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  const displaySrc = isTauri && !isWebUrl ? toAssetUrl(src) : src;

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  if (loadFailed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#071525] px-6 text-center">
        <p className="text-xs text-sky-100/28">Generated image could not be displayed</p>
        <p className="max-w-sm text-[10px] text-sky-100/16 break-all">{src}</p>
      </div>
    );
  }

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
          onLoad={() => setLoadFailed(false)}
          onError={() => {
            console.warn("[VisualPanel] Image failed to load:", displaySrc);
            setLoadFailed(true);
          }}
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

function getDisplayImageSrc(src: string): string {
  const isDisplayUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  return isTauri && !isDisplayUrl ? toAssetUrl(src) : src;
}

function ImageGalleryModal({
  imageCache,
  currentSceneId,
  activeSemanticMap,
  isAnalyzing,
  analysisProgress,
  analysisProgressDetail,
  onAnalyze,
  onClose,
}: {
  imageCache: Record<string, CachedImage>;
  currentSceneId?: string;
  activeSemanticMap: SemanticMap | null;
  isAnalyzing: boolean;
  analysisProgress: string;
  analysisProgressDetail: ReturnType<typeof useBookStore.getState>["analysisProgressDetail"];
  onAnalyze: () => void;
  onClose: () => void;
}) {
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const scenes = activeSemanticMap?.scenes ?? [];
  const beats: VisualBeat[] =
    activeSemanticMap?.storyboard?.beats ??
    scenes.map((scene, index) => ({
      id: `fallback_${scene.id}`,
      sceneId: scene.id,
      beatIndex: index,
      beatType: index === 0 ? "opening" : "setup",
      origin: scene.inflectionPointId === "reader_selected" ? "reader_selection" : "arc",
      generationIntent:
        scene.inflectionPointId === "reader_selected"
          ? "reader_requested"
          : scene.inflectionPointId.startsWith("planned_")
            ? "planned_only"
            : "default",
      arcPosition: scenes.length > 1 ? index / (scenes.length - 1) : 0,
      readerTriggerWord: scene.anchor?.wordOffset ?? 0,
      emotionalPurpose: "Planned visual moment.",
      pacingNote: "Supports the book's visual rhythm.",
      visualDensity: "moderate",
    }));
  const timeline = beats.map((beat) => {
    const scene = scenes.find((item) => item.id === beat.sceneId);
    return {
      beat,
      scene,
      image: scene ? imageCache[scene.id] : undefined,
    };
  });
  const generatedCount = timeline.filter((item) => item.image).length;

  const goToScene = (sceneId: string) => {
    const scene = activeSemanticMap?.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const win = window as Window & {
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNavigate?: (target: string) => void;
    };
    const target = scene.anchor?.href || scene.chapterId;
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(target, scene.anchor?.wordOffset ?? 0);
    } else {
      win.luminaNavigate?.(target);
    }
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.16 }}
        className="flex w-full max-w-5xl flex-col items-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex max-h-[72vh] w-full flex-col overflow-hidden rounded-lg border border-sky-100/12 bg-[#071525]/96 shadow-2xl">
          <div className="flex items-center justify-between border-b border-sky-100/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100/38">
                Visual Story
              </p>
              <p className="mt-1 text-xs text-sky-100/22">
                {generatedCount} generated · {Math.max(0, timeline.length - generatedCount)} planned
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-sky-100/10 bg-black/18 p-1">
                {(["horizontal", "vertical"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setOrientation(mode)}
                    className={`rounded px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                      orientation === mode
                        ? "bg-sky-100/10 text-sky-50/70"
                        : "text-sky-100/28 hover:text-sky-50/55"
                    }`}
                    aria-label={`Show ${mode} visual story`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                onClick={onClose}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-sky-100/35 transition-colors hover:bg-white/6 hover:text-sky-50"
                aria-label="Close visual story"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {timeline.length === 0 ? (
            <div className="flex min-h-64 flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm text-sky-100/28">No visual story planned yet.</p>
            </div>
          ) : (
            <div
              className={
                orientation === "horizontal"
                  ? "flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 py-5"
                  : "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5"
              }
            >
              {timeline.map(({ beat, scene, image }, index) => {
                const sceneId = scene?.id ?? beat.sceneId;
                const isCurrent = sceneId === currentSceneId;
                const isReaderRequested = beat.origin === "reader_selection";
                const isPlannedOnly = beat.generationIntent === "planned_only";
                const cardClass =
                  orientation === "horizontal"
                    ? "w-[280px] flex-shrink-0"
                    : "w-full";
                return (
                  <button
                    key={`${beat.id}-${image?.generatedAt ?? "planned"}`}
                    onClick={() => scene && goToScene(scene.id)}
                    disabled={!scene}
                    className={`group ${cardClass} overflow-hidden rounded-md border text-left transition-colors ${
                      isCurrent
                        ? "border-lumina-gold/55 bg-lumina-gold/8"
                        : "border-sky-100/10 bg-white/[0.025] hover:border-sky-100/22"
                    }`}
                  >
                    <div className={orientation === "horizontal" ? "" : "flex gap-3"}>
                      <div
                        className={
                          orientation === "horizontal"
                            ? "aspect-video w-full overflow-hidden bg-black/30"
                            : "h-24 w-36 flex-shrink-0 overflow-hidden bg-black/30"
                        }
                      >
                        {image ? (
                          <img
                            src={getDisplayImageSrc(image.filePath)}
                            alt="Generated visual story scene"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#06111f]">
                            <Sparkles size={15} className="text-lumina-gold/35" />
                            <span className="text-[10px] uppercase tracking-[0.14em] text-sky-100/22">
                              Planned
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5 p-3">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[10px] uppercase tracking-[0.16em] text-lumina-gold/55">
                            {beat.beatType.replace(/_/g, " ") || `Image ${index + 1}`}
                          </p>
                          {isReaderRequested && (
                            <span className="rounded border border-sky-100/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-sky-100/32">
                              Reader
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-xs leading-snug text-sky-100/56">
                          {scene?.directorBrief?.blocking?.focalPoint ||
                            scene?.symbolicMotifs.slice(0, 2).join(" + ") ||
                            beat.emotionalPurpose}
                        </p>
                        <p className="text-[10px] text-sky-100/22">
                          {image
                            ? "Tap to visit source passage"
                            : isPlannedOnly
                              ? "Mapped for the visual story"
                              : "Will generate near this passage"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="fixed bottom-[16vh] left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="inline-flex min-h-14 items-center gap-2.5 rounded-full border border-lumina-gold/38 bg-sky-50/[0.06] px-7 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-lumina-gold/90 shadow-[0_12px_38px_rgba(0,0,0,0.38)] backdrop-blur-md transition-colors hover:border-lumina-gold/60 hover:bg-sky-50/[0.09] hover:text-lumina-gold disabled:cursor-default disabled:opacity-70"
            aria-label={activeSemanticMap ? "Re-analyze this book" : "Analyze this book"}
          >
            {isAnalyzing ? (
              <Loader size={15} className="animate-spin" />
            ) : activeSemanticMap ? (
              <RefreshCw size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {isAnalyzing ? "Analyzing" : activeSemanticMap ? "Re-Analyze This Book" : "Analyze This Book"}
          </button>
          {isAnalyzing && (
            <div className="w-[min(420px,80vw)] rounded-full border border-sky-100/10 bg-black/28 p-1 backdrop-blur-sm">
              <div
                className="h-1.5 rounded-full bg-lumina-gold/70 transition-all duration-500"
                style={{ width: `${Math.max(6, Math.min(100, analysisProgressDetail?.percent ?? 12))}%` }}
              />
              <p className="mt-2 truncate text-center text-[11px] tracking-wide text-sky-100/42">
                {analysisProgressDetail?.message || analysisProgress || "Preparing the visual story..."}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
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
  message = "Image generation unavailable",
  onRetry,
}: {
  gradient: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4"
      style={{ background: gradient }}
    >
      <p className="max-w-sm px-6 text-center text-xs leading-relaxed text-white/20">{message}</p>
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
