import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { getImageForScene } from "@/utils/imagePosition";
import { getDiagnosticEntries, type DiagnosticEntry } from "@/utils/diagnostics";

type VisualAnchorDebug = {
  sceneId: string;
  label: string;
  position: number;
  cached: boolean;
  current: boolean;
  queuedStatus: string;
};

function sceneLabel(sceneId: string): string {
  return sceneId
    .replace(/^scene[_-]/i, "")
    .replace(/[_-]+/g, " ")
    .slice(0, 44);
}

function compactEvent(entry: DiagnosticEntry): string {
  const data = entry.data && typeof entry.data === "object" ? entry.data as Record<string, unknown> : {};
  const parts = [
    data.reason ? `reason=${String(data.reason)}` : "",
    data.wordPosition !== undefined ? `pos=${String(data.wordPosition)}` : "",
    data.fromSceneId ? `from=${String(data.fromSceneId).slice(0, 18)}` : "",
    data.toSceneId ? `to=${String(data.toSceneId).slice(0, 18)}` : "",
    data.nextCachedSceneId ? `next=${String(data.nextCachedSceneId).slice(0, 18)}` : "",
    data.nextCachedScenePosition !== undefined ? `nextPos=${String(data.nextCachedScenePosition)}` : "",
  ].filter(Boolean);

  return parts.join(" · ");
}

export default function VisualDebugOverlay() {
  const activeBook = useBookStore((state) => state.activeBook);
  const activeStructure = useBookStore((state) => state.activeStructure);
  const activeSemanticMap = useBookStore((state) => state.activeSemanticMap);
  const wordPosition = useReaderStore((state) => state.wordPosition);
  const currentChapterIndex = useReaderStore((state) => state.currentChapterIndex);
  const percentComplete = useReaderStore((state) => state.percentComplete);
  const currentImage = useImageStore((state) => state.currentImage);
  const imageCache = useImageStore((state) => state.imageCache);
  const queue = useImageStore((state) => state.queue);
  const isGenerating = useImageStore((state) => state.isGenerating);
  const [closed, setClosed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>(() => getDiagnosticEntries());

  useEffect(() => {
    const interval = window.setInterval(() => setDiagnostics(getDiagnosticEntries()), 800);
    return () => window.clearInterval(interval);
  }, []);

  const anchors = useMemo<VisualAnchorDebug[]>(() => {
    const chapters = activeStructure?.chapters ?? [];
    const scenes = activeSemanticMap?.scenes ?? [];
    const cached = Object.values(imageCache);
    return scenes
      .map((scene) => {
        const queued = queue.find((item) => item.sceneId === scene.id);
        const image = getImageForScene(scene, cached, chapters);
        return {
          sceneId: scene.id,
          label: scene.threadLabel || scene.imageDescription || scene.directorBrief?.composition || sceneLabel(scene.id),
          position: computeSceneWordPosition(scene, chapters),
          cached: Boolean(image),
          current: currentImage?.id === image?.id,
          queuedStatus: queued?.status ?? "-",
        };
      })
      .sort((a, b) => a.position - b.position);
  }, [activeSemanticMap, activeStructure, currentImage?.id, imageCache, queue]);

  const currentAnchor =
    [...anchors].reverse().find((anchor) => anchor.position <= wordPosition && anchor.cached) ?? null;
  const nextCachedAnchor =
    anchors.find((anchor) => anchor.cached && anchor.position > wordPosition) ?? null;
  const nextPlannedAnchor =
    anchors.find((anchor) => anchor.position > wordPosition) ?? null;
  const visualEvents = diagnostics
    .filter((entry) => entry.event.startsWith("image."))
    .slice(-12)
    .reverse();

  useEffect(() => {
    const debugState = {
      bookTitle: activeBook?.title ?? null,
      wordPosition,
      currentChapterIndex,
      percentComplete,
      currentImageSceneId: currentImage?.sceneId ?? null,
      currentAnchorSceneId: currentAnchor?.sceneId ?? null,
      currentAnchorPosition: currentAnchor?.position ?? null,
      nextCachedSceneId: nextCachedAnchor?.sceneId ?? null,
      nextCachedPosition: nextCachedAnchor?.position ?? null,
      nextPlannedSceneId: nextPlannedAnchor?.sceneId ?? null,
      nextPlannedPosition: nextPlannedAnchor?.position ?? null,
      cachedCount: anchors.filter((anchor) => anchor.cached).length,
      anchorCount: anchors.length,
      queue,
      anchors,
      visualEvents,
    };
    (window as Window & { __luminaVisualDebug?: typeof debugState }).__luminaVisualDebug = debugState;
    console.info("[LuminaVisualDebug]", debugState);
  }, [
    activeBook?.title,
    anchors,
    currentAnchor,
    currentChapterIndex,
    currentImage?.sceneId,
    nextCachedAnchor,
    nextPlannedAnchor,
    percentComplete,
    queue,
    visualEvents,
    wordPosition,
  ]);

  if (closed) return null;

  return (
    <div className="fixed bottom-3 left-3 right-3 z-[80] max-h-[42vh] overflow-hidden rounded-lg border border-lumina-gold/35 bg-[#06111d]/95 text-sky-100 shadow-2xl shadow-black/60 backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-lumina-gold/20 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-lumina-gold">
            Visual Debug
          </p>
          <p className="truncate text-xs text-sky-100/70">
            {activeBook?.title ?? "No active book"} · word {wordPosition} · chapter {currentChapterIndex + 1} · {percentComplete.toFixed(1)}%
          </p>
        </div>
        <button
          type="button"
          onClick={() => setClosed(true)}
          className="rounded-md border border-white/10 p-2 text-sky-100/70 transition hover:text-sky-100"
          aria-label="Close visual debug"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid max-h-[calc(42vh-48px)] grid-cols-1 gap-3 overflow-auto p-3 text-xs md:grid-cols-[280px_1fr_360px]">
        <section className="rounded-md border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-sky-100/45">Current Decision</p>
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-sky-100/50">Displayed</dt>
              <dd className="truncate text-right text-sky-100">{currentImage?.sceneId ?? "none"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-sky-100/50">Expected</dt>
              <dd className="truncate text-right text-sky-100">{currentAnchor?.sceneId ?? "none"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-sky-100/50">Next cached</dt>
              <dd className="truncate text-right text-sky-100">
                {nextCachedAnchor ? `${nextCachedAnchor.sceneId} @ ${nextCachedAnchor.position}` : "none"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-sky-100/50">Next planned</dt>
              <dd className="truncate text-right text-sky-100">
                {nextPlannedAnchor ? `${nextPlannedAnchor.sceneId} @ ${nextPlannedAnchor.position}` : "none"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-sky-100/50">Generating</dt>
              <dd className="text-right text-sky-100">{isGenerating ? "yes" : "no"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-md border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-sky-100/45">Anchors</p>
          <div className="space-y-1.5">
            {anchors.slice(0, 80).map((anchor) => (
              <div
                key={anchor.sceneId}
                className={`grid grid-cols-[72px_74px_1fr_74px] items-center gap-2 rounded border px-2 py-1.5 ${
                  anchor.current
                    ? "border-lumina-gold/60 bg-lumina-gold/15"
                    : anchor.position <= wordPosition
                      ? "border-sky-200/15 bg-sky-200/5"
                      : "border-white/8 bg-black/10"
                }`}
              >
                <span className="font-mono text-[11px] text-sky-100/70">{anchor.position}</span>
                <span className={anchor.cached ? "text-lumina-gold" : "text-sky-100/35"}>
                  {anchor.cached ? "cached" : "planned"}
                </span>
                <span className="truncate text-sky-100/80" title={anchor.sceneId}>
                  {anchor.label}
                </span>
                <span className="truncate text-right text-sky-100/45">{anchor.queuedStatus}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-sky-100/45">Recent Image Events</p>
          <div className="space-y-2">
            {visualEvents.length === 0 ? (
              <p className="text-sky-100/45">No visual events recorded yet.</p>
            ) : visualEvents.map((entry) => (
              <div key={entry.id} className="rounded border border-white/8 bg-black/15 p-2">
                <div className="flex justify-between gap-3">
                  <span className="font-mono text-[11px] text-lumina-gold">{entry.event}</span>
                  <span className="text-[10px] text-sky-100/35">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-sky-100/60">{entry.message}</p>
                {compactEvent(entry) && (
                  <p className="mt-1 break-words font-mono text-[10px] text-sky-100/45">{compactEvent(entry)}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
