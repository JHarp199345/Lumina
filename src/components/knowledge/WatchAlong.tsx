import { Play, Radio } from "lucide-react";
import { useBookStore } from "@/store/bookStore";

/**
 * Watch Along — related video context for the active book.
 * Named to avoid third-party branding; will surface curated / searched clips later.
 */
export default function WatchAlong() {
  const { activeBook } = useBookStore();

  return (
    <div className="flex flex-1 flex-col p-4">
      <div className="rounded-2xl border border-lumina-gold/25 bg-lumina-gold/[0.05] p-4 shadow-inner shadow-white/[0.02]">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/25 bg-lumina-gold/[0.08] text-lumina-gold">
            <Play size={20} />
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-lumina-gold/75">Coming Soon</p>
            <h3 className="text-base font-semibold text-ink/90">Watch Along</h3>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          {activeBook
            ? `Surface lectures, adaptations, and explainers related to ${activeBook.title} — without leaving the reader.`
            : "Open a book first, then return here for related video context."}
        </p>
        <div className="mt-4 grid gap-2">
          {[
            "Chapter-aware video suggestions from the book's themes",
            "Save clips to revisit while you read",
            "Optional listen-along with transcript highlights",
          ].map((point) => (
            <div
              key={point}
              className="rounded-lg border border-hair bg-ink/[0.025] px-3 py-2 text-xs text-ink-faint"
            >
              {point}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 flex items-center gap-2 text-[11px] leading-relaxed text-ink-faint">
        <Radio size={12} className="text-lumina-gold/60" />
        Video providers will be linked by URL — no embedded trademark UI.
      </p>
    </div>
  );
}
