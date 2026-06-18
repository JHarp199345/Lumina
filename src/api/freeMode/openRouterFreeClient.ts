/**
 * Free-mode OpenRouter client — WALLED OFF from the local/private workflow.
 *
 * Lazy-loaded (dynamic import) ONLY when the active provider is "openrouter-free",
 * so it is never constructed when free mode is off (the hard gate). It shares NO
 * state with the local path: it does NOT import workflowTracker, the image store,
 * or the Odysseus client. It talks only to the Cloudflare Worker proxy, which
 * holds the OpenRouter key and enforces the free-model allowlist + failover.
 *
 * Resilience: single-flight serialization (never stampede the shared free tier),
 * exponential backoff + jitter, honors upstream Retry-After, bounded attempts with
 * a calm surrender message. See PLANxvii-free-public-mode.md.
 */

export interface FreeGenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

// The public build sets VITE_FREE_PROXY_URL to the deployed Worker URL. Cast to
// avoid coupling to a strict ImportMetaEnv interface.
const PROXY_URL =
  (import.meta.env as Record<string, string | undefined>).VITE_FREE_PROXY_URL?.replace(/\/+$/, "") || "";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 30_000;
const MAX_QUEUE_DEPTH = 8;

let queueDepth = 0;
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter; honors an upstream Retry-After (seconds). */
function backoffDelay(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec && Number.isFinite(retryAfterSec)) {
    return Math.min(MAX_DELAY_MS, retryAfterSec * 1000);
  }
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/** Reasoning models (e.g. r1-distill) wrap output in <think>…</think>; strip it. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callOnce(prompt: string, options: FreeGenerateOptions): Promise<string> {
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: prompt }],
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network error → backoff and retry.
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffDelay(attempt));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      // Free tier saturated / upstream hiccup → backoff (honor Retry-After) and retry.
      const ra = Number(res.headers.get("Retry-After"));
      lastErr = new Error(`free tier busy (${res.status})`);
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffDelay(attempt, Number.isFinite(ra) ? ra : undefined));
      }
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`free proxy ${res.status}: ${text.slice(0, 160)}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return stripThinking(data.choices?.[0]?.message?.content ?? "");
  }

  throw new Error(
    `The free tier is busy right now — try again shortly, or add your own API key for instant results.${
      lastErr ? ` (${lastErr.message})` : ""
    }`
  );
}

/**
 * Generate text via the free OpenRouter proxy. Serialized single-flight so we
 * never stampede the shared free tier. `agent` is accepted for signature parity
 * with the other providers but is not used (the Worker owns model selection).
 */
export async function callOpenRouterFree(
  _agent: string,
  prompt: string,
  options: FreeGenerateOptions = {}
): Promise<string> {
  if (!PROXY_URL) {
    throw new Error("Free mode is not configured (VITE_FREE_PROXY_URL is unset).");
  }
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    throw new Error("Too many pending free-tier requests — let the current ones finish.");
  }
  queueDepth += 1;
  const run = chain.then(() => callOnce(prompt, options));
  // Keep the chain alive regardless of this call's outcome.
  chain = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    queueDepth -= 1;
  }
}
