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

const MAX_WAIT_MS = 2 * 60 * 60 * 1000; // free Horde jobs can take 35-90 minutes
const POLL_INTERVAL_MS = 4000;
const SUBMIT_ATTEMPTS = 3;

export interface HordeImageParams {
  width?: number;
  height?: number;
  steps?: number;
}

export interface HordeImageProgress {
  id: string;
  waitTimeSeconds?: number;
  queuePosition?: number;
  waiting?: number;
  processing?: number;
  done?: boolean;
}

export type HordeImageResult =
  | { ok: true; dataUrl: string; seed?: string; workerName?: string }
  | { ok: false; reason: "blocked" | "failed" | "timeout" | "not_configured"; message?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bounded concurrency — NOT single-flight. The Horde is a crowd of workers, so
// separate requests take separate queue slots and wait in parallel. We let up to
// MAX_CONCURRENT image jobs run at once (each its own submit→poll→result); a
// reader who requests several images in succession gets them all in line together
// (~one queue wait, not N×) instead of serialized. Overflow waits for a slot
// rather than being rejected. The Worker's per-IP submit cap is the abuse guard.
const MAX_CONCURRENT = 6;
let active = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (active unchanged)
  else active -= 1;
}

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

async function pollUntilDone(id: string, onProgress?: (progress: HordeImageProgress) => void): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${PROXY_URL}/horde/check/${encodeURIComponent(id)}`).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json()) as {
      done?: boolean;
      faulted?: boolean;
      wait_time?: number;
      queue_position?: number;
      waiting?: number;
      processing?: number;
    };
    onProgress?.({
      id,
      waitTimeSeconds: data.wait_time,
      queuePosition: data.queue_position,
      waiting: data.waiting,
      processing: data.processing,
      done: data.done,
    });
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

async function runOne(
  prompt: string,
  params: HordeImageParams,
  onProgress?: (progress: HordeImageProgress) => void
): Promise<HordeImageResult> {
  try {
    const id = await submit(prompt, params);
    onProgress?.({ id });
    await pollUntilDone(id, onProgress);
    return await fetchResult(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message === "timeout" ? "timeout" : "failed", message };
  }
}

/**
 * Generate one SFW image via the free AI Horde. Bounded-concurrent: up to
 * MAX_CONCURRENT jobs run at once (each its own queue slot, polled in parallel);
 * further requests wait for a slot. Always resolves (never throws) with a safe
 * image or a fail-closed reason.
 */
export async function generateHordeImage(
  prompt: string,
  params: HordeImageParams = {},
  onProgress?: (progress: HordeImageProgress) => void
): Promise<HordeImageResult> {
  if (!PROXY_URL) return { ok: false, reason: "not_configured", message: "VITE_FREE_PROXY_URL is unset" };
  await acquireSlot();
  try {
    return await runOne(prompt, params, onProgress);
  } finally {
    releaseSlot();
  }
}
