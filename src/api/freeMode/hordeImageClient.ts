/**
 * Free-mode AI Horde image client — WALLED OFF from the local/private workflow.
 *
 * Lazy-loaded ONLY in free mode (the hard gate); shares NO state with the local
 * path. Talks only to the Cloudflare Worker, which forces the SFW safety flags
 * (nsfw:false, censor_nsfw:true, trusted_workers:true, replacement_filter:true),
 * masks the IP, and STRIPS censored images before they reach the browser.
 *
 * AI Horde is asynchronous: submit → poll check → fetch result. This client
 * orchestrates that loop with backoff; the Worker is a thin per-call relay (a
 * single Worker request can't stay open for the minutes a generation may take).
 *
 * Fail closed: a censored/blocked or missing image returns { ok:false }, never a
 * possibly-unsafe image. See PLANxvii-free-public-mode.md §7.
 */

const PROXY_URL =
  (import.meta.env as Record<string, string | undefined>).VITE_FREE_PROXY_URL?.replace(/\/+$/, "") || "";

const MAX_WAIT_MS = 3 * 60 * 1000; // give the free horde up to 3 minutes
const POLL_INTERVAL_MS = 4000;
const SUBMIT_ATTEMPTS = 3;

export interface HordeImageParams {
  width?: number;
  height?: number;
  steps?: number;
}

export type HordeImageResult =
  | { ok: true; dataUrl: string; seed?: string; workerName?: string }
  | { ok: false; reason: "blocked" | "failed" | "timeout" | "not_configured"; message?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let queueDepth = 0;
let chain: Promise<unknown> = Promise.resolve();

async function submit(prompt: string, params: HordeImageParams): Promise<string> {
  let lastErr = "";
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt++) {
    const res = await fetch(`${PROXY_URL}/horde/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, params }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { id?: string };
      if (data.id) return data.id;
      lastErr = "no id in response";
    } else if (res) {
      lastErr = `submit ${res.status}`;
      if (res.status === 429 && attempt < SUBMIT_ATTEMPTS - 1) {
        await sleep(POLL_INTERVAL_MS * (attempt + 1));
        continue;
      }
    } else {
      lastErr = "network error";
    }
    if (attempt < SUBMIT_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(lastErr || "submit failed");
}

async function pollUntilDone(id: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${PROXY_URL}/horde/check/${encodeURIComponent(id)}`).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json()) as { done?: boolean; faulted?: boolean };
    if (data.faulted) throw new Error("generation faulted");
    if (data.done) return;
  }
  throw new Error("timeout");
}

interface HordeGeneration {
  img?: string | null;
  seed?: string;
  worker_name?: string;
  censored?: boolean;
  blocked?: boolean;
}

async function fetchResult(id: string): Promise<HordeImageResult> {
  const res = await fetch(`${PROXY_URL}/horde/result/${encodeURIComponent(id)}`).catch(() => null);
  if (!res?.ok) return { ok: false, reason: "failed", message: "result fetch failed" };
  const data = (await res.json()) as { generations?: HordeGeneration[] };
  const gen = data.generations?.[0];
  if (!gen) return { ok: false, reason: "failed", message: "no generation" };
  // Fail closed: the Worker already strips censored images (img=null, blocked).
  if (gen.blocked || gen.censored || !gen.img) {
    return { ok: false, reason: "blocked", message: "image held — did not pass the safety check" };
  }
  const dataUrl = gen.img.startsWith("data:") ? gen.img : `data:image/webp;base64,${gen.img}`;
  return { ok: true, dataUrl, seed: gen.seed, workerName: gen.worker_name };
}

async function runOne(prompt: string, params: HordeImageParams): Promise<HordeImageResult> {
  try {
    const id = await submit(prompt, params);
    await pollUntilDone(id);
    return await fetchResult(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message === "timeout" ? "timeout" : "failed", message };
  }
}

/**
 * Generate one SFW image via the free AI Horde, serialized single-flight so we
 * never stampede the shared free tier. Always resolves (never throws) with a
 * safe image or a fail-closed reason.
 */
export async function generateHordeImage(
  prompt: string,
  params: HordeImageParams = {}
): Promise<HordeImageResult> {
  if (!PROXY_URL) return { ok: false, reason: "not_configured", message: "VITE_FREE_PROXY_URL is unset" };
  if (queueDepth >= 4) return { ok: false, reason: "failed", message: "too many pending image requests" };
  queueDepth += 1;
  const run = chain.then(() => runOne(prompt, params));
  chain = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    queueDepth -= 1;
  }
}
