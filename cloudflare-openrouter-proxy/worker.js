/**
 * Lumina — free-tier OpenRouter proxy (Cloudflare Worker)
 *
 * Holds the OpenRouter API key SERVER-SIDE (never shipped to the browser),
 * restricts every call to a FREE-models allowlist, fails over across those
 * models automatically, and rate-limits per IP. The client only ever sees this
 * Worker's URL — never the key.
 *
 * Deploy: see README.md in this folder.
 */

// ───────────────────────────────────────────────────────────────────────────
// EDIT THIS: your ordered free-model allowlist.
// OpenRouter tries them top-to-bottom and falls over to the next on
// rate-limit / error / unavailability (native `models` routing). Keep ONLY
// `:free` ids here. Find the current free models at:
//   https://openrouter.ai/models?max_price=0
// (Reader will replace this with their exact list.)
const FREE_MODELS = [
  "deepseek/deepseek-chat-v3-0324:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
];

// Origins allowed to call this Worker (your app URLs). Anything else is refused
// by CORS so the proxy isn't trivially usable from arbitrary pages.
const ALLOWED_ORIGINS = [
  "https://jharp199345.github.io", // GitHub Pages — adjust to your Pages URL
  "http://localhost:5173",
  "http://localhost:5175",
];

// Per-IP soft rate limit (only enforced if a RATE_LIMIT_KV binding exists).
const RATE_LIMIT = { windowSec: 60, maxRequests: 20 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed", message: "POST only" }, 405, origin);
    }
    if (!env.OPENROUTER_API_KEY) {
      return json({ error: "misconfigured", message: "OPENROUTER_API_KEY secret not set" }, 500, origin);
    }

    // Per-IP rate limit (best-effort; needs the optional KV binding).
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.RATE_LIMIT_KV && (await isRateLimited(env.RATE_LIMIT_KV, ip))) {
      return json(
        { error: "rate_limited", message: "Too many requests — the free tier is shared, slow down a moment." },
        429,
        origin,
        { "Retry-After": String(RATE_LIMIT.windowSec) }
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

    // FORCE the free-model failover array. We deliberately do NOT forward any
    // client-supplied `model` — so the proxy can never be coerced into a paid model.
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
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (optional but recommended):
          "HTTP-Referer": ALLOWED_ORIGINS[0],
          "X-Title": "Lumina",
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch (err) {
      return json({ error: "upstream_unreachable", message: String(err) }, 502, origin);
    }

    // Pass the upstream response straight through, preserving status + Retry-After
    // (so the client's backoff can honor it). CORS added.
    const text = await upstream.text();
    const extra = {};
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter) extra["Retry-After"] = retryAfter;
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extra },
    });
  },
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// Sliding-window per-IP limiter backed by Workers KV. No-op unless the binding
// is present, so the Worker still deploys without KV configured.
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
