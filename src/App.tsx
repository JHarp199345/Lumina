import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { useBookOrchestration } from "@/hooks/useBookOrchestration";
import { useReadPosition } from "@/hooks/useReadPosition";
import { useImageTrigger } from "@/hooks/useImageTrigger";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { storage } from "@/storage";
import { parseEpub } from "@/pipeline/epubParser";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import TopNav from "@/components/layout/TopNav";
import SideRail from "@/components/layout/SideRail";
import PanelContainer from "@/components/layout/PanelContainer";
import TabletPanelContainer from "@/components/layout/TabletPanelContainer";
import HighlightLayer from "@/components/reader/HighlightLayer";
import SelectionActionBar from "@/components/reader/SelectionActionBar";
import AnnotationsDrawer from "@/components/knowledge/AnnotationsDrawer";
import SunburstNote from "@/components/knowledge/SunburstNote";
import SeedPicker from "@/components/visual/SeedPicker";
import OnboardingModal from "@/components/common/OnboardingModal";
import SettingsPanel from "@/components/common/SettingsPanel";
import LibraryPanel from "@/components/common/LibraryPanel";
import type { StyleSeedId, BookStructure } from "@/types";

function App() {
  const { theme, resolvedTheme, hasCompletedOnboarding, setApiKeyConfigured } = useSettingsStore();
  const {
    activeBook,
    activeStructure,
    activeStyleSeed,
    analysisRequested,
    setAnalysisRequested,
    setActiveStructure,
  } = useBookStore();
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedOnboarding);
  const { importEpub, loadLibrary } = useEpubImport();
  const { startOrchestration, reAnalyzeBook } = useBookOrchestration();
  const { isTablet, isPortrait } = useDeviceLayout();
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [importDetails, setImportDetails] = useState<string[]>([]);
  const [importFailed, setImportFailed] = useState(false);

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
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    storage
      .loadApiKey("lumina_google_ai_key")
      .then((key) => setApiKeyConfigured(Boolean(key)))
      .catch(() => setApiKeyConfigured(false));
  }, [setApiKeyConfigured]);

  const [pendingSeedSelection, setPendingSeedSelection] = useState<{
    structure: BookStructure;
  } | null>(null);

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
            const parsed = await parseEpub(bytes, (message) => setImportProgress(message)).catch(() => null);
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
        setImportProgress("Starting visual analysis…");

        setAnalysisRequested(false);

        if (activeStyleSeed) {
          if (useBookStore.getState().activeSemanticMap) {
            await reAnalyzeBook(structure);
          } else {
            await startOrchestration(structure, activeStyleSeed);
          }
          setImportProgress("");
        } else {
          setImportProgress("");
          setPendingSeedSelection({ structure });
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
    setAnalysisRequested,
    setActiveStructure,
    startOrchestration,
    reAnalyzeBook,
  ]);

  // Activate read-position tracking and image triggering
  useReadPosition();
  useImageTrigger();

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

  const handleImport = async () => {
    let failed = false;
    const reportImportProgress = (message: string) => {
      setImportProgress(message);
      setImportDetails((items) => {
        const next = [...items, message].filter(Boolean);
        return next.slice(Math.max(0, next.length - 14));
      });
      console.info("[Lumina Import]", message);
    };

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
    const { structure } = pendingSeedSelection;
    setPendingSeedSelection(null);
    try {
      setImportFailed(false);
      setImportProgress("Starting visual analysis…");
      await startOrchestration(structure, seedId);
      setImportProgress("");
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
      <div className="flex h-full overflow-hidden rounded-xl border border-hair bg-surface-dark shadow-2xl shadow-black/35">
        <SideRail
          onImport={handleImport}
          onLibraryOpen={() => setShowLibrary(true)}
          isTablet={isTablet}
          tocOpen={tabletTocOpen}
          onTocToggle={() => setTabletTocOpen((v) => !v)}
          onSettingsOpen={() => setShowSettings(true)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopNav
            onImport={handleImport}
            isTablet={isTablet}
            tocOpen={tabletTocOpen}
            onTocToggle={() => setTabletTocOpen((v) => !v)}
          />

          {isTablet ? (
            <TabletPanelContainer
              isPortrait={isPortrait}
              tocOpen={tabletTocOpen}
              onTocClose={() => setTabletTocOpen(false)}
              onImport={handleImport}
            />
          ) : (
            <PanelContainer
              tocOpen={tabletTocOpen}
              onTocClose={() => setTabletTocOpen(false)}
              onImport={handleImport}
            />
          )}
        </div>
      </div>

      <HighlightLayer />
      <SelectionActionBar />
      <AnnotationsDrawer />
      <SunburstNote />

      <AnimatePresence>
        {importProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim backdrop-blur-sm"
          >
            <div className="w-[min(560px,calc(100vw-2rem))] rounded-xl border border-hair bg-surface-dark px-5 py-4 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-ink/80">{importProgress}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {importFailed
                      ? "The failed step is listed below."
                      : "Large collections can take a moment."}
                  </p>
                </div>
                {importFailed && (
                  <button
                    type="button"
                    onClick={() => {
                      setImportFailed(false);
                      setImportProgress("");
                    }}
                    className="rounded-md border border-sky-200/15 px-3 py-1 text-xs text-ink-soft transition hover:border-hair hover:text-ink"
                  >
                    Close
                  </button>
                )}
              </div>

              {importDetails.length > 0 && (
                <div className="mt-4 max-h-48 space-y-1 overflow-auto rounded-lg border border-hair bg-black/20 p-3">
                  {importDetails.map((detail, index) => (
                    <p
                      key={`${detail}-${index}`}
                      className="break-words font-mono text-[11px] leading-relaxed text-ink/45"
                    >
                      {detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Style Seed Picker — appears after EPUB import */}
      <AnimatePresence>
        {pendingSeedSelection && activeBook && (
          <SeedPicker
            bookTitle={activeBook.title}
            onSelect={handleSeedSelected}
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
        />
      )}
    </div>
  );
}

export default App;
