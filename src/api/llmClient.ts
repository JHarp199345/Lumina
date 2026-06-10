import { LUMINA_CONFIG } from "@/config";
import { useSettingsStore } from "@/store/settingsStore";

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
  return useSettingsStore.getState().odysseusUrl || "http://localhost:7860";
}

export function setOdysseusUrl(url: string): void {
  useSettingsStore.getState().setOdysseusUrl(url);
}

export function getOdysseusToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setOdysseusToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
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
export async function testOdysseus(url?: string): Promise<{ agents: number }> {
  const base = (url ?? getOdysseusUrl()).replace(/\/$/, "");
  const headers: Record<string, string> = {};
  const token = getOdysseusToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${base}/api/agents`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  return { agents: Array.isArray(data) ? data.length : 0 };
}

// ── Odysseus transport ─────────────────────────────────────────────────────────

async function _callOdysseus(
  agent: string,
  prompt: string,
  options: LLMGenerateOptions
): Promise<string> {
  const base = getOdysseusUrl();
  const url = `${base}/api/agents/${encodeURIComponent(agent)}/run`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getOdysseusToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: prompt }],
    stream: true,  // streaming keeps the tunnel alive; each token resets Cloudflare's idle timer
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odysseus ${res.status}: ${text}`);
  }

  // Read SSE stream: data: {"delta": "..."} … data: [DONE]
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Odysseus: no response body");

  const decoder = new TextDecoder();
  let content = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";   // keep incomplete last line for next chunk

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return content;
      try {
        const parsed = JSON.parse(payload) as { delta?: string; content?: string };
        content += parsed.delta ?? parsed.content ?? "";
      } catch {
        // malformed chunk — skip
      }
    }
  }

  return content;
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
