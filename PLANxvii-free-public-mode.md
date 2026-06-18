# PLANxvii — Free Public Mode ("Knowledge Horde")

> **Status: planning only. No code yet.** A multi-session build.
>
> **Audience: an AI with NO memory of the conversation that produced this.**
> This document is deliberately verbose — it captures not just the decisions but
> the *worries, the reasoning, the rejected ideas, and why*. If you are picking
> this up cold, read it top to bottom before touching anything. It is the single
> source of truth for the free public mode. It builds directly on `PLANxvi.md`
> (the Starter Kit + "Part Two: free live generation"); read that too.

---

## 0. THE GOAL (why this exists)

Make Lumina a **publicly available, free service anyone can use out of the box** —
no account, no API key, no local server. The driving audience is
**under-resourced readers**: people on cheap phones, metered/intermittent data,
public-library and clinic/shelter networks, college students, housing navigators
helping clients. The mission is **access**: someone with nothing should be able
to open Lumina and get the full experience — read a public-domain (or their own)
book with AI analysis, scene imagery, quizzes, audio — without ever knowing what
an API key is.

This is necessarily **best-effort** (free compute is slow and rate-limited), so
it pairs with the **pre-baked Starter Library** (PLANxvi Part One) which is the
*guaranteed* floor that always works with zero calls.

---

## 1. THE RELIABILITY HIERARCHY (the mental model for the whole feature)

Everything is designed around three tiers. The UI must communicate which one is
active.

1. **Pre-baked library — GUARANTEED.** No network calls. Always works. Curated,
   human-reviewed content (incl. images). This is the floor and the demo path.
2. **Free live generation — BEST-EFFORT.** Free hosted models (OpenRouter free
   tier) + crowdsourced GPUs (AI Horde). Globally rate-limited; *will* fail under
   load. We make it resilient (queue + backoff, never crash, eventually succeed),
   never promise instant.
3. **BYO key / local Odysseus — RELIABLE upgrade.** A user who adds an
   OpenRouter/Google key or runs the operator's Odysseus box gets the dependable
   path. This is the existing private workflow.

Free live generation shows a calm "working — the free tier can take a while"
state, never a spinner that looks hung.

---

## 2. THE CORE ARCHITECTURE: a walled-off, hard-gated, lazy-loaded route

This is the operator's hardest requirement and the spine of the design.

### 2.1 One umbrella mode — "Knowledge Horde"
A single **Free / Public mode**, branded **"Knowledge Horde"** (vibe over
precision — the text half is actually OpenRouter, but the crowdsourced ethos fits
and the warning explains the rest). One switch turns the entire free public path
on or off.

### 2.2 The hard gate — "off means off"
The operator does **not** want any private/local process to leak into the public
path, ever. So:

- **When free mode is OFF, the clients are NOT CONSTRUCTED** — not merely skipped
  at call time. No Horde client instance, no OpenRouter-free client, no polling
  loop, no provider registered. "Off" = "does not instantiate."
- Implement via a single gate flag checked at the boundary, plus **`dynamic
  import()`** of the entire free-mode machinery only when the mode is on.

### 2.3 No shared mutable state ("copy the shape, own structure")
The leak risk is **live state and running processes**, NOT pure functions. The
private path's danger points are *singletons / module-globals*:
- `src/services/workflowTracker.ts` — module-global `_active` workflow context.
- `src/store/imageStore.ts` — generation-state singletons (`isGenerating`,
  `activeGenerationSlot`, `activeVisualJob`, etc.).
- `src/api/llmClient.ts` — the Odysseus client + provider state.

The free-mode route must touch **none** of these. It gets its **own** client, own
queue, own state, own (or clearly provenance-tagged) storage writes — so a
Horde/free result can never masquerade as a local-pipeline artifact, and a private
run's context can never bleed into a public call.

**But share the inert bits.** Pure, stateless definitions — TypeScript types,
prompt templates — carry no process and no state. Reuse them. *Copying* them is
what causes drift bugs (critique: a fully parallel pipeline doubles maintenance).
The precise rule: **isolate everything that can run or remember; share only things
that can't.** If the operator wants belt-and-suspenders even on pure helpers,
that's allowed — at a known maintenance cost.

### 2.4 The gate is a three-for-one win
Lazy-loading the free-mode machinery behind the gate simultaneously delivers:
- **Isolation** (the wall),
- **No-leak** (private singletons never referenced),
- **Footprint** (users on local/BYO never download a byte of the free-mode code,
  sanitizers, or Horde client — important for the cheap-phone audience).
One mechanism, three goals.

---

## 3. BACKEND SPLIT BY MODALITY (and an important correction)

OpenRouter is a **text/chat LLM router**. AI Horde does **images and text**.
**Neither does audio/TTS.** So:

| Lumina function | Free backend | Notes |
|---|---|---|
| **Text** — semantic analysis, chapter scoring, narration scripts, study guide, quizzes, flashcards, visual briefs/lore, source profile | **OpenRouter free** (curated heavy models) via the Cloudflare Worker | The bulk of the intelligence |
| **Images** — scene art | **AI Horde** (free crowdsourced GPUs), relayed through the Worker | The win OpenRouter free can't give |
| **Audio** — narration voice (TTS) | **On-device** `speechSynthesis` (free, nothing leaves device) OR **pre-baked** overview audio | NOT Horde, NOT OpenRouter — both lack TTS |

Audio being on-device is a *privacy bonus*: TTS data never leaves the user's
machine, so the disclaimer doesn't need to cover it.

> Earlier wrong assumption to avoid: "Horde generates the analysis, images, and
> audio." It does not do audio, and in this design it does not do the text either
> (OpenRouter does). Keep the split straight.
>
> VERIFIED (against the official Haidra-Org/AI-Horde repo): the AI Horde is "a
> free community service that lets anyone create AI-generated images and text" —
> **image + text only, no audio/TTS.** Not a memory claim; checked.

---

## 3A. MODES, AUDIO, AND KEY-STORAGE POLICY (operator-specified)

Three modes map to three providers; audio and key handling differ per mode.

### Modes → providers
- **Free mode ("Knowledge Horde")** — provider `openrouter-free` (text via the
  Worker) + AI Horde (images via the Worker). **No user key** — the OpenRouter key
  lives server-side in the Worker; Horde needs no billing key.
- **Local mode** — provider `odysseus`. The user runs their own server(s) and
  chooses their own local TTS (operator self-hosts e.g. Kokoro; users *may*, but
  must build their own — the operator cannot provide it). This limitation is the
  whole reason the best-effort free mode exists.
- **Paid mode (BYO key)** — provider `gemini` (and/or other paid). Uses the paid
  API the user supplies, including its TTS voice.

### Audio = script + voice, handled per mode
The "audio overview" is an LLM-written **script** plus a **voice** that speaks it.
- **Free:** script from `openrouter-free`; voice from the **browser's on-device
  Web Speech API** (`speechSynthesis`). **Play** calls
  `speechSynthesis.speak(new SpeechSynthesisUtterance(script))` with a voice the
  user picks from `speechSynthesis.getVoices()`.
  - IMPORTANT: the Web Speech API **is programmatically controllable** — Play can
    drive it directly. The "open a window with instructions to highlight the text
    and pick a voice" path is only a **FALLBACK** for the rare browser without Web
    Speech support / where it's disabled. Do not make the fallback the default.
  - On-device = nothing leaves the device for the voice (privacy bonus). **Free
    mode only** — this whole browser-voice arrangement does not apply to local/paid.
- **Local:** script from the local model; voice from **whichever local TTS server
  the user configured** (operator's case: self-hosted).
- **Paid:** script + premium **voice from the paid API** the user supplied.

### Key-storage policy (security safeguard — operator-specified)
- **Paid keys are SESSION-ONLY.** Store a BYO paid key in `sessionStorage` /
  in-memory, **never** in persistent `localStorage`/IndexedDB. Closing the
  browser/tab **deletes the key**; the user re-enters it each session. This
  protects keys on shared/public machines (library, clinic) — the core audience.
  > NOTE: this is a CHANGE from today's persisted `storage.loadApiKey(...)`
  > behavior. The public build must NOT persist paid keys.
- **Free mode: no key at all.**
- **Local mode: assumes the user's own private setup;** their config is their
  responsibility (may persist on a trusted personal machine — but the public/shared
  deployment should default to session-only for any secret).

---

## 4. THE CURATED OPENROUTER FREE-TEXT LIST (and why curation is mandatory)

**Why curated:** without a targeted list, calls get routed to whatever free model
is cheapest/available — often a tiny 2B model that **summarizes and truncates the
analysis into useless downstream mush**, degrading the whole pipeline silently.
We target heavy hitters only.

**Failover order** (most reliable at producing clean JSON first — the structured
analysis is the fragile part):

1. `meta-llama/llama-3.3-70b-instruct:free` — primary heavy reasoning; good JSON discipline.
2. `qwen/qwen-2.5-72b-instruct:free` — strong complex-text fallback.
3. `google/gemini-2.0-flash-exp:free` — vision/multimodal + fast. ⚠️ VERIFY the exact free id on the live page; the operator first suggested `gemini-2.0-flash-lite-preview-02-05:free` which may not be a free id.
4. `deepseek/deepseek-r1-distill-llama-70b:free` — analytical backstop, **last**. ⚠️ It's a *reasoning* model: burns tokens on hidden thinking and often wraps JSON in `<think>`. The client MUST strip reasoning before parsing; do not make it primary.

Notes:
- Vision is **nice-to-have, not core** — Lumina works from text and rarely feeds
  the LLM an image. One multimodal slot is plenty.
- **Every `:free` model has a daily cap SHARED across all the operator's users.**
  The failover list + the client's 429-backoff are what keep it alive at peak.
- These ids **drift** as OpenRouter rotates free models. Re-verify periodically at
  `https://openrouter.ai/models?max_price=0` and update.

---

## 5. THE CLOUDFLARE WORKER — the single most important component

Already scaffolded in **`cloudflare-openrouter-proxy/`** (`worker.js`,
`wrangler.toml`, `README.md`). Its role has GROWN: it is the **universal egress
for ALL external AI calls** — OpenRouter *and* Horde. **The browser never talks to
the outside world directly.** Everything goes through the Worker.

It does five jobs:

1. **Holds the OpenRouter key server-side.** Never shipped to the browser
   (a browser key is scraped within minutes → strangers exhaust the free tier →
   real users get nothing). Set via `wrangler secret put OPENROUTER_API_KEY` — the
   key lives ONLY here, nowhere in the repo or app.
2. **Enforces the free-model allowlist + failover** (OpenRouter `models` array).
   It deliberately does NOT forward any client-supplied `model`, so the proxy can
   never be coerced into a paid model. $0 credit balance is a second guard.
3. **Schema validation (zero-trust firewall).** Validates structured responses
   (use **Zod, server-side in the Worker, NOT in the client bundle**). Malformed /
   injected payloads die at Cloudflare, thousands of miles from the user.
4. **NSFW image classification** (see §7) — flagged Horde images are blocked here
   and never reach the browser.
5. **IP masking** (see §8) — Horde/OpenRouter see a Cloudflare datacenter IP, not
   the user's.

Plus: per-IP rate limiting (Workers KV) and the **Green Book** reputation store
(§6) in KV.

> Cost note: routing text through the Worker is cheap. Routing **image bytes**
> through it (required for masking + central NSFW screening) is heavier — watch
> the Workers free-tier limits (≈100k req/day; CPU/subrequest/response-size caps).
> Horde often returns an image as an R2/CDN URL; to truly mask + screen, the Worker
> must FETCH and RELAY the bytes, not hand the client a raw Horde URL.

---

## 6. THE "GREEN BOOK" — trusted-route reputation

The operator's idea: quietly build a shared **address book of safe routes** (and
"do not go here" warnings) — like the Green Book of safe establishments. Cheap,
just bytes.

- **Baseline (free, built-in):** AI Horde supports **`trusted_workers: true`** —
  route only to workers the Horde maintainers have vetted. Turn this on day one.
- **The Green Book itself:** a **deny-list of worker ids** that returned
  invalid/garbage/poisoned output, plus optionally a preferred allow-list. AI Horde
  requests accept `workers: [...]` and `worker_blacklist`.
- **Where it lives matters:** client-side (localStorage) → every user relearns,
  fragments, resets on cache-clear. **Server-side (Worker + KV)** → one user's
  discovery of a bad node protects EVERYONE. Put it in the Worker's KV.
- **Keep it simple:** a deny-list is ~90% of the value. Skip full trust-scoring
  until proven necessary. Footprint is negligible (worker ids are short strings;
  thousands = a few KB) — this is NOT where bundle weight goes.

---

## 7. NSFW PIPELINE — the biggest worry, armored, FAIL CLOSED

**Why it matters (operator's words, validated):** one porn image surfacing in
front of a coworker — or while a coworker is using it themselves — would "ruin any
future growth." This is a legitimate, adoption-killing risk, not paranoia. So:
**fail closed — uncertain means do NOT show.** Layered defense:

1. **Horde request flags (free, built-in):** send `nsfw: false` (routes only to
   SFW workers) **and** `censor_nsfw: true` (Horde runs its own safety checker and
   returns a censored image if a node produces NSFW). Stops the large majority.
2. **`trusted_workers: true`** — vetted nodes only; shrinks the malicious-node
   surface (also part of the Green Book).
3. **Prompt hygiene:** Lumina builds the image prompts from the book, so it
   controls them. Add a standing **negative prompt** (`nude, explicit, sexual,
   nsfw…`) and check the *generated prompt itself* isn't explicit — classic
   literature has steamy passages that can invite NSFW even unintentionally.
4. **Worker-side classifier (the strong gate):** because images already relay
   through the Worker, run an image-moderation model there via **Cloudflare
   Workers AI** (free tier). Flagged → blocked at Cloudflare, **never reaches the
   browser**; the reader sees a calm "image held — didn't pass safety check"
   placeholder. **Fail closed** on any uncertainty or classifier unavailability.
5. **Pre-baked = the only 100% guarantee.** No classifier is perfect (false
   negatives exist). Live generation is "best-effort, filtered"; the **pre-baked
   library is provably clean (human-reviewed)**. So: **demos / screenshots /
   showing-a-coworker should use pre-baked books.** Consider shipping a **"Safe
   demo mode"** that shows pre-baked imagery only.

Honest stance to bake into the UI/product: *live free images are filtered but not
guaranteed; the curated library is.* Lead demos with the guaranteed path.

---

## 8. IP MASKING

- Routing all external calls through the Worker means Horde/OpenRouter nodes see a
  **Cloudflare datacenter IP**, not the user's. For clinic/shelter networks and
  vulnerable users, a real privacy win.
- **Right-size the language:** it's a **relay, not a VPN.** It doesn't make traffic
  invisible — it shifts who sees the content from *random volunteer nodes* to
  *Cloudflare* (a big trust upgrade, but name it).
- **Images are the catch:** if the browser fetches a Horde CDN/R2 image URL
  directly, the IP leaks at download time. To truly mask (and to run §7
  classification), the Worker must fetch+relay the image bytes — bandwidth cost
  (see §5). The NSFW requirement and the masking requirement point at the SAME
  decision (relay images through the Worker), so you pay the bandwidth once for
  both wins.

---

## 9. SECURITY BASELINE & ZERO-TRUST MODEL (verified against current code)

### 9.1 The reassuring fact: XSS surface is currently ZERO
Verified by grep across `src/` at planning time:
- **No `dangerouslySetInnerHTML` anywhere.** No raw `.innerHTML =`. No
  `marked`/markdown→HTML rendering. (The one `marked` hit was a *variable name* in
  `LensStudio.tsx`, rendered as a React child.)
- The Study Guide / quizzes (`src/components/knowledge/StudyGuide.tsx`) render AI
  text as **React children**, which React **auto-escapes**. Safe today.

So the nightmare (a poisoned node injecting `<script>` that steals
`localStorage` keys) is **NOT reachable in the current code**, because the app
never injects AI text as HTML. The work is about **not opening that door**, not
closing an open one.

### 9.2 Per-backend threat model (don't conflate them)
- **TEXT (OpenRouter, or ANY AI text ever rendered as HTML):** risk = malformed
  JSON (→ defensive parsing + Zod schema in the Worker) and XSS *only if rendered
  as HTML*. Source-agnostic rule: **never render AI text as HTML without
  DOMPurify**, at that exact seam, regardless of source (Horde, OpenRouter, or
  local Odysseus). Today there is no such seam, so DOMPurify is not yet needed.
- **IMAGE (Horde):** risk = corrupt/garbage bytes (→ verify it decodes as an
  image) and inappropriate content (→ §7 NSFW pipeline). **No XSS** — images
  render as `<img src=blob>` and cannot execute. DOMPurify/schema do NOT apply to
  image bytes.

### 9.3 Mechanism correction (so future code isn't built on a myth)
Inline `<script>…</script>` injected via innerHTML/`dangerouslySetInnerHTML`
**does not execute** (HTML spec). The payloads that actually fire are
event-handler attributes — `<img src=x onerror=…>`, `<svg onload=…>`,
`javascript:` URLs. **DOMPurify strips all of them**, so the fix is right; just
don't model the threat on the one example that wouldn't run.

### 9.4 DOMPurify is trivial
`npm i dompurify`, then one call: `DOMPurify.sanitize(html)`. ~20KB. Only needed
the day a Markdown/rich-text renderer is added (e.g. if quizzes/guides switch to
HTML). Put it AT that seam, lazy-loaded with the renderer.

### 9.5 Validate every response, trust no node
The correct posture. Per-response validation (schema at the Worker + escaping/
sanitizing at the point of use) is deterministic and ungameable.

### 9.6 REJECTED: the "canary echo-check"
Idea was: pre-send a tiny test prompt; if a node answers cleanly, trust it for the
real call; else route to a clean backup. **Rejected because:**
1. AI Horde assigns jobs to a **pool** — you can't cheaply pin "test then trust"
   to the same worker.
2. **Doubles latency + kudos** on an already-slow free tier.
3. **Trivially defeated** — a node passes the tiny canary, then poisons the real
   call. False assurance.
4. **Unnecessary** — validating every response strictly dominates per-node
   pre-screening. Use `trusted_workers` + the Green Book deny-list + per-response
   validation instead.

---

## 10. CLIENT RESILIENCE (the `openrouter-free` provider + Horde client)

In `src/api/llmClient.ts` (current seam: `type LLMProvider = "odysseus" |
"gemini"`; `getProvider()`; `_callOdysseus`/`_callGemini`; the single-file-line
`runOdysseusSequential`). Add, behind the gate and lazy-loaded:

- **New provider** `"openrouter-free"` → points at the Worker URL. Keyless users
  default to it; key present → that provider.
- **Single-flight + bounded queue**, newest-wins dedup (same policy as the image
  queue) so an impatient double-tap doesn't pile calls.
- **Exponential backoff + jitter** on 429 / timeout / 5xx; honor upstream
  `Retry-After`; jitter so many phones don't retry in lockstep.
- **Bounded attempts + calm surrender:** after N tries, stop and say "the free
  tier is busy — try again shortly, or add a key for instant results." Never crash
  or silently hang.
- **Horde image client:** its own async submit→poll client (`/v2/generate/async`
  → `/check` → `/status`), routed through the Worker, with `nsfw:false`,
  `censor_nsfw:true`, `trusted_workers:true`, negative prompt, and the Green Book
  worker filters applied.

---

## 11. THE USER-FACING WARNING (consent gate for free mode)

Shown once when free mode is selected (this IS the "ask once"). Accurate
(text→free providers, images→Horde, audio on-device — no false "audio via
Horde"), keeps the operator's voice, and tells users how to do private work
safely:

---
**Heads up — how Lumina's free mode works**

To make Lumina free out of the box (no account, no API key), the default **free
mode** sends your text to **public, shared AI services**: free community model
providers for the reading analysis, and the **AI Horde** — a network of
volunteer-run computers — for the images. Your uploaded text leaves your device
and is processed on machines you don't control.

That openness is what makes it free for everyone. It also means you use it
responsibly:

**The rules:**
- **Books only.** Lumina is built for literature — use it only for works you
  personally own, public-domain titles, or books opened through OpenShelf.
- **Zero private data.** Never put personal documents, sensitive files, or
  work/client material in. Assume anything uploaded in free mode is seen by third
  parties.
- **Respect copyright.** Don't process restricted or privately-owned material
  without permission.

Stick to fiction and public literature and it works great. **Need privacy?** Add
your own API key or run a local Odysseus server — those keep everything off the
shared network.
---

---

## 12. FOOTPRINT DISCIPLINE (for the cheap-phone audience)

The bundle has "gotten significant since inception"; be mindful.
- **Lazy-load (`dynamic import`) the entire free-mode machinery behind the gate**
  — Horde client, OpenRouter-free client, any sanitizer/classifier helpers.
  Users on local/BYO download none of it.
- **Keep Zod in the Worker**, not the client.
- **DOMPurify only when an HTML-render seam exists**, lazy-loaded with it.
- The Green Book is KB — negligible; not a footprint concern.
- An on-device NSFW classifier (e.g. NSFWJS + TF.js) would be MB — prefer the
  **Worker-side** Cloudflare Workers AI classifier instead, to keep weight off the
  device.

---

## 13. OPEN QUESTIONS (decisions still owed by the operator)

1. **Confirm the four free-text model ids** on the live page; fix the Gemini id.
2. ~~Audio for free mode~~ — **RESOLVED (see §3A):** free script via `openrouter-free`,
   voice via on-device `speechSynthesis` (instructions-window only as fallback);
   pre-baked audio for starter books. Paid keys session-only.
3. **Horde identity:** anonymous key `0000000000` (slow), one shared registered
   key (drains/fairness), or register-per-user (best fairness, more friction).
4. **Which Cloudflare Workers AI model** for NSFW image classification.
5. **Naming:** keep "Knowledge Horde" as the umbrella vs "Free / Community mode."
6. **Keyless default:** silently use free mode vs the once-ask warning (the warning
   in §11 is the ask-once; recommended).
7. **Isolation boundary for outputs:** does a Horde image land in the same library
   as local ones (tagged with provenance), or a separate namespace?

---

## 14. IMPLEMENTATION ORDER (multi-session; each phase independently shippable)

- **Phase 0 — Capture.** This document. ✅
- **Phase 1 — Worker as universal egress (OpenRouter text).** Finalize
  `FREE_MODELS`, deploy the Worker (`wrangler login` → `secret put
  OPENROUTER_API_KEY` → `deploy`), per-IP KV limit. (Scaffold already in
  `cloudflare-openrouter-proxy/`.)
- **Phase 2 — Client free-text provider + the gate.** `openrouter-free` provider
  with backoff/queue/`Retry-After`; the hard gate (no construction when off) +
  lazy-load. Wire keyless → free path.
- **Phase 3 — Horde images + NSFW + Green Book.** Async Horde client relayed
  through the Worker; NSFW pipeline (Horde flags + Worker classifier, fail closed);
  `trusted_workers` + Green Book deny-list in KV; schema/zero-trust validation.
- **Phase 4 — Audio + consent UX.** On-device TTS; the §11 warning as the free-mode
  consent gate.
- **Phase 5 — Tie to the pre-baked floor.** Integrate PLANxvi Part One as the
  guaranteed tier; "Safe demo mode" (pre-baked imagery only).

---

## 15. GUIDING PHILOSOPHY (the through-line)

- **Every flexibility feature must be a controlled path** — the only way through,
  regulated, because each affects UX drastically.
- **Zero-trust on public compute. Fail closed.** Validate every response; never
  render AI text as HTML unsanitized; block-don't-show on NSFW uncertainty.
- **The gate isolates, de-leaks, and slims** — one mechanism, three wins.
- **The pre-baked floor is what makes a best-effort free tier acceptable** — it is
  always there when the free network isn't, and it is the guaranteed-clean demo
  path. Never let the free live path be the only thing standing between a new user
  and a blank (or worse) screen.
