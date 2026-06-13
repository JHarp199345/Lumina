import { LUMINA_CONFIG } from "@/config";
import type { IdentifiedScene, VisualGenerationJob } from "@/types";

const STORAGE_KEY = "lumina.visualGenerationJobs.v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJobs(): VisualGenerationJob[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as VisualGenerationJob[] : [];
  } catch {
    return [];
  }
}

function writeJobs(jobs: VisualGenerationJob[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Storage can fail in private/limited browsers. Runtime state still works.
  }
}

function isFresh(job: VisualGenerationJob): boolean {
  if (job.status !== "running") return false;
  const updated = new Date(job.updatedAt || job.startedAt).getTime();
  return Number.isFinite(updated) && Date.now() - updated < LUMINA_CONFIG.VISUAL_GENERATION_STALE_MS;
}

export function activeVisualJobForSlot(bookId: string, visualSlotKey?: string | null): VisualGenerationJob | null {
  if (!visualSlotKey) return null;
  const job = readJobs().find(
    (item) => item.bookId === bookId && item.visualSlotKey === visualSlotKey && item.status === "running"
  );
  return job && isFresh(job) ? job : null;
}

export function activeVisualJobsForBook(bookId: string): VisualGenerationJob[] {
  return readJobs().filter((job) => job.bookId === bookId && isFresh(job));
}

export function startVisualJob(params: {
  bookId: string;
  scene: IdentifiedScene;
  visualSlotKey?: string | null;
  wordPosition?: number;
  label?: string;
}): VisualGenerationJob {
  const now = new Date().toISOString();
  const job: VisualGenerationJob = {
    id: `visual_job_${params.bookId}_${params.visualSlotKey ?? params.scene.id}`,
    bookId: params.bookId,
    sceneId: params.scene.id,
    visualSlotKey: params.visualSlotKey ?? undefined,
    wordPosition: params.wordPosition,
    label:
      params.label ||
      params.scene.publicVisualBrief?.title ||
      params.scene.symbolicMotifs.slice(0, 2).join(" + ") ||
      "Visual image",
    status: "running",
    phase: "generating",
    message: "Composing this visual moment...",
    percent: 35,
    startedAt: now,
    updatedAt: now,
  };

  const jobs = readJobs().filter((item) => item.id !== job.id);
  jobs.push(job);
  writeJobs(jobs);
  return job;
}

export function updateVisualJob(id: string, patch: Partial<VisualGenerationJob>): VisualGenerationJob | null {
  const jobs = readJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const next = { ...jobs[index], ...patch, updatedAt: new Date().toISOString() };
  jobs[index] = next;
  writeJobs(jobs);
  return next;
}

export function completeVisualJob(id: string): void {
  const jobs = readJobs().filter((job) => job.id !== id);
  writeJobs(jobs);
}

export function failVisualJob(id: string, error: string): void {
  updateVisualJob(id, {
    status: "failed",
    phase: "saving",
    message: "Image generation failed.",
    percent: 100,
    error,
  });
}
