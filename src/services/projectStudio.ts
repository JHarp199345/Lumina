/**
 * projectStudio.ts — PLAN IX v2, Phase 2: the two-bucket memory service.
 *
 * A Project is the cross-book "Writer bucket" (PLANix-v2 §4.2). This module owns:
 *  - project CRUD,
 *  - COPY-OVER: snapshotting a source book's reader-memory artifacts into the
 *    project as `ProjectArtifact`s (never duplicating full book text),
 *  - IDEMPOTENT mount: a per-source content signature so re-entering a built,
 *    current project does NOT re-copy/re-analyze (PLANix-v2 §4.3).
 *
 * Enrichment (embeddings, tag index, cross-source relations) is layered on in
 * Phase 3 (analyze) — this phase produces the raw, structured artifact set.
 *
 * NOTE: this is the cross-book bucket. It reads each source's isolated reader
 * memory and copies SNAPSHOTS in. It must never write back into reader memory.
 */

import { storage } from "@/storage";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import type {
  Book,
  Project,
  ProjectIntent,
  ProjectArtifact,
  ProjectArtifactType,
  ProjectSourceSnapshot,
  SemanticMap,
  SourceIntelligenceProfile,
  Chapter,
} from "@/types";

const PROJECT_ANALYSIS_VERSION = 1;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clean(s = ""): string {
  return s.replace(/\s+/g, " ").trim();
}

function uniq(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())).map((v) => v.trim()))];
}

/** Dense, skimmable header — the cheap Tier-1 "tag gate" key (PLANix-v2 §7.1). */
function buildDescriptor(type: ProjectArtifactType, title: string, tags: string[]): string {
  return clean(`${type} · ${title} · ${tags.slice(0, 8).join(", ")}`);
}

// ── Source content signature (drives idempotent mount) ─────────────────────────

/**
 * A cheap, stable signature of a source book's current analysis. If a source's
 * signature matches the snapshot stored on the project, the copy is current and
 * we skip re-copy/re-analyze. Changes when the book is re-ingested or re-analyzed.
 */
export async function sourceSignature(bookId: string): Promise<{ version: number; hash: string } | null> {
  const map = await storage.loadSemanticMap(bookId).catch(() => null);
  if (!map) return null;
  const version = map.visualPlanVersion ?? 0;
  const parts = [
    bookId,
    map.analyzedAt ?? "",
    String(map.scenes?.length ?? 0),
    map.bookProfile?.builtAt ?? "",
  ];
  return { version, hash: parts.join("|") };
}

function isSourceCurrent(project: Project, bookId: string, sig: { version: number; hash: string } | null): boolean {
  const snap = project.sourceSnapshots[bookId];
  if (!snap || !sig) return false;
  return snap.analysisVersion === sig.version && snap.hash === sig.hash;
}

// ── Project CRUD ───────────────────────────────────────────────────────────────

export async function createProject(name: string, intent: ProjectIntent = {}): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    id: newId("proj"),
    name: clean(name) || "Untitled Project",
    createdAt: now,
    updatedAt: now,
    sourceBookIds: [],
    intent,
    sourceSnapshots: {},
    analysisStatus: "empty",
  };
  await storage.saveProject(project);
  return project;
}

export async function addSourceToProject(projectId: string, bookId: string): Promise<Project | null> {
  const project = await storage.loadProject(projectId);
  if (!project) return null;
  if (!project.sourceBookIds.includes(bookId)) {
    project.sourceBookIds = [...project.sourceBookIds, bookId];
    project.analysisStatus = project.analysisStatus === "complete" ? "partial" : project.analysisStatus;
    project.updatedAt = new Date().toISOString();
    await storage.saveProject(project);
  }
  return project;
}

export async function removeSourceFromProject(projectId: string, bookId: string): Promise<Project | null> {
  const project = await storage.loadProject(projectId);
  if (!project) return null;
  project.sourceBookIds = project.sourceBookIds.filter((id) => id !== bookId);
  delete project.sourceSnapshots[bookId];
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);
  await storage.deleteProjectArtifactsForSource(projectId, bookId).catch(() => {});
  return project;
}

export async function updateProjectIntent(projectId: string, intent: Partial<ProjectIntent>): Promise<Project | null> {
  const project = await storage.loadProject(projectId);
  if (!project) return null;
  project.intent = { ...project.intent, ...intent };
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);
  return project;
}

// ── Copy-over: source reader memory → project artifacts (snapshots) ────────────

function chapterStartWords(chapters: Chapter[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const ch of chapters) {
    starts[ch.index] = cursor;
    cursor += ch.wordCount;
  }
  return starts;
}

function buildSourceArtifacts(params: {
  projectId: string;
  bookId: string;
  bookTitle: string;
  map: SemanticMap | null;
  profile: SourceIntelligenceProfile | null;
  chapters: Chapter[];
}): ProjectArtifact[] {
  const { projectId, bookId, bookTitle, map, profile, chapters } = params;
  const out: ProjectArtifact[] = [];
  const push = (
    type: ProjectArtifactType,
    title: string,
    summary: string,
    tags: Array<string | undefined | null>,
    extra: Partial<ProjectArtifact> = {}
  ) => {
    const t = clean(title);
    if (!t) return;
    const visibleTags = uniq(tags);
    out.push({
      id: newId("pa"),
      projectId,
      sourceBookId: bookId,
      type,
      title: t,
      descriptor: buildDescriptor(type, `${t} (${bookTitle})`, visibleTags),
      summary: clean(summary).slice(0, 600),
      visibleTags,
      hiddenTags: uniq([bookTitle, ...visibleTags]),
      weight: 0.6,
      ...extra,
    });
  };

  // Themes / concepts (from the Source Intelligence Profile + Book Profile)
  for (const theme of uniq([
    ...(profile?.concepts.themes ?? []),
    ...(map?.bookProfile?.intelligence.themes ?? []),
  ])) {
    push("theme", theme, `A central theme in ${bookTitle}.`, ["theme", theme], { weight: 0.7 });
  }
  for (const term of uniq(profile?.concepts.keyTerms ?? []).slice(0, 24)) {
    push("concept", term, `Key term/concept from ${bookTitle}.`, ["concept", term], { weight: 0.5 });
  }

  // Entities (people/factions/places) from the SIP
  for (const entity of profile?.entities ?? []) {
    push(
      entity.type === "character" ? "character" : "concept",
      entity.name,
      clean(`${entity.role ?? ""} ${entity.relationships?.map((r) => `${r.nature ?? ""} ${r.to ?? ""}`).join("; ") ?? ""}`),
      ["entity", entity.type, entity.name],
      { weight: 0.72 }
    );
  }

  // Visual-lore entities (rich visual descriptors)
  for (const e of map?.visualLore?.entities ?? []) {
    push(
      "character",
      e.name,
      clean([e.silhouette, e.canonicalTraits.slice(0, 5).join(", "), e.sceneUse].filter(Boolean).join(". ")),
      ["visual lore", e.category, e.name, ...e.aliases],
      { weight: e.confidence ?? 0.6 }
    );
  }

  // Scene/passage anchors — pointers + summaries, NOT full text (pull live later)
  const starts = chapterStartWords(chapters);
  for (const scene of map?.scenes ?? []) {
    const position = chapters.length ? computeSceneWordPosition(scene, chapters) : undefined;
    const chapter = chapters.find((c) => c.id === scene.chapterId);
    const title = scene.publicVisualBrief?.title || scene.threadLabel || scene.imageDescription || "Scene";
    push(
      "passage",
      title,
      clean(
        [scene.publicVisualBrief?.expectedDepiction, scene.directorBrief?.composition, scene.imageDescription]
          .filter(Boolean)
          .join(" ")
      ),
      ["passage", scene.threadLabel, ...scene.symbolicMotifs, ...scene.emotionalVector, ...scene.atmosphericQualities],
      {
        weight: scene.narrativeWeight ?? 0.6,
        startWord: position,
        endWord: position !== undefined ? position + 600 : undefined,
        locator:
          chapter !== undefined && starts[chapter.index] !== undefined
            ? `lumina://chapter/${chapter.index}/page/0`
            : undefined,
      }
    );
  }

  return out;
}

/**
 * Copy a single source's reader-memory artifacts into the project. Idempotent:
 * skips when the source signature already matches the stored snapshot, unless
 * `force`. Returns the number of artifacts written (or -1 when skipped as current).
 */
export async function copyOverSource(project: Project, bookId: string, opts: { force?: boolean } = {}): Promise<number> {
  const sig = await sourceSignature(bookId);
  if (!opts.force && isSourceCurrent(project, bookId, sig)) return -1;

  const [map, profile, structure, books] = await Promise.all([
    storage.loadSemanticMap(bookId).catch(() => null),
    storage.loadSourceProfile(bookId).catch(() => null),
    storage.loadBookStructure(bookId).catch(() => null),
    storage.loadAllBooks().catch(() => [] as Book[]),
  ]);
  const bookTitle = books.find((b) => b.id === bookId)?.title || profile?.identity.title || map?.bookProfile?.identity.title || "Book";
  const chapters = structure?.chapters ?? [];

  const artifacts = buildSourceArtifacts({ projectId: project.id, bookId, bookTitle, map, profile, chapters });

  // Replace this source's artifacts (clean re-copy), then write the fresh set.
  await storage.deleteProjectArtifactsForSource(project.id, bookId).catch(() => {});
  if (artifacts.length) await storage.saveProjectArtifacts(artifacts);

  const snap: ProjectSourceSnapshot = {
    analysisVersion: sig?.version ?? PROJECT_ANALYSIS_VERSION,
    hash: sig?.hash ?? `${bookId}|nomap`,
    copiedAt: new Date().toISOString(),
  };
  project.sourceSnapshots[bookId] = snap;
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  return artifacts.length;
}

// ── Mount (idempotent) ─────────────────────────────────────────────────────────

export interface MountedProject {
  project: Project;
  artifacts: ProjectArtifact[];
  copiedSources: string[];   // sources that were (re)copied this mount
  skippedSources: string[];  // sources already current (idempotency win)
}

/**
 * Bring a project's working memory up to date and return it. Only sources whose
 * signature is missing/stale are copied; current sources are skipped untouched.
 * This is the "never re-do settled work" guarantee (PLANix-v2 §2.5, §4.3).
 */
export async function mountProject(projectId: string, opts: { force?: boolean } = {}): Promise<MountedProject | null> {
  const project = await storage.loadProject(projectId);
  if (!project) return null;

  const copiedSources: string[] = [];
  const skippedSources: string[] = [];
  let anyFailed = false;

  for (const bookId of project.sourceBookIds) {
    try {
      const n = await copyOverSource(project, bookId, opts);
      if (n === -1) skippedSources.push(bookId);
      else copiedSources.push(bookId);
    } catch {
      anyFailed = true;
    }
  }

  project.analysisStatus = anyFailed
    ? "partial"
    : project.sourceBookIds.length === 0
      ? "empty"
      : "complete";
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  const artifacts = await storage.loadProjectArtifacts(projectId);
  return { project, artifacts, copiedSources, skippedSources };
}

/** True when every attached source's copy is current (no mount work needed). */
export async function isProjectCurrent(projectId: string): Promise<boolean> {
  const project = await storage.loadProject(projectId);
  if (!project) return false;
  for (const bookId of project.sourceBookIds) {
    const sig = await sourceSignature(bookId);
    if (!isSourceCurrent(project, bookId, sig)) return false;
  }
  return true;
}
