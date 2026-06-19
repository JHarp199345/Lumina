/**
 * Skill memory — lightweight localStorage-backed learning system for Audio Overview.
 *
 * Stores outcomes of each generation run and user quality ratings. Before each new
 * generation, `getLearnedStrategy()` returns calibrated hints derived from past runs —
 * how many expansion loops were needed, what word targets actually landed on time, what
 * users said was good or bad. Over time the pipeline self-tunes toward the user's standards.
 */

const STORAGE_KEY = "lk_skill_memories_v1";
const MAX_MEMORIES = 60;

export type OverallQuality = "excellent" | "good" | "ok" | "poor";

export interface SkillRating {
  duration: number;   // 1–5: how close to the target length
  coverage: number;   // 1–5: covered key concepts fully
  depth: number;      // 1–5: ideas developed, not just named
  flow: number;       // 1–5: sounded natural as spoken audio
  notes: string;
  overall: OverallQuality;
  ratedAt: number;
}

export interface SkillMemory {
  id: string;           // matches AudioArtifact.id
  taskType: "audio_overview";
  timestamp: number;
  params: {
    targetMinutes: number;
    targetWords: number;
    numSegments: number;
  };
  results: {
    actualMinutes: number;
    actualWords: number;
    expansionLoops: number;
  };
  rating?: SkillRating;
  lessons: string[];   // auto-derived from results + user notes
}

// ── Storage ────────────────────────────────────────────────────────────────────

function _load(): SkillMemory[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SkillMemory[];
  } catch {
    return [];
  }
}

function _save(memories: SkillMemory[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories.slice(-MAX_MEMORIES)));
}

// ── Lesson derivation ──────────────────────────────────────────────────────────

function _derive(memory: SkillMemory): string[] {
  const lessons: string[] = [];
  const { results, params, rating } = memory;

  const wordRatio = params.targetWords > 0 ? results.actualWords / params.targetWords : 1;

  if (wordRatio < 0.97) {
    lessons.push(
      `For a ${params.targetMinutes}-min overview the script reached ${Math.round(wordRatio * 100)}% of target — expand until at least 97%`
    );
  }
  if (results.expansionLoops >= 1) {
    lessons.push(`Needed ${results.expansionLoops} expansion loop(s) to approach target length`);
  }
  if (rating) {
    if (rating.duration <= 2) lessons.push("Duration was significantly off — push harder on word count");
    if (rating.depth <= 2)    lessons.push("Depth was poor — elaborate each concept with examples, not just names");
    if (rating.flow <= 2)     lessons.push("Flow was poor — watch for meta-commentary or abrupt transitions");
    if (rating.coverage <= 2) lessons.push("Coverage was poor — ensure all key concepts from the analysis are addressed");
    if (rating.notes.trim())  lessons.push(`User feedback: "${rating.notes.trim()}"`);
  }

  return lessons;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Record a completed generation run. Returns the memory object. */
export function recordSkillRun(
  artifactId: string,
  params: SkillMemory["params"],
  results: SkillMemory["results"]
): SkillMemory {
  const memory: SkillMemory = {
    id: artifactId,
    taskType: "audio_overview",
    timestamp: Date.now(),
    params,
    results,
    lessons: [],
  };
  memory.lessons = _derive(memory);
  _save([..._load(), memory]);
  return memory;
}

/** Attach a user quality rating to an existing run and re-derive lessons. */
export function rateSkillRun(artifactId: string, rating: SkillRating): void {
  const all = _load();
  const idx = all.findIndex((m) => m.id === artifactId);
  if (idx === -1) return;
  const updated = { ...all[idx], rating };
  updated.lessons = _derive(updated);
  all[idx] = updated;
  _save(all);
}

/** Load a single memory by artifact id. Returns null if not found. */
export function getSkillMemory(artifactId: string): SkillMemory | null {
  return _load().find((m) => m.id === artifactId) ?? null;
}

/** All memories, most recent first. */
export function getAllSkillMemories(): SkillMemory[] {
  return _load().slice().reverse();
}

// ── Strategy derivation ────────────────────────────────────────────────────────

export interface LearnedStrategy {
  /** Lessons to inject into the narrator prompt as context. */
  lessons: string[];
  /** How many expansion loops to plan for (based on past runs). */
  expectedExpansionLoops: number;
  /** Calibration: if past first-passes land short, how many loops to cap at. */
  maxExpansionLoops: number;
}

const QUALITY_SCORE: Record<OverallQuality, number> = {
  excellent: 5,
  good: 4,
  ok: 2,
  poor: 0,
};

/**
 * Derive the best strategy for the next generation from accumulated memories.
 * Called before each new generation to inject learned context.
 */
export function getLearnedStrategy(): LearnedStrategy {
  const all = _load().filter((m) => m.taskType === "audio_overview");
  if (all.length === 0) {
    return { lessons: [], expectedExpansionLoops: 3, maxExpansionLoops: 6 };
  }

  const recent = all.slice(-15);

  // Average expansion loops from recent runs
  const avgLoops = recent.reduce((a, b) => a + b.results.expansionLoops, 0) / recent.length;
  const expectedExpansionLoops = Math.max(3, Math.ceil(avgLoops));
  const maxExpansionLoops = Math.max(expectedExpansionLoops + 2, 6);

  // Collect lessons from top-rated + recent, deduped
  const rated = all
    .filter((m) => m.rating)
    .sort((a, b) => QUALITY_SCORE[b.rating!.overall] - QUALITY_SCORE[a.rating!.overall]);

  const seen = new Set<string>();
  const lessons: string[] = [];
  for (const m of [...rated.slice(0, 4), ...recent.slice(-4)]) {
    for (const l of m.lessons) {
      if (!seen.has(l) && lessons.length < 6) {
        seen.add(l);
        lessons.push(l);
      }
    }
  }

  return { lessons, expectedExpansionLoops, maxExpansionLoops };
}
