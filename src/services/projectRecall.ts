/**
 * projectRecall.ts — PLAN IX v2, Phase 3/4: the recall engine.
 *
 * Two parts:
 *  1. Tiered retrieval (pure, fast, in-memory) over the project's artifacts:
 *       Tier 1 — tag gate: drop artifacts whose descriptor/tags don't intersect
 *                the query topic BEFORE any scoring (the "filename" pre-filter).
 *       Tier 2 — cosine: if artifacts carry embeddings AND a query embedding is
 *                supplied, rank by cosine. Optional — skipped when absent.
 *       Tier 3 — intent bias: reweight by the project thesis / current section.
 *       (Base ranker without embeddings = keyword + tag + descriptor overlap.)
 *       Tier 4 (small reranker, explicit-only) is NOT here — it's a later stage.
 *
 *  2. The RecallScheduler: at most ONE recall honored at a time, explicit
 *     preempts-and-sticks, ambient coalesces latest-wins, stale results are
 *     discarded (PLANix-v2 §7.1). Framework-agnostic; the Writer view drives it.
 *
 * No LLM call on ambient recall. Build-once (copy-over/analyze), recall-fast.
 */

import type { ProjectArtifact, ProjectArtifactType, ProjectIntent } from "@/types";

// ── Tokenization + similarity helpers ──────────────────────────────────────────

const STOP = new Set(
  ("the a an and or but of to in on at for with from by as is are was were be been being this that " +
   "these those it its his her their our your my we you they he she i not no into over under about " +
   "than then so such can will would could should may might do does did has have had").split(" ")
);

export function tokenize(text = ""): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── Query + result shapes ──────────────────────────────────────────────────────

export interface RecallQuery {
  projectId: string;            // the project this query belongs to (isolation guard)
  text: string;                 // the current paragraph/section, or the explicit ask
  intent?: ProjectIntent;       // biases ranking toward the project goal
  embedding?: number[];         // optional; enables Tier-2 cosine
  limitPerRow?: number;         // cards per artifact-type row (default 8)
}

export interface RankedArtifact {
  artifact: ProjectArtifact;
  score: number;
}

export interface RecallRow {
  type: ProjectArtifactType;
  items: ProjectArtifact[];
}

export interface RecallResult {
  seq: number;
  projectId: string;            // which project this result is for (never render cross-project)
  priority: "ambient" | "explicit";
  rows: RecallRow[];
}

// Order the artifact-type rows appear in the shelf (Netflix-style, PLANix-v2 §7.2).
const ROW_ORDER: ProjectArtifactType[] = [
  "passage", "note", "theme", "concept", "character", "claim", "image", "audio", "summary",
];

// ── Tiered retrieval (pure) ─────────────────────────────────────────────────────

function intentTokens(intent?: ProjectIntent): Set<string> {
  if (!intent) return new Set();
  return new Set(
    tokenize([intent.thesis, intent.workingTitle, intent.goal, intent.currentSection, ...(intent.keyQuestions ?? [])]
      .filter(Boolean)
      .join(" "))
  );
}

/**
 * Rank a project's artifacts against a query. Returns survivors sorted by score.
 * Tier 1 gate first (cheap), then cosine-or-keyword scoring, then intent bias.
 */
export function recallRank(artifacts: ProjectArtifact[], query: RecallQuery): RankedArtifact[] {
  const qTokens = new Set(tokenize(query.text));
  if (qTokens.size === 0) return [];
  const iTokens = intentTokens(query.intent);
  const useCosine = Boolean(query.embedding?.length);

  const ranked: RankedArtifact[] = [];
  for (const art of artifacts) {
    // Tier 1 — tag gate: the descriptor/tags must intersect the query (or intent).
    const gateTokens = new Set(tokenize(`${art.descriptor} ${art.visibleTags.join(" ")} ${art.hiddenTags.join(" ")}`));
    let tagHits = 0;
    for (const t of qTokens) if (gateTokens.has(t)) tagHits++;
    let intentHits = 0;
    for (const t of iTokens) if (gateTokens.has(t)) intentHits++;
    if (tagHits === 0 && intentHits === 0) continue; // gated out before any scoring

    // Tier 2 — cosine (optional) OR keyword overlap on the summary as the base.
    let base: number;
    if (useCosine && art.embedding?.length) {
      base = cosine(query.embedding!, art.embedding);
    } else {
      const summaryTokens = new Set(tokenize(`${art.title} ${art.summary}`));
      let overlap = 0;
      for (const t of qTokens) if (summaryTokens.has(t)) overlap++;
      base = overlap / Math.max(4, qTokens.size); // 0..1-ish
    }

    // Tier 3 — combine: base relevance + tag-gate strength + intent bias + weight.
    const tagScore = tagHits / Math.max(4, qTokens.size);
    const intentBias = iTokens.size ? intentHits / iTokens.size : 0;
    const score = base * 1.0 + tagScore * 0.6 + intentBias * 0.5 + (art.weight ?? 0.5) * 0.2;

    if (score > 0.12) ranked.push({ artifact: art, score });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

/** Group ranked artifacts into per-type rows for the artifact shelf. */
export function groupIntoRows(ranked: RankedArtifact[], limitPerRow = 8): RecallRow[] {
  const byType = new Map<ProjectArtifactType, ProjectArtifact[]>();
  for (const { artifact } of ranked) {
    const list = byType.get(artifact.type) ?? [];
    if (list.length < limitPerRow) list.push(artifact);
    byType.set(artifact.type, list);
  }
  const rows: RecallRow[] = [];
  for (const type of ROW_ORDER) {
    const items = byType.get(type);
    if (items?.length) rows.push({ type, items });
  }
  // Any types not in ROW_ORDER, appended for completeness.
  for (const [type, items] of byType) {
    if (!ROW_ORDER.includes(type) && items.length) rows.push({ type, items });
  }
  return rows;
}

export function runRecall(artifacts: ProjectArtifact[], query: RecallQuery): RecallRow[] {
  return groupIntoRows(recallRank(artifacts, query), query.limitPerRow ?? 8);
}

// ── The recall scheduler (single-flight, priority, coalesce, cancel-stale) ──────

export type RecallPriority = "ambient" | "explicit";

interface SchedulerOpts {
  /** The project this scheduler serves — results for any other project are dropped. */
  projectId: string;
  /** Live accessor for the current project artifacts (re-read each run). */
  getArtifacts: () => ProjectArtifact[];
  /** Called with the latest honored result; stale/cross-project results never delivered. */
  onResult: (result: RecallResult) => void;
  /** Optional async stage (e.g. a future Tier-4 reranker on explicit asks). */
  rerank?: (rows: RecallRow[], query: RecallQuery, signal: { aborted: boolean }) => Promise<RecallRow[]>;
  ambientDebounceMs?: number;   // coalesce window for ambient triggers (default 400)
  explicitStickyMs?: number;    // suppress ambient after an explicit ask (default 6000)
}

export class RecallScheduler {
  private seq = 0;
  private honoredSeq = 0;        // the latest result allowed to render
  private running = false;
  private pending: { getQuery: () => RecallQuery; priority: RecallPriority } | null = null;
  private stickyUntil = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private opts: SchedulerOpts) {}

  /** Ambient trigger. `getQuery` is evaluated at run time so it reflects NOW. */
  requestAmbient(getQuery: () => RecallQuery): void {
    if (this.disposed) return;
    if (Date.now() < this.stickyUntil) return;           // explicit result is pinned
    this.pending = { getQuery, priority: "ambient" };    // latest-wins coalescing
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.drain(), this.opts.ambientDebounceMs ?? 400);
  }

  /** Explicit ask — preempts, runs now, and pins the result for a short window. */
  requestExplicit(query: RecallQuery): void {
    if (this.disposed) return;
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.stickyUntil = Date.now() + (this.opts.explicitStickyMs ?? 6000);
    this.pending = { getQuery: () => query, priority: "explicit" };
    void this.drain(true);
  }

  private currentSignal: { aborted: boolean } | null = null;

  private async drain(preempt = false): Promise<void> {
    if (this.disposed) return;
    if (this.running && !preempt) return;                 // single-flight
    // Preempting an in-flight run: abort it so an async rerank can bail instead of
    // racing the new run to deliver (true single-flight for the async path).
    if (this.running && preempt && this.currentSignal) this.currentSignal.aborted = true;
    const next = this.pending;
    if (!next) return;
    this.pending = null;

    const mySeq = ++this.seq;
    this.honoredSeq = mySeq;                              // supersedes any in-flight result
    const signal = { aborted: false };
    this.currentSignal = signal;
    this.running = true;
    try {
      const query = next.getQuery();                     // rebuild from current context NOW
      // Isolation guard: never compute/deliver a result for a different project.
      if (query.projectId !== this.opts.projectId) return;
      let rows = runRecall(this.opts.getArtifacts(), query);
      if (next.priority === "explicit" && this.opts.rerank) {
        rows = await this.opts.rerank(rows, query, signal); // Tier-4, explicit-only (future)
      }
      // Discard if superseded, aborted, disposed, or somehow cross-project.
      if (mySeq !== this.honoredSeq || signal.aborted || this.disposed) return;
      if (query.projectId !== this.opts.projectId) return;
      this.opts.onResult({ seq: mySeq, projectId: query.projectId, priority: next.priority, rows });
    } finally {
      if (this.currentSignal === signal) { this.running = false; this.currentSignal = null; }
      if (this.pending && !this.running) void this.drain(); // run any newer pending request
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pending = null;
  }
}
