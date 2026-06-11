import { LUMINA_CONFIG } from "@/config";
import { useSettingsStore } from "@/store/settingsStore";
import { normalizeOdysseusUrl } from "@/utils/odysseusUrl";

// ── Provider settings — backed by Zustand persist store ───────────────────────
// Token is still kept in localStorage with the lk_ prefix (same as Gemini key),
// since it's a credential rather than a setting.

export type LLMProvider = "odysseus" | "gemini";

const TOKEN_KEY = "lk_lumina_odysseus_token";

export function getProvider(): LLMProvider {
  return useSettingsStore.getState().llmProvider ?? "odysseus";
}

export function setProvider(p: LLMProvider): void {
  useSettingsStore.getState().setLlmProvider(p);
}

export function getOdysseusUrl(): string {
  try {
    return normalizeOdysseusUrl(useSettingsStore.getState().odysseusUrl);
  } catch {
    return "http://localhost:7860";
  }
}

export function setOdysseusUrl(url: string): void {
  useSettingsStore.getState().setOdysseusUrl(normalizeOdysseusUrl(url));
}

export function getOdysseusToken(): string {
  const raw = localStorage.getItem(TOKEN_KEY) || "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}

export function getOdysseusTokenPrefix(): string | null {
  const t = getOdysseusToken();
  if (!t) return null;
  return t.startsWith("ody_") ? `${t.slice(0, 12)}…` : `${t.slice(0, 8)}…`;
}

export function setOdysseusToken(token: string): void {
  const normalized = token.replace(/^Bearer\s+/i, "").trim();
  if (normalized) {
    localStorage.setItem(TOKEN_KEY, normalized);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// ── Generate ───────────────────────────────────────────────────────────────────

export interface LLMGenerateOptions {
  /** Passed through to Gemini when provider="gemini". Ignored in Odysseus mode. */
  geminiKey?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tells Gemini to respond with application/json. Odysseus relies on the prompt. */
  jsonMode?: boolean;
  /** Override the Gemini model (Gemini mode only). */
  model?: string;
}

/**
 * Generate text from the configured LLM provider.
 *
 * @param agent - Odysseus agent name ("reading", "quiz", "council", etc.) — also
 *                used as a hint when falling back to Gemini.
 * @param prompt - Full user-facing prompt string.
 * @param options - Temperature, token limits, API key for Gemini fallback, etc.
 */
export async function llmGenerate(
  agent: string,
  prompt: string,
  options: LLMGenerateOptions = {}
): Promise<string> {
  if (getProvider() === "odysseus") {
    return _callOdysseus(agent, prompt, options);
  }
  return _callGemini(prompt, options);
}

/**
 * Generate and parse a JSON response. Strips markdown code-fences before parsing.
 * Throws if the response cannot be parsed.
 */
export async function llmGenerateJSON<T>(
  agent: string,
  prompt: string,
  options: LLMGenerateOptions = {}
): Promise<T> {
  const raw = await llmGenerate(agent, prompt, { ...options, jsonMode: true });
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Ping Odysseus and return connected agent count.
 * Pass a URL to test a new URL before saving it.
 */
export interface OdysseusTestResult {
  agents: number;
  workflowAuth: boolean;
  tokenPrefix: string | null;
}

export async function testOdysseus(url?: string): Promise<OdysseusTestResult> {
  const base = normalizeOdysseusUrl(url ?? useSettingsStore.getState().odysseusUrl);
  const endpoint = `${base}/api/agents`;
  const token = getOdysseusToken();
  const tokenPrefix = getOdysseusTokenPrefix();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(endpoint, { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot reach ${endpoint} — ${msg}`);
  }

  if (!res.ok) {
    const hint = !token
      ? " — no auth token saved"
      : !token.startsWith("ody_")
        ? " — token should start with ody_"
        : res.status === 404
          ? " — 404 usually means the URL is wrong or the tunnel is down (Odysseus returns 401, not 404)"
          : "";
    throw new Error(`HTTP ${res.status} from ${endpoint}${hint}`);
  }
  const data: unknown = await res.json();

  let workflowAuth = false;
  if (token) {
    const wfRes = await fetch(`${base}/api/workflow/recent?limit=1`, { headers });
    workflowAuth = wfRes.ok;
  }

  // Persist normalized URL so the next call uses the absolute URL
  if (useSettingsStore.getState().odysseusUrl !== base) {
    useSettingsStore.getState().setOdysseusUrl(base);
  }

  return {
    agents: Array.isArray(data) ? data.length : 0,
    workflowAuth,
    tokenPrefix,
  };
}

// ── Odysseus transport ─────────────────────────────────────────────────────────

async function _callOdysseus(
  agent: string,
  prompt: string,
  options: LLMGenerateOptions
): Promise<string> {
  const base = getOdysseusUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getOdysseusToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Workflow telemetry headers — Odysseus logs steps server-side if /workflow/start failed
  try {
    const { getWorkflowAgentHeaders, adoptWorkflowId } = await import("@/services/workflowTracker");
    Object.assign(headers, getWorkflowAgentHeaders(agent));
  } catch {
    /* optional */
  }

  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: prompt }],
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  // POST to queue endpoint — returns job_id immediately, avoids Cloudflare 100s timeout
  const startRes = await fetch(
    `${base}/api/agents/${encodeURIComponent(agent)}/queue`,
    { method: "POST", headers, body: JSON.stringify(body) }
  );
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`Odysseus ${startRes.status}: ${text}`);
  }
  const startJson = await startRes.json() as { job_id: string; workflow_id?: string };
  const { job_id } = startJson;
  if (startJson.workflow_id) {
    try {
      const { adoptWorkflowId } = await import("@/services/workflowTracker");
      adoptWorkflowId(startJson.workflow_id);
    } catch {
      /* optional */
    }
  }

  // Poll up to 30 min — check immediately, then every 3s
  const pollHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  for (let i = 0; i < 600; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${base}/api/agents/jobs/${job_id}`, { headers: pollHeaders });
    if (!pollRes.ok) continue;
    const job = await pollRes.json() as { status: string; content?: string; error?: string };
    if (job.status === "done") return job.content ?? "";
    if (job.status === "error") throw new Error(`Odysseus LLM failed: ${job.error ?? "unknown"}`);
    // status === "pending" | "running" → keep polling
  }
  throw new Error("Odysseus LLM job timed out (30 min)");
}

// ── Odysseus skill recording ───────────────────────────────────────────────────

/**
 * Push a skill outcome record to Odysseus so the skills catalog stays current.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function recordOdysseusSkillRun(
  skillName: string,
  lessons: string[],
  metrics: { actualWords: number; targetWords: number; expansionLoops: number }
): void {
  const base = getOdysseusUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getOdysseusToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  fetch(`${base}/api/agents/skills/record`, {
    method: "POST",
    headers,
    body: JSON.stringify({ skill_name: skillName, lessons, metrics }),
  }).catch(() => {});
}

// ── Gemini fallback ────────────────────────────────────────────────────────────

async function _callGemini(prompt: string, options: LLMGenerateOptions): Promise<string> {
  const apiKey =
    options.geminiKey ||
    localStorage.getItem("lk_lumina_google_ai_key") ||
    "";

  if (!apiKey) throw new Error("No Google AI key configured. Add one in Settings.");

  const model = options.model ?? LUMINA_CONFIG.GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const genConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxTokens ?? 2048,
  };
  if (options.jsonMode) genConfig.responseMimeType = "application/json";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: genConfig,
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);

  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
