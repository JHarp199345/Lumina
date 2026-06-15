/**
 * Storage-level test for project copy-over: proves cross-project isolation and
 * two-phase non-destructive copy, where the real data-loss risk lives.
 * Run: `npm run test:project`.
 *
 * Uses an in-memory StorageAdapter that mirrors the real adapters' behavior:
 * artifacts are keyed GLOBALLY by id (so an id collision across projects WOULD
 * overwrite — exactly the bug we're guarding against).
 */
import {
  _setProjectStudioStorage, createProject, addSourceToProject, mountProject, copyOverSource,
} from "./projectStudio";
import type { StorageAdapter } from "@/storage/StorageAdapter";
import type { Project, ProjectArtifact, SemanticMap } from "@/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  ok:", name); }
  else { fail++; console.log("  FAIL:", name); }
}

// ── In-memory storage faithfully mirroring real adapter semantics ──────────────
function makeFakeStorage() {
  const projects = new Map<string, Project>();
  const artifacts = new Map<string, ProjectArtifact>(); // GLOBAL by id (like real adapters)

  // Minimal source data for "b1": a couple of scenes so copy-over produces artifacts.
  const map: SemanticMap = {
    bookId: "b1",
    visualPlanVersion: 1,
    arcShape: "rise" as never,
    inflectionPoints: [],
    scenes: [
      { id: "s1", chapterId: "c1", anchor: { spineIndex: 0, wordOffset: 10 }, symbolicMotifs: ["gold"], emotionalVector: ["tense"], atmosphericQualities: ["dim"], imageDescription: "A locket", narrativeWeight: 0.7 } as never,
      { id: "s2", chapterId: "c1", anchor: { spineIndex: 0, wordOffset: 50 }, symbolicMotifs: ["fire"], emotionalVector: ["hope"], atmosphericQualities: ["warm"], imageDescription: "A hearth", narrativeWeight: 0.6 } as never,
    ],
    goldenNumber: 2,
    analyzedAt: "2026-01-01T00:00:00Z",
  } as SemanticMap;

  const fake: Partial<StorageAdapter> = {
    loadSemanticMap: async (id) => (id === "b1" ? map : null),
    loadSourceProfile: async () => null,
    loadBookStructure: async () => ({ bookId: "b1", title: "Book One", chapters: [{ id: "c1", index: 0, title: "Ch 1", wordCount: 100 }] } as never),
    loadAllBooks: async () => [{ id: "b1", title: "Book One" } as never],
    loadNotes: async () => [],
    loadHighlights: async () => [],
    loadImages: async () => [],
    loadAudioArtifacts: async () => [],
    loadProject: async (id) => projects.get(id) ?? null,
    saveProject: async (p) => { projects.set(p.id, structuredClone(p)); },
    loadProjects: async () => [...projects.values()],
    deleteProject: async (id) => { projects.delete(id); },
    loadProjectArtifacts: async (pid) => [...artifacts.values()].filter((a) => a.projectId === pid).map((a) => structuredClone(a)),
    saveProjectArtifacts: async (list) => { for (const a of list) artifacts.set(a.id, structuredClone(a)); },
    deleteProjectArtifactsForSource: async (pid, src) => {
      for (const [id, a] of artifacts) if (a.projectId === pid && a.sourceBookId === src) artifacts.delete(id);
    },
    deleteProjectArtifactsByIds: async (ids) => { for (const id of ids) artifacts.delete(id); },
  };
  _setProjectStudioStorage(fake as StorageAdapter);
  return { projects, artifacts };
}

(async () => {
  const { artifacts } = makeFakeStorage();

  // Two projects, BOTH including the same book b1.
  const A = await createProject("Project A");
  const B = await createProject("Project B");
  await addSourceToProject(A.id, "b1");
  await addSourceToProject(B.id, "b1");

  const mA = await mountProject(A.id);
  const mB = await mountProject(B.id);

  console.log("cross-project isolation:");
  check("project A got artifacts", (mA?.artifacts.length ?? 0) > 0);
  check("project B got artifacts", (mB?.artifacts.length ?? 0) > 0);

  const idsA = new Set(mA!.artifacts.map((x) => x.id));
  const idsB = new Set(mB!.artifacts.map((x) => x.id));
  const overlap = [...idsA].filter((id) => idsB.has(id));
  check("artifact IDs are disjoint across projects (projectId in id)", overlap.length === 0);
  check("global store holds BOTH projects' artifacts (no overwrite)", artifacts.size === idsA.size + idsB.size);

  // Re-copy A (force) must not touch B's artifacts.
  const bCountBefore = [...artifacts.values()].filter((a) => a.projectId === B.id).length;
  const projA = (await mountProject(A.id))!.project;
  await copyOverSource(projA, "b1", { force: true });
  const bCountAfter = [...artifacts.values()].filter((a) => a.projectId === B.id).length;
  check("re-copying A leaves B's artifacts untouched", bCountBefore === bCountAfter && bCountAfter > 0);

  console.log("idempotent mount:");
  const before = artifacts.size;
  const remount = await mountProject(A.id); // nothing changed → should skip
  check("re-mount skips current source (no re-copy)", remount?.skippedSources.includes("b1") === true);
  check("re-mount did not change stored artifact count", artifacts.size === before);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
