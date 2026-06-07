/**
 * StudyGuide — PLANv Phase 1 (shell).
 *
 * A deliberate, opt-in comprehension layer reached from the Feature Drawer.
 * Phase 1 is just the shell: an empty state and a Generate Guide button that
 * shows a placeholder. NOTHING runs automatically — the reader asks, Lumina
 * responds. Real segmentation (Phase 2) and quizzes (Phase 4+) come later.
 */

import { useState } from "react";
import { Brain, Sparkles, BookOpen } from "lucide-react";
import { useBookStore } from "@/store/bookStore";

type GuideState = "empty" | "placeholder";

export default function StudyGuide() {
  const { activeBook } = useBookStore();
  const [state, setState] = useState<GuideState>("empty");

  // No book open — nothing to study yet.
  if (!activeBook) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-hair bg-ink/[0.04] text-ink-faint">
          <BookOpen size={20} />
        </span>
        <p className="text-sm text-ink-soft">Open a book to build a study guide.</p>
      </div>
    );
  }

  // Placeholder for the generated guide — Phase 2 will replace this with the
  // real segment list. Kept calm and honest rather than faking content.
  if (state === "placeholder") {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 scrollbar-thin">
        <div className="rounded-xl border border-hair bg-ink/[0.03] p-4">
          <p className="text-sm font-medium text-ink/85">Study segments are coming</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
            This is where “{activeBook.title}” will divide into readable study
            segments — natural stopping points you can review or be quizzed on.
            Segmentation is being built next; nothing has been generated or saved yet.
          </p>
        </div>
        <button
          onClick={() => setState("empty")}
          className="self-start rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition-colors hover:border-hair hover:text-ink-soft"
        >
          Back
        </button>
      </div>
    );
  }

  // Empty state — the reader must explicitly choose to generate.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
        <Brain size={22} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink/85">No Study Guide Yet</p>
        <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
          Generate a guide to divide this book into readable study segments.
        </p>
      </div>
      <button
        onClick={() => setState("placeholder")}
        className="flex items-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 hover:text-lumina-gold"
      >
        <Sparkles size={14} />
        Generate Guide
      </button>
    </div>
  );
}
