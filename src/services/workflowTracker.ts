/**
 * workflowTracker.ts
 *
 * Client for the Odysseus workflow telemetry API (/api/workflow).
 * Lumina pipelines call this while provider = "odysseus" so runs appear
 * live in the Odysseus Skills Library workflow log.
 *
 * Failures are logged but never block the pipeline.
 */

import { getOdysseusUrl, getOdysseusToken, getProvider } from "@/api/llmClient";
import { diagnosticWarn } from "@/utils/diagnostics";

function _base(): string {
  return getOdysseusUrl().replace(/\/$/, "");
}

function _headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = getOdysseusToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

function _logFailure(op: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[Workflow] ${op} failed:`, msg);
  diagnosticWarn(`workflow.${op}_failed`, `Odysseus workflow ${op} failed`, { error: msg });
}

async function _post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, {
    method: "POST",
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`workflow API POST ${path} → ${res.status}`);
  return res.json();
}

async function _put(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, {
    method: "PUT",
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`workflow API PUT ${path} → ${res.status}`);
  return res.json();
}

async function _get(path: string): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, { headers: _headers() });
  if (!res.ok) throw new Error(`workflow API GET ${path} → ${res.status}`);
  return res.json();
}

function _enabled(): boolean {
  return getProvider() === "odysseus";
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
  context: WorkflowContext,
  taskGoal?: string
): Promise<string | null> {
  if (!_enabled()) return null;
  try {
    const res = (await _post("/start", {
      type,
      context_label: contextLabel,
      context,
      task_goal: taskGoal ?? contextLabel,
    })) as { workflow_id: string };
    const id = res.workflow_id ?? null;
    if (id) console.log(`[Workflow] started ${type} → ${id}`);
    return id;
  } catch (err) {
    _logFailure("start", err);
    return null;
  }
}

export interface StepRecord {
  name: string;
  goal?: string;
  agent?: string;
  skill?: string;
  duration_ms?: number;
  metrics?: Record<string, unknown>;
  notes?: string;
  goal_achieved?: number;
  unblocked_next?: boolean;
  status?: "running" | "done" | "failed";
}

/** Record a completed step in one shot. No-op if workflowId is null. */
export async function recordStep(workflowId: string | null, step: StepRecord): Promise<void> {
  if (!workflowId) return;
  try {
    await _post(`/${workflowId}/step`, { ...step, status: step.status ?? "done" });
  } catch (err) {
    _logFailure("step", err);
  }
}

/** Mark a step as in-progress. Returns sequence number for finishStep. */
export async function beginStep(
  workflowId: string | null,
  step: Pick<StepRecord, "name" | "goal" | "agent" | "skill" | "notes">
): Promise<number | null> {
  if (!workflowId) return null;
  try {
    const res = (await _post(`/${workflowId}/step`, { ...step, status: "running" })) as {
      sequence: number;
    };
    return res.sequence ?? null;
  } catch (err) {
    _logFailure("begin_step", err);
    return null;
  }
}

/** Finalize a step that was started with beginStep. */
export async function finishStep(
  workflowId: string | null,
  sequence: number | null,
  update: Omit<StepRecord, "name"> & { status?: "done" | "failed" }
): Promise<void> {
  if (!workflowId || sequence == null) return;
  try {
    await _put(`/${workflowId}/step/${sequence}`, { ...update, status: update.status ?? "done" });
  } catch (err) {
    _logFailure("finish_step", err);
  }
}

export interface StepOutcome {
  metrics?: Record<string, unknown>;
  goal_achieved?: number;
  unblocked_next?: boolean;
  notes?: string;
}

/**
 * Track a pipeline step with live updates: posts "running" immediately,
 * then "done" or "failed" when the work finishes.
 */
export async function trackStep<T>(
  workflowId: string | null,
  spec: Pick<StepRecord, "name" | "goal" | "agent" | "skill">,
  work: () => Promise<T>,
  evaluate: (result: T) => StepOutcome,
  onError?: (err: unknown) => StepOutcome
): Promise<T> {
  const sw = stopwatch();
  const seq = await beginStep(workflowId, spec);
  try {
    const result = await work();
    const outcome = evaluate(result);
    await finishStep(workflowId, seq, {
      ...outcome,
      duration_ms: sw(),
      status: "done",
    });
    return result;
  } catch (err) {
    const outcome = onError?.(err) ?? {
      metrics: { error: err instanceof Error ? err.message : String(err) },
      goal_achieved: 0,
      unblocked_next: false,
    };
    await finishStep(workflowId, seq, {
      ...outcome,
      duration_ms: sw(),
      status: "failed",
    });
    throw err;
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
    const res = (await _post(`/${workflowId}/complete`, data)) as { optimization_notes?: string[] };
    const notes = res.optimization_notes ?? [];
    if (notes.length) console.log(`[Workflow] ${workflowId} complete —`, notes[0]);
    return notes;
  } catch (err) {
    _logFailure("complete", err);
    return [];
  }
}

/** Fetch optimization insights for a workflow type. */
export async function getWorkflowInsights(type: string): Promise<unknown> {
  if (!_enabled()) return null;
  try {
    return await _get(`/insights?type=${encodeURIComponent(type)}`);
  } catch {
    return null;
  }
}

/** Fetch recent runs for display. */
export async function getRecentRuns(type?: string, limit = 20): Promise<unknown[]> {
  if (!_enabled()) return [];
  try {
    const q = type ? `?type=${encodeURIComponent(type)}&limit=${limit}` : `?limit=${limit}`;
    const res = (await _get(`/recent${q}`)) as { runs: unknown[] };
    return res.runs ?? [];
  } catch {
    return [];
  }
}

/** Returns a function that, when called, returns elapsed ms since creation. */
export function stopwatch(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
