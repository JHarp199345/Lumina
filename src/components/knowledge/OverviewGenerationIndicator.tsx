import { AudioLines, Loader2 } from "lucide-react";
import { useDrawerStore } from "@/store/drawerStore";
import { useOverviewJobStore } from "@/store/overviewJobStore";

/** Always-on indicator for background Audio Overview jobs — above gallery overlays. */
export default function OverviewGenerationIndicator() {
  const { status, progress, error, bookId } = useOverviewJobStore();
  const { isOpen, view, open } = useDrawerStore();

  const running = status === "running" && Boolean(bookId);
  const failed = status === "failed" && Boolean(error);
  const completed = status === "completed";

  if (!running && !failed && !completed) return null;
  if (running && isOpen && view === "audio-overview") return null;

  const label = running
    ? progress || "Generating in background…"
    : failed
      ? error
      : progress || "Overview ready";

  return (
    <button
      type="button"
      onClick={() => open("audio-overview")}
      className="fixed bottom-6 right-6 z-[110] flex max-w-[min(340px,calc(100vw-2rem))] items-center gap-2 rounded-xl border border-lumina-gold/30 bg-[linear-gradient(145deg,rgba(48,38,18,0.94),rgba(18,14,8,0.96))] px-3 py-2.5 text-left text-lumina-gold/90 shadow-[0_18px_45px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      {running ? (
        <Loader2 size={15} className="shrink-0 animate-spin text-lumina-gold/80" />
      ) : (
        <AudioLines size={15} className="shrink-0 text-lumina-gold/80" />
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-lumina-gold/75">
          Audio Overview
        </p>
        <p
          className={`truncate text-xs ${failed ? "text-rose-300/90" : "text-lumina-gold/90"}`}
          title={label ?? undefined}
        >
          {label}
        </p>
      </div>
      <AudioLines size={14} className="shrink-0 text-lumina-gold/70" />
    </button>
  );
}
