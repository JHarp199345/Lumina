/**
 * workflowTracker.ts
 *
 * Client for the Odysseus workflow telemetry API (/api/workflow).
 * Lumina pipelines call this when Odysseus is configured so runs appear
 * live in the Odysseus Skills Library workflow log.
 *
 * Agent calls also carry workflow headers (see llmClient.ts) so Odysseus
 * can record steps server-side if /api/workflow/start fails (e.g. 401).
 */

import { getOdysseusUrl, getOdysseusToken, getProvider } from "@/api/llmClient";
import { diagnosticWarn } from "@/utils/diagnostics";

// ── Active run context (read by llmClient for agent queue headers) ─────────────

export interface ActiveWorkflowContext {
  id: string | null;
  type: string;
  label: string;
  taskGoal: string;
  stepName?: string;
  stepGoal?: string;
  skill?: string;
}

let _active: ActiveWorkflowContext | null = null;

export function setWorkflowContext(ctx: ActiveWorkflowContext | null): void {
  _active = ctx;
}

export function getWorkflowContext(): ActiveWorkflowContext | null {
  return _active;
}

/** Headers for Odysseus agent /queue calls — enables server-side step logging. */
export function getWorkflowAgentHeaders(
  agent: string,
  step?: { name?: string; goal?: string; skill?: string }
): Record<string, string> {
  if (!_active) return {};
  const h: Record<string, string> = {};
  if (_active.id) h["X-Workflow-Run-Id"] = _active.id;
  if (_active.type) h["X-Lumina-Workflow-Type"] = _active.type;
  if (_active.label) h["X-Lumina-Workflow-Label"] = _active.label;
  if (_active.taskGoal) h["X-Lumina-Workflow-Goal"] = _active.taskGoal;
  const stepName = step?.name ?? _active.stepName ?? agent;
  const stepGoal = step?.goal ?? _active.stepGoal;
  const skill = step?.skill ?? _active.skill;
  if (stepName) h["X-Workflow-Step-Name"] = stepName;
  if (stepGoal) h["X-Workflow-Step-Goal"] = stepGoal;
  if (skill) h["X-Workflow-Step-Skill"] = skill;
  return h;
}

export function adoptWorkflowId(id: string): void {
  if (_active) _active.id = id;
}

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

function _shouldLog(): boolean {
  return getProvider() === "odysseus";
}

async function _post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, {
    method: "POST",
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`workflow API POST ${path} → ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  return res.json();
}

async function _put(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${_base()}/api/workflow${path}`, {
    method: "PUT",
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`workflow API PUT ${path} → ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
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

/** Start a workflow run. Returns workflow_id, or null if unavailable. */
export async function startWorkflow(
  type: string,
  contextLabel: string,
  context: WorkflowContext,
  taskGoal?: string
): Promise<string | null> {
  if (!_shouldLog()) return null;

  setWorkflowContext({
    id: null,
    type,
    label: contextLabel,
    taskGoal: taskGoal ?? contextLabel,
  });

  try {
    const res = (await _post("/start", {
      type,
      context_label: contextLabel,
      context,
      task_goal: taskGoal ?? contextLabel,
    })) as { workflow_id: string };
    const id = res.workflow_id ?? null;
    if (id) {
      adoptWorkflowId(id);
      console.log(`[Workflow] started ${type} → ${id}`);
    }
    return id;
  } catch (err) {
    _logFailure("start", err);
    // Keep _active context so agent queue calls can auto-start server-side
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

export async function recordStep(workflowId: string | null, step: StepRecord): Promise<void> {
  if (!workflowId) return;
  if (_active) {
    _active.stepName = step.name;
    _active.stepGoal = step.goal;
    _active.skill = step.skill;
  }
  try {
    await _post(`/${workflowId}/step`, { ...step, status: step.status ?? "done" });
  } catch (err) {
    _logFailure("step", err);
  }
}

export async function beginStep(
  workflowId: string | null,
  step: Pick<StepRecord, "name" | "goal" | "agent" | "skill" | "notes">
): Promise<number | null> {
  if (!workflowId) return null;
  if (_active) {
    _active.stepName = step.name;
    _active.stepGoal = step.goal;
    _active.skill = step.skill;
  }
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

export async function trackStep<T>(
  workflowId: string | null,
  spec: Pick<StepRecord, "name" | "goal" | "agent" | "skill">,
  work: () => Promise<T>,
  evaluate: (result: T) => StepOutcome,
  onError?: (err: unknown) => StepOutcome
): Promise<T> {
  if (_active) {
    _active.stepName = spec.name;
    _active.stepGoal = spec.goal;
    _active.skill = spec.skill;
  }

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

export async function completeWorkflow(
  workflowId: string | null,
  data: CompletionRecord = {}
): Promise<string[]> {
  const id = workflowId ?? _active?.id ?? null;
  if (!id) {
    setWorkflowContext(null);
    return [];
  }
  try {
    const res = (await _post(`/${id}/complete`, data)) as { optimization_notes?: string[] };
    const notes = res.optimization_notes ?? [];
    if (notes.length) console.log(`[Workflow] ${id} complete —`, notes[0]);
    return notes;
  } catch (err) {
    _logFailure("complete", err);
    return [];
  } finally {
    setWorkflowContext(null);
  }
}

export function stopwatch(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
