/**
 * workflowTracker.ts
 *
 * Thin client for the Odysseus workflow telemetry API.
 * Records every step of a pipeline run so the system can grade effectiveness
 * per step and optimize future runs.
 *
 * All calls are fire-and-forget on failure — never blocks the pipeline.
 * Only active when provider = "odysseus".
 */

import { getOdysseusUrl, getOdysseusToken, getProvider } from "@/api/llmClient";

function _base(): string {
  return getOdysseusUrl().replace(/\/$/, "");
}

function _headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = getOdysseusToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

async function _post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, {
    method: "POST",
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`workflow API ${res.status}`);
  return res.json();
}

async function _get(path: string): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, { headers: _headers() });
  if (!res.ok) throw new Error(`workflow API ${res.status}`);
  return res.json();
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface WorkflowContext {
  book_title?: string;
  chapters?: string[];
  target_minutes?: number;
  target_words?: number;
  num_segments?: number;
  [key: string]: unknown;
}

/** Start a workflow run. Returns workflow_id, or null if Odysseus is unavailable. */
export async function startWorkflow(
  type: string,
  contextLabel: string,
  context: WorkflowContext
): Promise<string | null> {
  if (getProvider() !== "odysseus") return null;
  try {
    const res = await _post("/start", { type, context_label: contextLabel, context }) as { workflow_id: string };
    return res.workflow_id ?? null;
  } catch {
    return null;
  }
}

export interface StepRecord {
  name: string;
  agent?: string;
  skill?: string;
  duration_ms?: number;
  metrics?: Record<string, unknown>;
  notes?: string;
}

/** Record a completed step. No-op if workflowId is null. */
export async function recordStep(workflowId: string | null, step: StepRecord): Promise<void> {
  if (!workflowId) return;
  try {
    await _post(`/${workflowId}/step`, step);
  } catch {
    // silent
  }
}

export interface CompletionRecord {
  outcome_metrics?: Record<string, unknown>;
  user_grade?: number;
}

/** Close a workflow run and trigger auto-grading. Returns optimization notes. */
export async function completeWorkflow(
  workflowId: string | null,
  data: CompletionRecord = {}
): Promise<string[]> {
  if (!workflowId) return [];
  try {
    const res = await _post(`/${workflowId}/complete`, data) as { optimization_notes?: string[] };
    return res.optimization_notes ?? [];
  } catch {
    return [];
  }
}

/** Fetch optimization insights for a workflow type. */
export async function getWorkflowInsights(type: string): Promise<unknown> {
  if (getProvider() !== "odysseus") return null;
  try {
    return await _get(`/insights?type=${encodeURIComponent(type)}`);
  } catch {
    return null;
  }
}

/** Fetch recent runs for display. */
export async function getRecentRuns(type?: string, limit = 20): Promise<unknown[]> {
  if (getProvider() !== "odysseus") return [];
  try {
    const q = type ? `?type=${encodeURIComponent(type)}&limit=${limit}` : `?limit=${limit}`;
    const res = await _get(`/recent${q}`) as { runs: unknown[] };
    return res.runs ?? [];
  } catch {
    return [];
  }
}

// ── Timing helper ──────────────────────────────────────────────────────────────

/** Returns a function that, when called, returns elapsed ms since creation. */
export function stopwatch(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
