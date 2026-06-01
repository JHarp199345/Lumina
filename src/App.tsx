import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { useBookOrchestration } from "@/hooks/useBookOrchestration";
import { useReadPosition } from "@/hooks/useReadPosition";
import { useImageTrigger } from "@/hooks/useImageTrigger";
import TopNav from "@/components/layout/TopNav";
import PanelContainer from "@/components/layout/PanelContainer";
import HighlightLayer from "@/components/reader/HighlightLayer";
import SeedPicker from "@/components/visual/SeedPicker";
import OnboardingModal from "@/components/common/OnboardingModal";
import type { StyleSeedId, BookStructure } from "@/types";

function App() {
  const { resolvedTheme, hasCompletedOnboarding } = useSettingsStore();
  const { activeBook } = useBookStore();
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedOnboarding);
  const { importEpub, loadLibrary } = useEpubImport();
  const { startOrchestration } = useBookOrchestration();

  // Load library from SQLite on startup
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);
  const [pendingSeedSelection, setPendingSeedSelection] = useState<{
    structure: BookStructure;
  } | null>(null);

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
  }, [resolvedTheme]);

  const handleImport = async () => {
    try {
      const result = await importEpub();
      if (result) {
        // Show seed picker before starting orchestration
        setPendingSeedSelection({ structure: result.structure });
      }
    } catch (err) {
      console.error("Import failed:", err);
    }
  };

  const handleSeedSelected = async (seedId: StyleSeedId) => {
    if (!pendingSeedSelection) return;
    setPendingSeedSelection(null);
    await startOrchestration(pendingSeedSelection.structure, seedId);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-dark">
      <TopNav onImport={handleImport} />
      <PanelContainer />
      <HighlightLayer />

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
    </div>
  );
}

export default App;
