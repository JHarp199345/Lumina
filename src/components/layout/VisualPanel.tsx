import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, RefreshCw, Loader, MapPin, X, LayoutGrid, CornerUpLeft, Check, AlertTriangle, PanelBottom } from "lucide-react";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { getProvider } from "@/api/llmClient";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import { LUMINA_CONFIG } from "@/config";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useLongPress } from "@/hooks/useLongPress";
import AmbientSceneLayer, { type AmbientPhase } from "@/components/visual/AmbientSceneLayer";
import { useAnalysisOutcome } from "@/hooks/useAnalysisOutcome";
import { useUiStore } from "@/store/uiStore";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { getImageForScene } from "@/utils/imagePosition";
import { segmentScenesForSemanticMap, visualSlotKeyForScene } from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import type { CachedImage, SemanticMap } from "@/types";

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
  const effectiveApiKeyConfigured = apiKeyConfigured || getProvider() === "odysseus";
  const currentCfi = useReaderStore((s) => s.currentCfi);
  const { isTablet } = useDeviceLayout();
  const [showRegenerate, setShowRegenerate] = useState(false);
  const { openGallery, showPlanStrip, setShowPlanStrip, togglePlanStrip, returnCfi, setReturnCfi } =
    useUiStore();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

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

  const handleOpenGallery = useCallback(
    (sceneId?: string) => {
      openGallery(sceneId ?? currentImage?.sceneId);
    },
    [openGallery, currentImage?.sceneId]
  );

  useEffect(() => {
    if (analysisOutcome?.kind === "done" && !showPlanStrip) {
      setShowPlanStrip(true);
    }
  }, [analysisOutcome?.kind, setShowPlanStrip, showPlanStrip]);

  // Clicking the image opens the gallery focal view (the art experience).
  const handleImageClick = useCallback(
    (e: React.MouseEvent) => {
      if (!activeBook) return;
      e.stopPropagation();
      handleOpenGallery();
    },
    [activeBook, handleOpenGallery]
  );

  const rememberReadingSpot = useCallback(() => {
    if (currentCfi) setReturnCfi(currentCfi);
  }, [currentCfi, setReturnCfi]);

  const returnToReadingSpot = useCallback(() => {
    if (!returnCfi) return;
    const win = window as Window & { luminaNavigate?: (target: string) => void };
    win.luminaNavigate?.(returnCfi);
    setReturnCfi(null);
  }, [returnCfi, setReturnCfi]);

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
      if ((!googleKey && getProvider() === "gemini") || !styleSeed) return;

      const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
      const scene =
        activeSemanticMap.scenes.find((s) => s.id === currentImage.sceneId) ??
        activeSemanticMap.scenes.find(
          (s) => computeSceneWordPosition(s, chapters) === currentImage.wordPosition
        );
      if (!scene) return;

      const slotKey = visualSlotKeyForScene(scene, chapters);
      const store = useImageStore.getState();
      if (slotKey && !store.claimGenerationSlot(slotKey, true)) return;

      const wordPosition =
        typeof currentImage.wordPosition === "number"
          ? currentImage.wordPosition
          : computeSceneWordPosition(scene, chapters);

      try {
        const newImage = await generateImage({
          scene,
          styleSeed,
          bookId: activeBook.id,
          wordPosition,
          visualSlotKey: slotKey ?? undefined,
          googleApiKey: googleKey ?? "",
          falApiKey: falKey ?? undefined,
          onComplete: async (img) => {
            addToCache(img);
            setCurrentImage(img);
            setCurrentThemes(img.emotionalThemes);
          },
        });

        addToCache(newImage);
        setCurrentImage(newImage);
        setCurrentThemes(newImage.emotionalThemes);
        setHasFailed(false);
      } finally {
        if (slotKey) store.releaseGenerationSlot();
      }
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
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(currentScene.chapterId, currentScene.anchor?.wordOffset ?? 0);
    } else {
      const chapterIndex = useBookStore.getState().activeStructure?.chapters.find(
        (ch) => ch.id === currentScene.chapterId
      )?.index;
      if (chapterIndex !== undefined) {
        win.luminaNavigate?.(`lumina://chapter/${chapterIndex}/page/0`);
      }
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
        {activeBook && (
          <>
            <button
              onClick={togglePlanStrip}
              className={`flex min-h-[28px] min-w-[28px] items-center justify-center rounded transition-colors ${
                showPlanStrip ? "text-lumina-gold" : "text-ink-faint hover:text-ink-soft"
              }`}
              title="Visual plan strip"
              aria-label="Toggle visual plan strip"
              aria-pressed={showPlanStrip}
            >
              <PanelBottom size={14} />
            </button>
            <button
              onClick={() => handleOpenGallery()}
              className="flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-ink-faint transition-colors hover:text-ink-soft"
              title="Open gallery"
              aria-label="Open gallery"
            >
              <LayoutGrid size={14} />
            </button>
          </>
        )}
      </div>

      {/* Image Area */}
      <div
        className="flex-1 relative overflow-hidden cursor-default select-none"
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        {...(isTablet ? longPress : {})}
        onClick={activeBook ? handleImageClick : undefined}
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
            apiKeyConfigured: effectiveApiKeyConfigured,
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

        {/* Solo plan filmstrip — dismissible overlay, not a separate page */}
        <AnimatePresence>
          {showPlanStrip && activeSemanticMap && (
            <VisualPlanFilmstrip
              activeSemanticMap={activeSemanticMap}
              imageCache={imageCache}
              currentSceneId={currentImage?.sceneId}
              onSelectScene={(sceneId) => handleOpenGallery(sceneId)}
              onDismiss={() => setShowPlanStrip(false)}
            />
          )}
        </AnimatePresence>

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

/** Dismissible solo filmstrip — informational overlay on the visual panel, not a page. */
function VisualPlanFilmstrip({
  activeSemanticMap,
  imageCache,
  currentSceneId,
  onSelectScene,
  onDismiss,
}: {
  activeSemanticMap: SemanticMap;
  imageCache: Record<string, CachedImage>;
  currentSceneId?: string;
  onSelectScene: (sceneId: string) => void;
  onDismiss: () => void;
}) {
  const chapters = useBookStore((state) => state.activeStructure?.chapters ?? EMPTY_CHAPTERS);
  const allScenes = activeSemanticMap.scenes;
  const scenes = segmentScenesForSemanticMap(allScenes, chapters, activeSemanticMap);
  const cached = Object.values(imageCache);
  const generatedCount = scenes.filter((scene) =>
    getImageForScene(scene, cached, chapters, allScenes)
  ).length;

  if (scenes.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-x-0 bottom-0 z-20 border-t border-white/12 bg-[#06111d]/90 px-3 py-2.5 shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/42">
          {generatedCount} generated · {scenes.length - generatedCount} planned — tap to open gallery
        </p>
        <button
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/75"
          aria-label="Dismiss visual plan strip"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        {scenes.map((scene) => {
          const image = getImageForScene(scene, cached, chapters, allScenes);
          const selected = scene.id === currentSceneId;
          return (
            <button
              key={scene.id}
              onClick={() => onSelectScene(scene.id)}
              className={`relative h-14 w-20 flex-shrink-0 overflow-hidden rounded-[2px] transition-all ${
                selected
                  ? "ring-2 ring-lumina-gold/70 opacity-100"
                  : "opacity-55 ring-1 ring-white/10 hover:opacity-90"
              }`}
              aria-label={image ? "Open generated image in gallery" : "Open planned slot in gallery"}
            >
              {image ? (
                <img
                  src={getDisplayImageSrc(image.filePath)}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#100e0b]">
                  <Sparkles size={13} className="text-lumina-gold/35" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
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
