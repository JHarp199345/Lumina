/**
 * Narrative Threading Pass
 *
 * One book-wide Gemini call that reads the chapter map + emotional arc and
 * returns the book's setup → payoff structure as a set of NarrativeThreads.
 *
 * This is the spine that makes image selection narrative-aware: instead of
 * picking the highest-sentiment scenes, Lumina picks scenes that complete
 * dramatic chains (a promise and its keeping, a mystery and its reveal, an
 * object introduced and made decisive) and carries a recurring visual motif
 * across each thread so the images rhyme.
 *
 * Everything downstream reads the result off the scenes themselves
 * (threadId / threadRole / threadMotif), so the plan is a shared artifact
 * every later stage is aware of.
 */

import { LUMINA_CONFIG } from "@/config";
import type {
  AnalysisProgressReporter,
  BookStructure,
  IdentifiedScene,
  MacroArc,
  NarrativeBlueprint,
  NarrativeThread,
  ThreadKind,
  ThreadNode,
  ThreadRole,
} from "@/types";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const THREAD_KINDS: ThreadKind[] = [
  "promise",
  "mystery",
  "object",
  "relationship",
  "transformation",
  "conflict",
  "motif",
];

const THREAD_ROLES: ThreadRole[] = ["setup", "build", "payoff", "cost", "echo"];

// Higher = more important to illustrate. Used both for selection scoring and
// for resolving which thread "owns" a scene when several overlap.
const ROLE_PRIORITY: Record<ThreadRole, number> = {
  payoff: 5,
  cost: 4,
  setup: 3,
  echo: 2,
  build: 1,
};

const ROLE_SELECTION_BONUS: Record<ThreadRole, number> = {
  payoff: 0.42,
  cost: 0.32,
  setup: 0.26,
  echo: 0.16,
  build: 0.10,
};

// ─── Pass: build the blueprint ────────────────────────────────────────────────

export async function buildNarrativeBlueprint(params: {
  structure: BookStructure;
  macroArc: MacroArc;
  apiKey: string;
  onProgress?: AnalysisProgressReporter;
}): Promise<NarrativeBlueprint | undefined> {
  const { structure, macroArc, apiKey } = params;

  params.onProgress?.({
    phase: "mapping",
    message: "Tracing the book's setup-and-payoff threads…",
    percent: 42,
  });

  try {
    const prompt = buildBlueprintPrompt(structure, macroArc);
    const raw = await callGemini(prompt, apiKey, 2400);
    const parsed = parseJsonResponse<Partial<NarrativeBlueprint>>(raw);
    const blueprint = normalizeBlueprint(structure.bookId, parsed, structure.chapters.length);

    diagnosticInfo("narrative_threads.complete", "Narrative blueprint created", {
      bookId: structure.bookId,
      threads: blueprint.threads.length,
      nodes: blueprint.threads.reduce((sum, t) => sum + t.nodes.length, 0),
    });
    return blueprint;
  } catch (err) {
    diagnosticError("narrative_threads.failed", "Narrative threading failed", {
      bookId: structure.bookId,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
    // No blueprint → selection degrades gracefully to weight-based.
    return undefined;
  }
}

function buildBlueprintPrompt(structure: BookStructure, macroArc: MacroArc): string {
  const chapterMap = structure.chapters
    .map((ch) => `${ch.index}. "${ch.title}": ${(ch.rawText ?? "").split(/\s+/).slice(0, 38).join(" ")}`)
    .join("\n")
    .slice(0, 60000);

  return `You are the narrative architect for an illustrated reader. Map the SETUP → PAYOFF structure of this book so an illustrator can choose images that build toward meaningful moments instead of random highlights.

A thread is a dramatic line that spans the book: a promise made then kept or broken, a mystery planted then revealed, an object introduced then made decisive, a bond formed then tested, a transformation, an escalating conflict, or a recurring motif that accrues meaning.

For each thread, give ordered nodes with roles:
- setup: where it is planted
- build: where it escalates (optional, 0-2)
- payoff: where it lands / is delivered
- cost: the price paid for the payoff (optional)
- echo: a final callback (optional)

Each node must carry a single recurring VISUAL MOTIF — a concrete image (an object, a place, a gesture, a light) that can recur across the thread's images so they visually rhyme.

BOOK: "${structure.title}" by ${structure.author}
Arc shape: ${macroArc.arcShape}
Dominant emotions: ${macroArc.dominantEmotions.join(", ") || "unknown"}
Central themes: ${macroArc.centralThemes.join(", ") || "unknown"}
Total chapters: ${structure.chapters.length}

CHAPTER MAP (index, title, opening words):
${chapterMap}

Identify the 3-7 strongest threads. Prefer threads whose setup and payoff are both clearly locatable in the chapter map. Keep approximateChapterIndex within 0..${structure.chapters.length - 1}.

Return JSON only:
{
  "throughLine": "one sentence describing the book's core dramatic movement",
  "threads": [
    {
      "label": "short human-readable thread name",
      "kind": one of ${JSON.stringify(THREAD_KINDS)},
      "centralMotif": "the recurring visual element for this thread",
      "nodes": [
        {
          "role": one of ${JSON.stringify(THREAD_ROLES)},
          "approximateChapterIndex": 0,
          "description": "what happens at this point",
          "visualMotif": "concrete recurring image for this node"
        }
      ]
    }
  ]
}`;
}

function normalizeBlueprint(
  bookId: string,
  raw: Partial<NarrativeBlueprint>,
  chapterCount: number
): NarrativeBlueprint {
  const threads = Array.isArray(raw.threads)
    ? raw.threads
        .map((thread, index) => normalizeThread(thread, index, chapterCount))
        .filter((thread): thread is NarrativeThread => thread !== null)
    : [];

  return {
    bookId,
    generatedAt: new Date().toISOString(),
    throughLine: stringOr(raw.throughLine, ""),
    threads,
  };
}

function normalizeThread(
  raw: Partial<NarrativeThread>,
  index: number,
  chapterCount: number
): NarrativeThread | null {
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((node) => normalizeNode(node, chapterCount))
        .filter((node): node is ThreadNode => node !== null)
        .sort((a, b) => a.approximateChapterIndex - b.approximateChapterIndex)
    : [];

  if (nodes.length === 0) return null;

  const label = stringOr(raw.label, `Thread ${index + 1}`);
  return {
    id: `thread_${index}_${slug(label)}`,
    label,
    kind: enumOr(raw.kind, THREAD_KINDS, "conflict"),
    centralMotif: stringOr(raw.centralMotif, nodes[0]?.visualMotif ?? ""),
    nodes,
  };
}

function normalizeNode(raw: Partial<ThreadNode>, chapterCount: number): ThreadNode | null {
  const role = enumOr(raw.role, THREAD_ROLES, "setup");
  const idx = typeof raw.approximateChapterIndex === "number" ? Math.round(raw.approximateChapterIndex) : NaN;
  if (Number.isNaN(idx)) return null;
  return {
    role,
    approximateChapterIndex: Math.max(0, Math.min(chapterCount - 1, idx)),
    description: stringOr(raw.description, ""),
    visualMotif: stringOr(raw.visualMotif, ""),
  };
}

// ─── Annotate scenes with thread membership ───────────────────────────────────
//
// For each scene, find the nearest thread node by chapter proximity and stamp
// the scene with that thread's id / role / motif. This is what makes the plan a
// shared artifact: every downstream stage reads thread membership off the scene.

export function annotateScenesWithThreads(
  scenes: IdentifiedScene[],
  blueprint: NarrativeBlueprint | undefined,
  structure: BookStructure
): IdentifiedScene[] {
  if (!blueprint || blueprint.threads.length === 0) return scenes;

  const chapterIndexById = new Map<string, number>();
  structure.chapters.forEach((ch) => chapterIndexById.set(ch.id, ch.index));

  return scenes.map((scene) => {
    const sceneChapter = chapterIndexById.get(scene.chapterId);
    if (sceneChapter === undefined) return scene;

    let best: { thread: NarrativeThread; node: ThreadNode; distance: number } | null = null;

    for (const thread of blueprint.threads) {
      for (const node of thread.nodes) {
        const distance = Math.abs(node.approximateChapterIndex - sceneChapter);
        if (distance > 1) continue; // only claim a scene within one chapter of a node
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance && ROLE_PRIORITY[node.role] > ROLE_PRIORITY[best.node.role])
        ) {
          best = { thread, node, distance };
        }
      }
    }

    if (!best) return scene;
    return {
      ...scene,
      threadId: best.thread.id,
      threadRole: best.node.role,
      threadMotif: best.node.visualMotif || best.thread.centralMotif,
      threadLabel: best.thread.label,
    };
  });
}

// ─── Structure-aware selection ────────────────────────────────────────────────
//
// Replaces "sort by sentiment, take top N". Scores scenes by narrative role,
// then runs a chain-repair pass so a selected payoff pulls in its setup —
// images that build toward something, not isolated highlights.

export function selectNarrativeScenes(
  scenes: IdentifiedScene[],
  goldenNumber: number,
  blueprint: NarrativeBlueprint | undefined
): IdentifiedScene[] {
  if (scenes.length <= goldenNumber) return sortByReadingOrder(scenes);

  const opening = scenes.find((s) => s.inflectionPointId === "opening");
  const rest = scenes.filter((s) => s.inflectionPointId !== "opening");
  const budget = goldenNumber - (opening ? 1 : 0);

  // Static score: emotional weight + narrative-role bonus.
  const scored = rest
    .map((scene) => ({ scene, score: scoreScene(scene) }))
    .sort((a, b) => b.score - a.score);

  const selected = new Set<string>(scored.slice(0, budget).map((s) => s.scene.id));

  // Chain repair: for each selected payoff/cost on a thread, make sure at least
  // one earlier node (setup/build) of that thread is also selected. If not, swap
  // the lowest-scoring selected scene that is NOT on any thread for the setup.
  if (blueprint) {
    repairChains(scored, selected, blueprint, budget);
  }

  const finalRest = rest.filter((s) => selected.has(s.id));
  return sortByReadingOrder([...(opening ? [opening] : []), ...finalRest]);
}

export function scoreScene(scene: IdentifiedScene): number {
  const base = scene.narrativeWeight;
  const roleBonus = scene.threadRole ? ROLE_SELECTION_BONUS[scene.threadRole] : 0;
  return base + roleBonus;
}

function repairChains(
  scored: { scene: IdentifiedScene; score: number }[],
  selected: Set<string>,
  blueprint: NarrativeBlueprint,
  budget: number,
): void {
  void blueprint; // reserved for future thread-aware repair weighting
  const selectedScenes = () => scored.filter((s) => selected.has(s.scene.id));

  // Threads that have a selected payoff/cost but no selected setup/build.
  const threadsNeedingSetup = new Set<string>();
  for (const { scene } of selectedScenes()) {
    if (scene.threadId && (scene.threadRole === "payoff" || scene.threadRole === "cost")) {
      threadsNeedingSetup.add(scene.threadId);
    }
  }
  for (const { scene } of selectedScenes()) {
    if (scene.threadId && (scene.threadRole === "setup" || scene.threadRole === "build")) {
      threadsNeedingSetup.delete(scene.threadId);
    }
  }

  let repairs = 0;
  const maxRepairs = Math.max(1, Math.floor(budget / 2)); // don't let repair dominate

  for (const threadId of threadsNeedingSetup) {
    if (repairs >= maxRepairs) break;

    // Best available setup/build candidate for this thread, not already selected.
    const setupCandidate = scored
      .filter(
        (s) =>
          !selected.has(s.scene.id) &&
          s.scene.threadId === threadId &&
          (s.scene.threadRole === "setup" || s.scene.threadRole === "build")
      )
      .sort((a, b) => b.score - a.score)[0];
    if (!setupCandidate) continue;

    // Lowest-scoring selected scene that is not on any thread (safe to drop).
    const droppable = selectedScenes()
      .filter((s) => !s.scene.threadId)
      .sort((a, b) => a.score - b.score)[0];
    if (!droppable) continue;

    // Swap the throwaway scene for the setup so the payoff has something to land.
    selected.delete(droppable.scene.id);
    selected.add(setupCandidate.scene.id);
    repairs += 1;
  }
}

function sortByReadingOrder(scenes: IdentifiedScene[]): IdentifiedScene[] {
  return [...scenes].sort((a, b) => {
    if (a.inflectionPointId === "opening") return -1;
    if (b.inflectionPointId === "opening") return 1;
    return a.anchor.spineIndex - b.anchor.spineIndex || a.anchor.wordOffset - b.anchor.wordOffset;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callGemini(prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini narrative threading error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
}

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  return JSON.parse(cleaned) as T;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "thread";
}
