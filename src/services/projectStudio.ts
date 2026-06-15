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
  Note,
  Highlight,
  CachedImage,
  AudioArtifact,
} from "@/types";

const PROJECT_ANALYSIS_VERSION = 1;
// Bump when the copy-over artifact shape/extraction changes, so existing projects
// recognize their copies as stale and rebuild. Part of the source signature (#5).
const COPY_SCHEMA_VERSION = 2;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
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
  // Gather cheap staleness signals from EVERY store copy-over reads, not just the
  // semantic map — otherwise editing notes/highlights or rebuilding the profile
  // leaves the project showing a stale copy. (Codex review #5.)
  const [map, profile, notes, highlights, images] = await Promise.all([
    storage.loadSemanticMap(bookId).catch(() => null),
    storage.loadSourceProfile(bookId).catch(() => null),
    storage.loadNotes(bookId).catch(() => []),
    storage.loadHighlights(bookId).catch(() => []),
    storage.loadImages(bookId).catch(() => []),
  ]);
  // Nothing to copy from at all → no signature (caller treats as "no source data").
  if (!map && !profile && notes.length === 0 && highlights.length === 0 && images.length === 0) {
    return null;
  }
  const version = COPY_SCHEMA_VERSION;
  const latest = (items: Array<{ updatedAt?: string; createdAt?: string }>): string =>
    items.reduce((m, n) => {
      const t = n.updatedAt || n.createdAt || "";
      return t > m ? t : m;
    }, "");
  const parts = [
    `schema:${COPY_SCHEMA_VERSION}`,
    `map:${map?.visualPlanVersion ?? 0}:${map?.analyzedAt ?? ""}:${map?.scenes?.length ?? 0}`,
    `profile:${profile?.builtAt ?? ""}`,
    `bookProfile:${map?.bookProfile?.builtAt ?? ""}`,
    `notes:${notes.length}:${latest(notes)}`,
    `highlights:${highlights.length}`,
    `images:${images.length}`,
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

interface SourceBundle {
  map: SemanticMap | null;
  profile: SourceIntelligenceProfile | null;
  chapters: Chapter[];
  notes: Note[];
  highlights: Highlight[];
  images: CachedImage[];
  audio: AudioArtifact[];
}

function buildSourceArtifacts(params: {
  projectId: string;
  bookId: string;
  bookTitle: string;
  bundle: SourceBundle;
}): ProjectArtifact[] {
  const { projectId, bookId, bookTitle } = params;
  const { map, profile, chapters, notes, highlights, images, audio } = params.bundle;
  const out: ProjectArtifact[] = [];
  // Deterministic id from (book, type, key) so a re-copy overwrites the same
  // artifact in place (no duplicates) and stale ids are detectable (Codex #4).
  const push = (
    type: ProjectArtifactType,
    title: string,
    summary: string,
    tags: Array<string | undefined | null>,
    extra: Partial<ProjectArtifact> = {},
    key?: string
  ) => {
    const t = clean(title);
    if (!t) return;
    const visibleTags = uniq(tags);
    out.push({
      id: `pa_${stableId(`${bookId}:${type}:${key ?? t}`)}`,
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
    push("theme", theme, `A central theme in ${bookTitle}.`, ["theme", theme], { weight: 0.7 }, theme);
  }
  for (const term of uniq(profile?.concepts.keyTerms ?? []).slice(0, 24)) {
    push("concept", term, `Key term/concept from ${bookTitle}.`, ["concept", term], { weight: 0.5 }, term);
  }

  // Entities (people/factions/places) from the SIP
  for (const entity of profile?.entities ?? []) {
    push(
      entity.type === "character" ? "character" : "concept",
      entity.name,
      clean(`${entity.role ?? ""} ${entity.relationships?.map((r) => `${r.nature ?? ""} ${r.to ?? ""}`).join("; ") ?? ""}`),
      ["entity", entity.type, entity.name],
      { weight: 0.72 },
      `sip:${entity.name}`
    );
  }

  // Visual-lore entities (rich visual descriptors)
  for (const e of map?.visualLore?.entities ?? []) {
    push(
      "character",
      e.name,
      clean([e.silhouette, e.canonicalTraits.slice(0, 5).join(", "), e.sceneUse].filter(Boolean).join(". ")),
      ["visual lore", e.category, e.name, ...e.aliases],
      { weight: e.confidence ?? 0.6 },
      `lore:${e.name}`
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
      },
      `scene:${scene.id}`
    );
  }

  // Reader's own notes (their thinking — high value for a project)
  for (const note of notes) {
    const body = clean(note.noteText);
    if (!body) continue;
    push(
      "note",
      body.split(/[.!?]/)[0].slice(0, 80) || "Note",
      clean([body, note.sourceExcerpt].filter(Boolean).join(" — ")),
      ["note", "reader"],
      { weight: 0.85 },
      note.id
    );
  }

  // Highlighted passages (reader-marked text)
  for (const h of highlights) {
    const text = clean(h.selectedText);
    if (!text) continue;
    push(
      "passage",
      text.split(/\s+/).slice(0, 8).join(" "),
      text,
      ["passage", "highlight", h.color],
      { weight: 0.7, locator: h.locator, startWord: undefined },
      `hl:${h.id}`
    );
  }

  // Generated images (registry — point at the asset, don't inline bytes)
  for (const img of images) {
    push(
      "image",
      clean(img.descriptionUsed).slice(0, 70) || "Generated image",
      clean(img.visualComposition || img.descriptionUsed),
      ["image", ...(img.emotionalThemes ?? [])],
      { weight: 0.55, storageRef: img.filePath, startWord: img.wordPosition },
      `img:${img.id}`
    );
  }

  // Audio overview / narration artifacts
  for (const a of audio) {
    push(
      "audio",
      clean(a.segmentTitle) || "Audio segment",
      clean(a.segmentTitle),
      ["audio", a.scope, a.mode].filter(Boolean) as string[],
      { weight: 0.5, storageRef: a.filePath, startWord: a.textStartPosition },
      `audio:${a.id}`
    );
  }

  return out;
}

/** Return code for copyOverSource. */
export const COPY_SKIPPED_CURRENT = -1;   // already current — no work done
export const COPY_SKIPPED_NO_DATA = -2;   // source had nothing to copy — old kept

/**
 * Copy a single source's reader-memory artifacts into the project. Idempotent:
 * skips when the source signature matches the snapshot (unless `force`).
 *
 * TWO-PHASE & non-destructive (Codex review #4): it NEVER deletes the existing
 * good copy before the new copy is safely written. New artifacts use deterministic
 * ids, so they overwrite their predecessors in place; only genuinely stale ids
 * (present before, absent now) are deleted AFTER the new set is saved. If the
 * source has no data to copy at all (a failed/empty load), the old copy is left
 * untouched and the snapshot is NOT advanced, so a later good load will refresh.
 *
 * Returns the artifact count, or COPY_SKIPPED_CURRENT / COPY_SKIPPED_NO_DATA.
 */
export async function copyOverSource(project: Project, bookId: string, opts: { force?: boolean } = {}): Promise<number> {
  const sig = await sourceSignature(bookId);
  if (!opts.force && isSourceCurrent(project, bookId, sig)) return COPY_SKIPPED_CURRENT;

  const [map, profile, structure, books, notes, highlights, images, audio] = await Promise.all([
    storage.loadSemanticMap(bookId).catch(() => null),
    storage.loadSourceProfile(bookId).catch(() => null),
    storage.loadBookStructure(bookId).catch(() => null),
    storage.loadAllBooks().catch(() => [] as Book[]),
    storage.loadNotes(bookId).catch(() => [] as Note[]),
    storage.loadHighlights(bookId).catch(() => [] as Highlight[]),
    storage.loadImages(bookId).catch(() => [] as CachedImage[]),
    storage.loadAudioArtifacts(bookId).catch(() => [] as AudioArtifact[]),
  ]);

  const loadedAnything =
    !!map || !!profile || notes.length > 0 || highlights.length > 0 || images.length > 0 || audio.length > 0;
  if (!loadedAnything) {
    // Nothing to copy — do NOT wipe the existing good copy, and do NOT advance the
    // snapshot (so the next mount retries). Non-destructive on incomplete rebuild.
    return COPY_SKIPPED_NO_DATA;
  }

  const bookTitle =
    books.find((b) => b.id === bookId)?.title || profile?.identity.title || map?.bookProfile?.identity.title || "Book";
  const chapters = structure?.chapters ?? [];

  const existingForSource = (await storage.loadProjectArtifacts(project.id).catch(() => [] as ProjectArtifact[]))
    .filter((a) => a.sourceBookId === bookId);

  const artifacts = buildSourceArtifacts({
    projectId: project.id,
    bookId,
    bookTitle,
    bundle: { map, profile, chapters, notes, highlights, images, audio },
  });

  // Phase 1: write the new set (deterministic ids overwrite predecessors in place).
  if (artifacts.length) await storage.saveProjectArtifacts(artifacts);
  // Phase 2: only now remove ids that existed before but are absent from the new set.
  const newIds = new Set(artifacts.map((a) => a.id));
  const staleIds = existingForSource.filter((a) => !newIds.has(a.id)).map((a) => a.id);
  if (staleIds.length) await storage.deleteProjectArtifactsByIds(staleIds).catch(() => {});

  const snap: ProjectSourceSnapshot = {
    analysisVersion: sig?.version ?? PROJECT_ANALYSIS_VERSION,
    hash: sig?.hash ?? `${bookId}|nodata`,
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
  incompleteSources: string[]; // sources with no data to copy (old copy kept)
}

/**
 * Bring a project's working memory up to date and return it. Only sources whose
 * signature is missing/stale are copied; current sources are skipped untouched;
 * sources with no data leave their old copy intact. This is the "never re-do
 * settled work" + "never destroy good memory on incomplete rebuild" guarantee.
 */
export async function mountProject(projectId: string, opts: { force?: boolean } = {}): Promise<MountedProject | null> {
  const project = await storage.loadProject(projectId);
  if (!project) return null;

  const copiedSources: string[] = [];
  const skippedSources: string[] = [];
  const incompleteSources: string[] = [];
  let anyFailed = false;

  for (const bookId of project.sourceBookIds) {
    try {
      const n = await copyOverSource(project, bookId, opts);
      if (n === COPY_SKIPPED_CURRENT) skippedSources.push(bookId);
      else if (n === COPY_SKIPPED_NO_DATA) incompleteSources.push(bookId);
      else copiedSources.push(bookId);
    } catch {
      anyFailed = true;
    }
  }

  project.analysisStatus =
    anyFailed || incompleteSources.length > 0
      ? "partial"
      : project.sourceBookIds.length === 0
        ? "empty"
        : "complete";
  project.updatedAt = new Date().toISOString();
  await storage.saveProject(project);

  const artifacts = await storage.loadProjectArtifacts(projectId);
  return { project, artifacts, copiedSources, skippedSources, incompleteSources };
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
