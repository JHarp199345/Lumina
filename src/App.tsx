import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { useBookOrchestration } from "@/hooks/useBookOrchestration";
import ImageTriggerHost from "@/components/visual/ImageTriggerHost";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { storage } from "@/storage";
import { reconcileOrphanedVisualJobs } from "@/services/visualGenerationJobs";
import { parseEpub } from "@/pipeline/epubParser";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import TopNav from "@/components/layout/TopNav";
import SideRail from "@/components/layout/SideRail";
import PanelContainer from "@/components/layout/PanelContainer";
import TabletPanelContainer from "@/components/layout/TabletPanelContainer";
import PhonePanelContainer from "@/components/layout/PhonePanelContainer";
import TocDrawer from "@/components/layout/TocDrawer";
import HighlightLayer from "@/components/reader/HighlightLayer";
import LensStyleBridge from "@/components/reader/LensStyleBridge";
import SelectionActionBar from "@/components/reader/SelectionActionBar";
import AnnotationsDrawer from "@/components/knowledge/AnnotationsDrawer";
import FloatingAudioPlayer from "@/components/knowledge/FloatingAudioPlayer";
import OverviewGenerationIndicator from "@/components/knowledge/OverviewGenerationIndicator";
import SunburstNote from "@/components/knowledge/SunburstNote";
import SeedPicker from "@/components/visual/SeedPicker";
import OnboardingModal from "@/components/common/OnboardingModal";
import SettingsPanel from "@/components/common/SettingsPanel";
import LibraryPanel from "@/components/common/LibraryPanel";
import ArchivePanel from "@/components/common/ArchivePanel";
import GlobalProgressOverlay from "@/components/common/GlobalProgressOverlay";
import GalleryFocalView from "@/components/visual/GalleryFocalView";
import VisualDebugOverlay from "@/components/debug/VisualDebugOverlay";
import { useGalleryActions } from "@/hooks/useGalleryActions";
import { useImageStore } from "@/store/imageStore";
import { useUiStore } from "@/store/uiStore";
import { hydrateOdysseusConfig } from "@/api/llmClient";
import type { StyleSeedId, BookStructure } from "@/types";

function App() {
  const { theme, resolvedTheme, hasCompletedOnboarding, setApiKeyConfigured } = useSettingsStore();
  const {
    activeBook,
    activeStructure,
    activeSemanticMap,
    activeStyleSeed,
    analysisRequested,
    setAnalysisRequested,
    setActiveStructure,
    isAnalyzing,
    analysisProgress,
    analysisProgressDetail,
    setAnalysisProgress,
    setAnalysisProgressDetail,
    setActiveStyleSeed,
  } = useBookStore();
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedOnboarding);
  const { importEpub, importEpubFile, loadLibrary, openBook } = useEpubImport();

  // Clear any generation job orphaned by a previous session (e.g. a generation
  // started while logged out that never completed) so a stuck progress bar can't
  // survive a page refresh. Runs once on mount.
  useEffect(() => {
    reconcileOrphanedVisualJobs();
  }, []);

  // Dev-only: ?test=1 auto-loads a bundled test EPUB and skips onboarding so the
  // reader (and highlight selection) can be exercised in preview without a picker.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("test")) return;
    setShowOnboarding(false);
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}test-book.epub`);
        const blob = await res.blob();
        const file = new File([blob], "test-book.epub", { type: "application/epub+zip" });
        await importEpubFile(file);
        console.info("[test] test book loaded");
      } catch (e) {
        console.error("[test] auto-load failed", e);
      }
    })();
  }, [importEpubFile]);
  const { startOrchestration, reAnalyzeBook, regenerateAllImages } = useBookOrchestration();
  const { galleryOpen, galleryStartSceneId, closeGallery } = useUiStore();
  const imageCache = useImageStore((state) => state.imageCache);
  const { visitPassage, generateForScene } = useGalleryActions();
  const { isTablet, isPhone, isPortrait } = useDeviceLayout();
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [importDetails, setImportDetails] = useState<string[]>([]);
  const [importFailed, setImportFailed] = useState(false);
  const visualDebugEnabled =
    new URLSearchParams(window.location.search).get("debug") === "visuals" ||
    window.localStorage.getItem("lumina.debug.visuals") === "1";

  useEffect(() => {
    void hydrateOdysseusConfig();
  }, []);

  // TOC open/closed state for tablet layouts.
  // In landscape the rail starts open; in portrait the drawer starts closed.
  const [tabletTocOpen, setTabletTocOpen] = useState(isTablet && !isPortrait);

  // When the device rotates, open the rail in landscape and close the drawer in portrait.
  useEffect(() => {
    setTabletTocOpen(isTablet && !isPortrait);
  }, [isTablet, isPortrait]);

  // Load library from SQLite on startup
  useEffect(() => {
    diagnosticInfo("library.load.start", "Loading library");
    let cancelled = false;
    loadLibrary().then((books) => {
      if (cancelled || useBookStore.getState().activeBook || books.length === 0) return;
      const lastBook = [...books].sort((a, b) => {
        const aTime = new Date(a.lastOpened ?? a.importedAt).getTime();
        const bTime = new Date(b.lastOpened ?? b.importedAt).getTime();
        return bTime - aTime;
      })[0];
      if (!lastBook) return;
      diagnosticInfo("library.auto_open.start", "Reopening last active book", {
        bookId: lastBook.id,
        title: lastBook.title,
      });
      openBook(lastBook).catch((err) => {
        diagnosticError("library.auto_open.failed", "Could not reopen last active book", {
          bookId: lastBook.id,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadLibrary, openBook]);

  useEffect(() => {
    storage
      .loadApiKey("lumina_google_ai_key")
      .then((key) => setApiKeyConfigured(Boolean(key)))
      .catch(() => setApiKeyConfigured(false));
  }, [setApiKeyConfigured]);

  const [pendingSeedSelection, setPendingSeedSelection] = useState<{
    structure: BookStructure;
    forceReanalyze?: boolean;
  } | null>(null);
  const [forceStylePickerForAnalysis, setForceStylePickerForAnalysis] = useState(false);

  // ── Analysis-from-open-book trigger ─────────────────────────────────────────
  // VisualPanel sets analysisRequested when the user clicks "Analyze This Book".
  // We handle it here because seed selection (SeedPicker) lives in App.tsx.
  //
  // Flow:
  //   seed already saved → startOrchestration immediately
  //   no seed → show SeedPicker; handleSeedSelected calls startOrchestration
  useEffect(() => {
    if (!analysisRequested) return;
    if (!activeBook) {
      setAnalysisRequested(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        let structure = activeStructure;

        if (!structure) {
          setImportProgress("Restoring book structure…");
          structure = await storage.loadBookStructure(activeBook.id).catch(() => null);
          if (structure && !cancelled) {
            setActiveStructure(structure);
          }
        }

        if (!structure) {
          setImportProgress("Rebuilding book structure…");
          const bytes = await storage.getEpubBytes(activeBook).catch(() => null);
          if (bytes) {
            const importContext =
              activeBook.gutenbergId || activeBook.editionPipeline === "gutenberg"
                ? {
                    gutenbergId: activeBook.gutenbergId,
                    catalogTitle: activeBook.title,
                    catalogAuthor: activeBook.author,
                  }
                : undefined;
            const parsed = await parseEpub(bytes, (message) => setImportProgress(message), {
              importContext,
            }).catch(() => null);
            structure = parsed?.structure ?? null;
            if (structure && !cancelled) {
              await storage.saveBookStructure(structure).catch(() => {});
              setActiveStructure(structure);
              setImportProgress("");
            }
          }
        }

        if (!structure) {
          setAnalysisRequested(false);
          setImportFailed(true);
          setImportProgress("Analysis cannot start: Lumina could not rebuild this book structure from the saved EPUB.");
          return;
        }

        console.info("[Lumina Analysis] Request accepted", {
          bookId: activeBook.id,
          chapters: structure.chapters.length,
          hasSeed: Boolean(activeStyleSeed),
        });
        diagnosticInfo("analysis.request.accepted", "Analysis request accepted", {
          bookId: activeBook.id,
          chapters: structure.chapters.length,
          hasSeed: Boolean(activeStyleSeed),
        });
        setImportFailed(false);
        setImportProgress("");

        setAnalysisRequested(false);

        if (activeStyleSeed && !forceStylePickerForAnalysis) {
          if (useBookStore.getState().activeSemanticMap) {
            await reAnalyzeBook(structure);
          } else {
            await startOrchestration(structure, activeStyleSeed);
          }
        } else {
          setPendingSeedSelection({
            structure,
            forceReanalyze: Boolean(useBookStore.getState().activeSemanticMap),
          });
        }
      } catch (err) {
        console.error("[Lumina Analysis] Failed to start:", err);
        diagnosticError("analysis.start.failed", "Analysis failed to start", {
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        setAnalysisRequested(false);
        setImportFailed(true);
        setImportProgress(
          err instanceof Error
            ? `Analysis failed: ${err.message}`
            : "Analysis failed before it could start."
        );
      } finally {
        setForceStylePickerForAnalysis(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    analysisRequested,
    activeBook,
    activeStructure,
    activeStyleSeed,
    forceStylePickerForAnalysis,
    setAnalysisRequested,
    setActiveStructure,
    startOrchestration,
    reAnalyzeBook,
  ]);

  // Apply theme to document root
  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.setAttribute("data-theme", resolvedTheme());
    };
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, [theme, resolvedTheme]);

  const reportImportProgress = (message: string) => {
    setImportProgress(message);
    if (!message) {
      setImportDetails([]);
      return;
    }
    setImportDetails((items) => {
      const next = [...items, message].filter(Boolean);
      return next.slice(Math.max(0, next.length - 14));
    });
    console.info("[Lumina Import]", message);
  };

  const analysisProgressHint = (() => {
    if (analysisProgressDetail?.phase === "scoring") {
      return "Scoring each chapter's emotional tone — large books take longer.";
    }
    if (analysisProgressDetail?.phase === "scenes") {
      return "Finding the key visual moments across the story.";
    }
    if (analysisProgressDetail?.phase === "prompts" || analysisProgressDetail?.phase === "opening-image") {
      return "Turning story beats into image briefs for your style.";
    }
    return "Building your visual plan — large books can take a minute.";
  })();

  const importProgressHint = (() => {
    if (importFailed) return "The failed step is listed below.";
    const step = importProgress.toLowerCase();
    if (step.includes("downloading") || step.includes("step 1")) {
      return "Keep this screen open while the book downloads.";
    }
    if (step.includes("parsing") || step.includes("reading epub") || step.includes("step 2")) {
      return "Parsing chapters and preparing your library…";
    }
    if (step.includes("saving") || step.includes("mounting")) {
      return "Almost ready — finishing setup.";
    }
    return "Working…";
  })();

  const analysisFailed = analysisProgressDetail?.phase === "error";
  const showAnalysisOverlay = isAnalyzing;
  const showImportOverlay = Boolean(importProgress) && !isAnalyzing;
  const showProgressOverlay =
    isAnalyzing || showImportOverlay || importFailed || analysisFailed;

  const handleImport = async () => {
    let failed = false;

    try {
      setImportFailed(false);
      setImportDetails([]);
      reportImportProgress("Preparing import…");
      const result = await importEpub(reportImportProgress);
      if (result) {
        const bookSections = result.structure.collectionGroups?.length;
        const collectionSummary =
          bookSections && bookSections > 1
            ? ` across ${bookSections} book sections`
            : "";
        reportImportProgress(
          `Imported ${result.structure.chapters.length} chapters${collectionSummary}.`
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
        // Show seed picker before starting orchestration
        setPendingSeedSelection({ structure: result.structure });
      }
    } catch (err) {
      console.error("Import failed:", err);
      diagnosticError("import.failed", "Import failed", {
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      });
      const message = err instanceof Error ? err.message : String(err);
      failed = true;
      setImportFailed(true);
      reportImportProgress(`Import failed: ${message}`);
    } finally {
      if (!failed) setImportProgress("");
    }
  };

  const handleSeedSelected = async (seedId: StyleSeedId) => {
    if (!pendingSeedSelection) return;
    const { structure, forceReanalyze } = pendingSeedSelection;
    setPendingSeedSelection(null);
    try {
      setImportFailed(false);
      if (forceReanalyze && activeBook) {
        setActiveStyleSeed(seedId);
        await storage.saveBookStyleSeed(activeBook.id, seedId).catch(() => {});
        await reAnalyzeBook(structure);
      } else {
        await startOrchestration(structure, seedId);
      }
    } catch (err) {
      console.error("[Lumina Analysis] Failed after style selection:", err);
      diagnosticError("analysis.seed_selection.failed", "Analysis failed after style selection", {
        seedId,
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      });
      setImportFailed(true);
      setImportProgress(
        err instanceof Error
          ? `Analysis failed: ${err.message}`
          : "Analysis failed after style selection."
      );
    }
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-app p-3 text-ink sm:p-4">
      <ImageTriggerHost />
      <div className="relative flex h-full overflow-hidden rounded-xl border border-hair bg-surface-dark shadow-2xl shadow-black/35">
        <SideRail
          onImport={handleImport}
          onLibraryOpen={() => setShowLibrary(true)}
          onArchiveOpen={() => setShowArchive(true)}
          isTablet={isTablet}
          isPhone={isPhone}
          tocOpen={tabletTocOpen}
          onTocToggle={() => setTabletTocOpen((v) => !v)}
          onSettingsOpen={() => setShowSettings(true)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopNav
            onImport={handleImport}
            isTablet={isTablet || isPhone}
            tocOpen={tabletTocOpen}
            onTocToggle={() => setTabletTocOpen((v) => !v)}
          />

          {isPhone ? (
            <PhonePanelContainer onImport={handleImport} />
          ) : isTablet ? (
            <TabletPanelContainer
              isPortrait={isPortrait}
              onImport={handleImport}
            />
          ) : (
            <PanelContainer
              onTocClose={() => setTabletTocOpen(false)}
              onImport={handleImport}
            />
          )}
        </div>

        <TocDrawer
          open={tabletTocOpen}
          onClose={() => setTabletTocOpen(false)}
          side={isTablet && !isPortrait ? "right" : "left"}
        />
      </div>

      <HighlightLayer />
      <LensStyleBridge />
      <SelectionActionBar />
      <AnnotationsDrawer />
      <FloatingAudioPlayer />
      <OverviewGenerationIndicator />
      <SunburstNote />

      <GlobalProgressOverlay
        visible={showProgressOverlay}
        mode={showAnalysisOverlay ? "analysis" : "import"}
        message={
          showAnalysisOverlay
            ? analysisProgressDetail?.message || analysisProgress || "Starting visual analysis…"
            : importProgress
        }
        hint={showAnalysisOverlay ? analysisProgressHint : importProgressHint}
        detail={showAnalysisOverlay ? analysisProgressDetail : null}
        log={showImportOverlay ? importDetails : []}
        failed={importFailed || analysisFailed}
        onDismiss={() => {
          setImportFailed(false);
          setImportProgress("");
          setAnalysisProgress("");
          setAnalysisProgressDetail(null);
        }}
      />

      {/* Style Seed Picker — appears after EPUB import */}
      <AnimatePresence>
        {pendingSeedSelection && activeBook && (
          <SeedPicker
            bookTitle={activeBook.title}
            onSelect={handleSeedSelected}
            onCancel={() => {
              setPendingSeedSelection(null);
              setForceStylePickerForAnalysis(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Onboarding — first launch only */}
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingModal onComplete={() => setShowOnboarding(false)} />
        )}
      </AnimatePresence>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showLibrary && (
        <LibraryPanel
          onClose={() => setShowLibrary(false)}
          onImport={handleImport}
          onImportProgress={reportImportProgress}
          onBookImported={(structure) => {
            setShowLibrary(false);
            setImportProgress("");
            setImportDetails([]);
            setPendingSeedSelection({ structure });
          }}
        />
      )}
      {showArchive && <ArchivePanel onClose={() => setShowArchive(false)} />}
      {visualDebugEnabled && <VisualDebugOverlay />}

      {galleryOpen && (
        <GalleryFocalView
          key={galleryStartSceneId ?? "gallery"}
          activeSemanticMap={activeSemanticMap}
          imageCache={imageCache}
          startSceneId={galleryStartSceneId}
          isAnalyzing={isAnalyzing}
          analysisProgress={analysisProgressDetail?.message || analysisProgress}
          analysisPercent={analysisProgressDetail?.percent}
          analysisPhase={analysisProgressDetail?.phase}
          onVisitPassage={visitPassage}
          onGenerateScene={generateForScene}
          onAnalyze={() => {
            closeGallery();
            setForceStylePickerForAnalysis(true);
            setAnalysisRequested(true);
          }}
          onRegenerateAll={regenerateAllImages}
          onClose={closeGallery}
        />
      )}
    </div>
  );
}

export default App;
