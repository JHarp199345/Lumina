/**
 * Lumina — free-mode proxy (Cloudflare Worker)
 *
 * Single egress for ALL free-mode external AI calls. The browser never talks to
 * OpenRouter or the AI Horde directly. Holds keys server-side, masks the client
 * IP, enforces free-only text + SFW images.
 *
 * Routes:
 *   POST /                  → OpenRouter free-model TEXT (failover allowlist)
 *   POST /horde/generate    → AI Horde IMAGE submit (forced SFW safety flags)
 *   GET  /horde/check/:id   → AI Horde queue check (lightweight poll)
 *   GET  /horde/result/:id  → AI Horde result; CENSORED images stripped (fail closed)
 *
 * Deploy: see README.md.
 */

// ── OpenRouter free TEXT models. OpenRouter caps the failover array at 3. ──
// Verify each is still free at https://openrouter.ai/models?max_price=0.
const FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
];

const ALLOWED_ORIGINS = [
  "https://jharp199345.github.io", // GitHub Pages — adjust to your Pages URL
  "http://localhost:5173",
  "http://localhost:5175",
];

const RATE_LIMIT = { windowSec: 60, maxRequests: 20 };

// ── AI Horde (images) ──
const HORDE_BASE = "https://aihorde.net/api/v2";
const HORDE_CLIENT_AGENT = "Lumina:1.0:github.com/JHarp199345/Lumina";
// Optional model allowlist (empty = any SFW model the Horde offers).
const HORDE_MODELS = [];
// Standing safety negative prompt, appended when the caller didn't supply one
// (AI Horde uses "positive ### negative"). Forced server-side.
const SAFETY_NEGATIVE = "nsfw, nude, naked, explicit, sexual content, gore, blood";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/horde/generate") return hordeGenerate(request, env, origin);
    if (path.startsWith("/horde/check/")) return hordeProxyGet("check", path.split("/").pop(), origin);
    if (path.startsWith("/horde/result/")) return hordeResult(path.split("/").pop(), origin);

    return openRouterText(request, env, origin);
  },
};

// ───────────────────────────────────────────────────────────────────────────
// OpenRouter free TEXT
// ───────────────────────────────────────────────────────────────────────────
async function openRouterText(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", message: "POST only" }, 405, origin);
  }
  if (!env.OPENROUTER_API_KEY) {
    return json({ error: "misconfigured", message: "OPENROUTER_API_KEY secret not set" }, 500, origin);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE_LIMIT_KV && (await isRateLimited(env.RATE_LIMIT_KV, ip))) {
    return json(
      { error: "rate_limited", message: "Too many requests — the free tier is shared, slow down a moment." },
      429, origin, { "Retry-After": String(RATE_LIMIT.windowSec) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400, origin);
  }
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return json({ error: "bad_request", message: "messages[] required" }, 400, origin);
  }

  // Force the free-model failover array; never forward a client-supplied model.
  const upstreamBody = {
    models: FREE_MODELS,
    messages: body.messages,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    ...(body.response_format ? { response_format: body.response_format } : {}),
  };

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        // Trim defends against a trailing newline/space from the secret paste.
        Authorization: `Bearer ${(env.OPENROUTER_API_KEY || "").trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": ALLOWED_ORIGINS[0],
        "X-Title": "Lumina",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return json({ error: "upstream_unreachable", message: String(err) }, 502, origin);
  }

  const text = await upstream.text();
  const extra = {};
  const retryAfter = upstream.headers.get("Retry-After");
  if (retryAfter) extra["Retry-After"] = retryAfter;
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extra },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// AI Horde IMAGES (SFW-forced)
// ───────────────────────────────────────────────────────────────────────────
async function hordeGenerate(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", message: "POST only" }, 405, origin);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE_LIMIT_KV && (await isRateLimited(env.RATE_LIMIT_KV, ip))) {
    return json({ error: "rate_limited", message: "Too many image requests — slow down." }, 429, origin, {
      "Retry-After": String(RATE_LIMIT.windowSec),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400, origin);
  }
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return json({ error: "bad_request", message: "prompt required" }, 400, origin);

  // Append a safety negative prompt unless the caller already split one in.
  const fullPrompt = prompt.includes("###") ? prompt : `${prompt} ### ${SAFETY_NEGATIVE}`;
  const hordeKey = env.HORDE_API_KEY || "0000000000"; // anonymous default (slow); set a registered key later

  const payload = {
    prompt: fullPrompt,
    params: { n: 1, ...(body.params || {}) },
    // FORCED safety — the client cannot weaken these:
    nsfw: false, // route to censoring (SFW) workers
    censor_nsfw: true, // accidental NSFW comes back censored
    trusted_workers: true, // vetted workers only
    replacement_filter: true, // sanitize suspicious prompts
    slow_workers: true, // more capacity on the free tier
    r2: false, // base64 in-response → relays through this Worker (IP mask + single gate)
    ...(HORDE_MODELS.length ? { models: HORDE_MODELS } : {}),
  };

  let up;
  try {
    up = await fetch(`${HORDE_BASE}/generate/async`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: hordeKey, "Client-Agent": HORDE_CLIENT_AGENT },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ error: "upstream_unreachable", message: String(err) }, 502, origin);
  }
  const text = await up.text();
  return new Response(text, {
    status: up.status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function hordeProxyGet(kind, id, origin) {
  if (!id) return json({ error: "bad_request" }, 400, origin);
  let up;
  try {
    up = await fetch(`${HORDE_BASE}/generate/${kind}/${encodeURIComponent(id)}`, {
      headers: { "Client-Agent": HORDE_CLIENT_AGENT },
    });
  } catch (err) {
    return json({ error: "upstream_unreachable", message: String(err) }, 502, origin);
  }
  const text = await up.text();
  return new Response(text, {
    status: up.status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// The safety gate: strip any censored/NSFW generation so the bytes NEVER reach
// the browser. Fail closed.
async function hordeResult(id, origin) {
  if (!id) return json({ error: "bad_request" }, 400, origin);
  let up;
  try {
    up = await fetch(`${HORDE_BASE}/generate/status/${encodeURIComponent(id)}`, {
      headers: { "Client-Agent": HORDE_CLIENT_AGENT },
    });
  } catch (err) {
    return json({ error: "upstream_unreachable", message: String(err) }, 502, origin);
  }
  if (!up.ok) {
    const t = await up.text();
    return new Response(t, { status: up.status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
  }
  const data = await up.json();
  const gens = Array.isArray(data.generations) ? data.generations : [];
  const safe = gens.map((g) => {
    // censored === true → the worker's safety filter caught NSFW. Drop the image.
    if (!g || g.censored === true) {
      return { ...(g || {}), img: null, blocked: true, reason: "nsfw_censored" };
    }
    return g;
  });
  return json({ ...data, generations: safe }, 200, origin);
}

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, origin, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extra },
  });
}

async function isRateLimited(kv, ip) {
  const key = `rl:${ip}`;
  const now = Date.now();
  const windowMs = RATE_LIMIT.windowSec * 1000;
  let hits = [];
  try {
    const raw = await kv.get(key);
    if (raw) hits = JSON.parse(raw);
  } catch {
    hits = [];
  }
  hits = hits.filter((t) => now - t < windowMs);
  if (hits.length >= RATE_LIMIT.maxRequests) return true;
  hits.push(now);
  await kv.put(key, JSON.stringify(hits), { expirationTtl: RATE_LIMIT.windowSec + 1 });
  return false;
}
