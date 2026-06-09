import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import { Sparkles, RefreshCw, Loader, MapPin, X, LayoutGrid, CornerUpLeft, Check, AlertTriangle } from "lucide-react";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { useBookOrchestration } from "@/hooks/useBookOrchestration";
import { storage } from "@/storage";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import { LUMINA_CONFIG } from "@/config";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useLongPress } from "@/hooks/useLongPress";
import AmbientSceneLayer, { type AmbientPhase } from "@/components/visual/AmbientSceneLayer";
import GalleryFocalView from "@/components/visual/GalleryFocalView";
import { useAnalysisOutcome } from "@/hooks/useAnalysisOutcome";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { getImageForScene } from "@/utils/imagePosition";
import { dedupeScenesByWordPosition } from "@/utils/sceneDedup";
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
  const currentCfi = useReaderStore((s) => s.currentCfi);
  const { isTablet } = useDeviceLayout();
  const { regenerateAllImages } = useBookOrchestration();
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showFocal, setShowFocal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [returnCfi, setReturnCfi] = useState<string | null>(null);

  // Brief done/failed confirmation after a (re-)analysis — the in-flight state is
  // already shown by the ambient layer / image overlay; this fills the missing
  // "it finished" moment that the orchestration clears too fast to paint.
  const analysisOutcome = useAnalysisOutcome(
    isAnalyzing,
    analysisProgressDetail?.phase,
    analysisProgressDetail?.message || analysisProgress
  );

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

  // Clicking the image opens the gallery focal view (the art experience).
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (!currentImage) return;
    e.stopPropagation();
    setShowFocal(true);
  }, [currentImage]);

  const rememberReadingSpot = useCallback(() => {
    if (currentCfi) setReturnCfi(currentCfi);
  }, [currentCfi]);

  // Navigate the reader to a scene's passage (behind whatever is open).
  const navigateToScene = useCallback((sceneId: string) => {
    const scene = activeSemanticMap?.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const win = window as Window & {
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNavigate?: (target: string) => void;
    };
    const target = scene.anchor?.href || scene.chapterId;
    if (win.luminaNavigateToScene) win.luminaNavigateToScene(target, scene.anchor?.wordOffset ?? 0);
    else win.luminaNavigate?.(target);
  }, [activeSemanticMap]);

  // Hero "Visit passage": go read it (close the gallery).
  const visitPassage = useCallback((sceneId: string) => {
    rememberReadingSpot();
    navigateToScene(sceneId);
    setShowFocal(false);
  }, [navigateToScene, rememberReadingSpot]);

  const returnToReadingSpot = useCallback(() => {
    if (!returnCfi) return;
    const win = window as Window & { luminaNavigate?: (target: string) => void };
    win.luminaNavigate?.(returnCfi);
    setReturnCfi(null);
  }, [returnCfi]);

  // Generate one planned scene's image (from the gallery placeholders).
  const generateForScene = useCallback(async (sceneId: string) => {
    if (!activeBook || !activeSemanticMap || !activeStyleSeed) return;
    const scene = activeSemanticMap.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
    const googleKey = await storage.loadApiKey("lumina_google_ai_key");
    const falKey = await storage.loadApiKey("lumina_fal_key");
    const styleSeed = getStyleSeedById(activeStyleSeed);
    if (!googleKey || !styleSeed) return;
    await generateImage({
      scene,
      styleSeed,
      bookId: activeBook.id,
      wordPosition: computeSceneWordPosition(scene, chapters),
      googleApiKey: googleKey,
      falApiKey: falKey ?? undefined,
      onComplete: async (img) => { addToCache(img); },
    });
  }, [activeBook, activeSemanticMap, activeStyleSeed, addToCache]);

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

      const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
      const scene =
        activeSemanticMap.scenes.find((s) => s.id === currentImage.sceneId) ??
        activeSemanticMap.scenes.find(
          (s) => computeSceneWordPosition(s, chapters) === currentImage.wordPosition
        );
      if (!scene) return;

      const newImage = await generateImage({
        scene,
        styleSeed,
        bookId: activeBook.id,
        wordPosition:
          typeof currentImage.wordPosition === "number"
            ? currentImage.wordPosition
            : computeSceneWordPosition(scene, chapters),
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
    rememberReadingSpot();
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
  }, [currentScene, rememberReadingSpot]);

  return (
    <div className="flex flex-col h-full bg-surface-darker">
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hair flex-shrink-0">
        <Sparkles size={12} className="text-lumina-gold" />
        <span className="text-xs font-semibold tracking-widest text-ink-faint uppercase">
          Visual Interpretation
        </span>
        <div className="flex-1" />
        {activeBook && activeSemanticMap && (
          <button
            onClick={() => setShowGallery(true)}
            className="flex items-center justify-center min-w-[28px] min-h-[28px] rounded text-ink-faint hover:text-ink-soft transition-colors"
            title="Visual story & controls"
            aria-label="Open visual story"
          >
            <LayoutGrid size={14} />
          </button>
        )}
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

        {/* Re-analysis confirmation — brief done/failed status the orchestration
            otherwise clears too fast to see. In-flight progress is already shown
            by the ambient layer / image overlay above. */}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
          <AnimatePresence>
            {analysisOutcome && (
              <motion.div
                key={analysisOutcome.kind}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="pointer-events-auto flex max-w-[calc(100%-16px)] items-center gap-2.5 rounded-xl border border-white/12 bg-[#081522]/92 px-3.5 py-2.5 shadow-2xl shadow-black/45 backdrop-blur-xl"
              >
                {analysisOutcome.kind === "done" ? (
                  <Check size={14} className="shrink-0 text-emerald-300/90" />
                ) : (
                  <AlertTriangle size={14} className="shrink-0 text-rose-300/90" />
                )}
                <p className="truncate text-[12px] text-white/80">{analysisOutcome.message}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Tablet: always-visible action button (44×44px touch target) */}
        {isTablet && currentImage && !isRegenerating && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowRegenerate((v) => !v);
            }}
            className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-scrim border border-white/15 flex items-center justify-center backdrop-blur-sm active:bg-black/80 transition-colors z-10"
            aria-label="Image actions"
          >
            <RefreshCw size={15} className="text-ink-soft" />
          </button>
        )}

        {returnCfi && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              returnToReadingSpot();
            }}
            className="absolute left-3 top-3 z-10 inline-flex min-h-10 items-center gap-2 rounded-full border border-lumina-gold/30 bg-scrim/70 px-3 text-[11px] uppercase tracking-[0.12em] text-lumina-gold/85 shadow-lg backdrop-blur-sm transition-colors hover:border-lumina-gold/50 hover:text-lumina-gold"
            aria-label="Return to previous reading spot"
          >
            <CornerUpLeft size={13} />
            Return
          </button>
        )}

        {/* Regenerating overlay */}
        <AnimatePresence>
          {isRegenerating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader size={20} className="text-lumina-gold animate-spin" />
                <p className="text-xs text-ink-faint">Generating new image…</p>
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
              className="absolute bottom-4 right-4 z-20 min-w-42 rounded-lg border border-hair bg-black/82 p-1.5 shadow-xl backdrop-blur-sm"
              onMouseLeave={() => setShowRegenerate(false)}
              onClick={(e) => e.stopPropagation()}
            >
              {currentScene && (
                <button
                  onClick={handleGoToScene}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-ink/64 transition-colors hover:bg-ink/8 hover:text-ink"
                >
                  <MapPin size={12} />
                  Go to Scene
                </button>
              )}
              <button
                onClick={handleRegenerate}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-ink/64 transition-colors hover:bg-ink/8 hover:text-ink"
              >
                <RefreshCw size={12} />
                Regenerate Image
              </button>
              <p className="px-3 pb-1 pt-1.5 text-[10px] text-ink-faint">Regeneration uses your API quota</p>
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
            className="flex items-center gap-2 px-4 py-3 border-t border-hair flex-shrink-0"
          >
            <span className="text-xs text-ink-faint font-medium tracking-wider uppercase">
              Themes
            </span>
            <div className="flex items-center gap-0 flex-wrap">
              {currentThemes.map((theme, i) => (
                <span key={i} className="text-xs text-ink-soft capitalize">
                  {i > 0 && <span className="text-ink-faint mx-1.5">·</span>}
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
            onRegenerateAll={regenerateAllImages}
            onClose={() => setShowGallery(false)}
          />
        )}
      </AnimatePresence>

      {/* Gallery focal view — the "piece on the wall" experience */}
      <AnimatePresence>
        {showFocal && (
          <GalleryFocalView
            activeSemanticMap={activeSemanticMap}
            imageCache={imageCache}
            startSceneId={currentImage?.sceneId}
            isAnalyzing={isAnalyzing}
            analysisProgress={analysisProgressDetail?.message || analysisProgress}
            analysisPercent={analysisProgressDetail?.percent}
            analysisPhase={analysisProgressDetail?.phase}
            onVisitPassage={visitPassage}
            onGenerateScene={generateForScene}
            onAnalyze={() => setAnalysisRequested(true)}
            onRegenerateAll={regenerateAllImages}
            onClose={() => setShowFocal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ImageDisplay({
  src,
  isGenerating,
}: {
  src: string;
  isGenerating: boolean;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const previousDisplaySrcRef = useRef<string | null>(null);
  const isWebUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  const displaySrc = isTauri && !isWebUrl ? toAssetUrl(src) : src;
  const sourceChanged =
    previousDisplaySrcRef.current !== null && previousDisplaySrcRef.current !== displaySrc;

  useEffect(() => {
    setLoadFailed(false);
    previousDisplaySrcRef.current = displaySrc;
  }, [displaySrc]);

  if (loadFailed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-reader px-6 text-center">
        <p className="text-xs text-ink-faint">Generated image could not be displayed</p>
        <p className="max-w-sm text-[10px] text-ink-faint break-all">{src}</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={src}
        initial={{ opacity: sourceChanged ? 0 : 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: sourceChanged ? 0 : 1 }}
        transition={{
          duration: sourceChanged ? LUMINA_CONFIG.IMAGE_TRANSITION_DURATION_MS / 1000 : 0,
          ease: "easeInOut",
        }}
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
              <span className="text-xs text-ink-faint tracking-wide">next scene forming</span>
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
  onRegenerateAll,
  onClose,
}: {
  imageCache: Record<string, CachedImage>;
  currentSceneId?: string;
  activeSemanticMap: SemanticMap | null;
  isAnalyzing: boolean;
  analysisProgress: string;
  analysisProgressDetail: ReturnType<typeof useBookStore.getState>["analysisProgressDetail"];
  onAnalyze: () => void;
  onRegenerateAll: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const chapters = useBookStore((state) => state.activeStructure?.chapters ?? []);
  const scenes = dedupeScenesByWordPosition(activeSemanticMap?.scenes ?? [], chapters);
  const beats: VisualBeat[] =
    activeSemanticMap?.storyboard?.beats?.filter((beat) =>
      scenes.some((scene) => scene.id === beat.sceneId)
    ) ??
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
      image: scene ? getImageForScene(scene, Object.values(imageCache), chapters) : undefined,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-md"
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
        <div className="relative flex max-h-[72vh] w-full flex-col overflow-hidden rounded-lg border border-hair bg-reader/95 shadow-2xl">
          <div className="flex items-center justify-between border-b border-hair px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
                Visual Story
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {generatedCount} generated · {Math.max(0, timeline.length - generatedCount)} planned
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-hair bg-black/18 p-1">
                {(["horizontal", "vertical"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setOrientation(mode)}
                    className={`rounded px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                      orientation === mode
                        ? "bg-ink/10 text-ink-soft"
                        : "text-ink-faint hover:text-ink-soft"
                    }`}
                    aria-label={`Show ${mode} visual story`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                onClick={onClose}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
                aria-label="Close visual story"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {timeline.length === 0 ? (
            <div className="flex min-h-64 flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm text-ink-faint">No visual story planned yet.</p>
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
                        : "border-hair bg-ink/[0.04] hover:border-hair"
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
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-panel">
                            <Sparkles size={15} className="text-lumina-gold/35" />
                            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
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
                            <span className="rounded border border-hair px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                              Reader
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-xs leading-snug text-ink-soft">
                          {scene?.directorBrief?.blocking?.focalPoint ||
                            scene?.symbolicMotifs.slice(0, 2).join(" + ") ||
                            beat.emotionalPurpose}
                        </p>
                        <p className="text-[10px] text-ink-faint">
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
            aria-label={activeSemanticMap ? "Refresh the visual plan" : "Analyze this book"}
          >
            {isAnalyzing ? (
              <Loader size={15} className="animate-spin" />
            ) : activeSemanticMap ? (
              <RefreshCw size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {isAnalyzing ? "Analyzing" : activeSemanticMap ? "Refresh Visual Plan" : "Analyze This Book"}
          </button>
          {!isAnalyzing && activeSemanticMap && (
            <p className="max-w-[min(420px,82vw)] text-center text-[11px] leading-relaxed text-ink-faint">
              Rebuilds the visual scaffold. The slider below erases generated images.
            </p>
          )}
        </div>

        {/* Slide-to-confirm wipe + repaint. Only offered when images exist. */}
        {!isAnalyzing && generatedCount > 0 && (
          <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 justify-center px-4">
            <SlideToRegenerate
              onConfirm={async () => {
                await onRegenerateAll();
                onClose();
              }}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Slide-to-confirm control — drag the handle fully right to fire a destructive
// wipe + repaint. The deliberate gesture prevents accidental triggers.
function SlideToRegenerate({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [maxX, setMaxX] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const HANDLE = 40; // px
  const PADDING = 4; // px on each side

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) {
        setMaxX(Math.max(0, trackRef.current.offsetWidth - HANDLE - PADDING * 2));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={trackRef}
      className="relative h-12 w-[min(420px,82vw)] select-none overflow-hidden rounded-full border border-hair bg-sky-50/[0.055] shadow-[0_12px_38px_rgba(0,0,0,0.34)] backdrop-blur-md"
    >
      <div className="pointer-events-none absolute inset-[3px] rounded-full border border-white/[0.055] bg-gradient-to-r from-sky-100/[0.045] via-sky-100/[0.075] to-sky-100/[0.045]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-12 text-center text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        {confirmed ? "Repainting from your spot…" : "Slide to erase generated images"}
      </div>
      <motion.div
        drag={confirmed ? false : "x"}
        dragConstraints={{ left: 0, right: maxX }}
        dragElastic={0}
        dragMomentum={false}
        style={{ x, left: PADDING }}
        onDragEnd={() => {
          if (x.get() >= maxX - 6) {
            setConfirmed(true);
            animate(x, maxX, { type: "spring", stiffness: 420, damping: 38 });
            void onConfirm();
          } else {
            animate(x, 0, { type: "spring", stiffness: 420, damping: 38 });
          }
        }}
        className="absolute top-1 flex h-10 w-10 cursor-grab items-center justify-center rounded-full border border-lumina-gold/45 bg-lumina-gold/78 text-[#071525] shadow-[0_8px_22px_rgba(0,0,0,0.35)] backdrop-blur-sm active:cursor-grabbing"
        aria-label="Slide to erase generated images and regenerate from reading anchors"
      >
        <RefreshCw size={15} />
      </motion.div>
    </div>
  );
}

function DisabledState() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-ink-faint">Image generation is disabled.</p>
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
      <p className="max-w-sm px-6 text-center text-xs leading-relaxed text-ink-faint">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs text-ink-faint hover:text-ink-faint transition-colors flex items-center gap-1.5"
      >
        <RefreshCw size={11} />
        Try again
      </button>
    </div>
  );
}
