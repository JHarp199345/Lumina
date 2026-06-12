# Lumina — LLM Backend Refactor Plan

**Goal:** Replace 15 files of hardcoded Google API URLs with a single configurable client  
**Result:** Lumina can point at Odysseus (local) or Google AI Studio (cloud) from a settings toggle  
**Status:** Planning — do not implement until each phase is approved  
**Companion plan:** `../odysseus/PLAN.md` covers the Odysseus agent council being built to receive these calls

---

## The Problem in One Diagram

```
TODAY — 15 files each own their own HTTP connection

semanticAnalyzer.ts      ──┐
expositoryAnalyzer.ts    ──┤
visualDirector.ts        ──┤
visualLore.ts            ──┤  POST generativelanguage.googleapis.com
studyRefiner.ts          ──┤       /v1beta/models/{model}:generateContent?key=GOOGLE_KEY
studyQuizzer.ts          ──┤
studyFlashcards.ts       ──┤
presentationStudio.ts    ──┤
narrativeThreads.ts      ──┤
storyShape.ts            ──┤
sourceProfile.ts         ──┤
workProtocol.ts          ──┘

imageGenerator.ts        ──→  POST imagen-3 (primary) / Gemini image / fal.ai Flux (fallbacks)

audioOverview.ts         ──→  POST Gemini TTS  +  Gemini generateContent
audioDirector.ts         ──→  POST ElevenLabs  (narration with word-alignment)


AFTER — one client, one config, one toggle

All 15 pipeline files
        │
        ▼
   src/api/llmClient.ts          ← new file, owns all HTTP
        │
        ├── provider = "gemini"   ──→  generativelanguage.googleapis.com  (unchanged cloud path)
        │
        └── provider = "odysseus" ──→  http://localhost:7860
                                         /api/agents/{name}/run     (text)
                                         /api/images/generate        (image)
                                         /api/tts/synthesize         (audio)
```

---

## Current State Inventory

### Hardcoded URLs — exact file and line

| File | Constant | Line | # of call sites |
|---|---|---|---|
| `src/pipeline/semanticAnalyzer.ts` | `GEMINI_BASE` | 34 | 2 (~590, ~640) |
| `src/pipeline/expositoryAnalyzer.ts` | `GEMINI_BASE` | 30 | 2 (~471, ~548) |
| `src/pipeline/visualDirector.ts` | `GEMINI_BASE` | 22 | 1 (~837) |
| `src/pipeline/visualLore.ts` | `GEMINI_BASE` | 10 | 1 (~149) |
| `src/pipeline/studyRefiner.ts` | `GEMINI_BASE` | 25 | 1 (~121) |
| `src/pipeline/studyQuizzer.ts` | `GEMINI_BASE` | 19 | 1 (~82) |
| `src/pipeline/studyFlashcards.ts` | `GEMINI_BASE` | 11 | 1 (~124) |
| `src/pipeline/presentationStudio.ts` | `GEMINI_BASE` | 43 | 1 (~468) |
| `src/pipeline/narrativeThreads.ts` | `GEMINI_BASE` | 32 | 1 (~359) |
| `src/pipeline/storyShape.ts` | `GEMINI_BASE` | 18 | 1 (~133) |
| `src/pipeline/sourceProfile.ts` | `GEMINI_BASE` | 21 | 1 (~406) |
| `src/pipeline/workProtocol.ts` | `GEMINI_BASE` | 19 | 1 (~315) |
| `src/pipeline/imageGenerator.ts` | `IMAGEN_BASE` + `FAL_BASE` | 16–17 | 3 (~62–82, ~241, ~274) |
| `src/pipeline/audioOverview.ts` | `GEMINI_BASE` | 29 | 2 (~306 TTS, ~364 text) |
| `src/pipeline/audioDirector.ts` | `ELEVEN_BASE` | 19 | several (TTS + alignment) |

**Total: 15 files, ~19 call sites across three distinct API shapes.**

### Three API call shapes in use

**Shape 1 — Text generation** (12 files, ~15 call sites)
```typescript
const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
const response = await fetch(url, {
  method: "POST",
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, topP, maxOutputTokens },
  }),
});
const data = await response.json();
return data.candidates[0].content.parts[0].text;
```

**Shape 2 — Image generation** (`imageGenerator.ts`)
```typescript
// Primary: Imagen 3
fetch(`${IMAGEN_BASE}/models/imagen-3.0-generate-002:predict?key=${apiKey}`, {
  body: JSON.stringify({ instances: [{ prompt }], parameters: { negativePrompt, ... } })
});
// Fallback 1: Gemini native image
fetch(`${GEMINI_BASE}/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`, { ... });
// Fallback 2: Flux via fal.ai async queue
fetch(`https://queue.fal.run/fal-ai/flux/dev`, { ... });  // + polling
```

**Shape 3 — TTS synthesis** (`audioOverview.ts`, `audioDirector.ts`)
```typescript
// Gemini TTS (audioOverview)
fetch(`${GEMINI_BASE}/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
  body: JSON.stringify({
    contents: [...],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    }
  })
});
// Returns: base64 WAV in candidates[0].content.parts[0].inlineData.data

// ElevenLabs (audioDirector — also returns word-level timing spans)
fetch(`${ELEVEN_BASE}/text-to-speech/${voiceId}/with-timestamps`, {
  headers: { "xi-api-key": elevenLabsKey },
  body: JSON.stringify({ text, model_id, voice_settings })
});
```

### How API keys flow today

```
storage.loadApiKey("lumina_google_ai_key")   ← called in the component
    │
    └──→ passed as apiKey parameter into every pipeline function
              └──→ appended to URL as  ?key=${apiKey}
```

This means `apiKey` (and sometimes `falApiKey`, `elevenLabsKey`) thread through many function signatures all the way down to the `fetch()` call. After the refactor, `llmClient` reads keys internally — the `apiKey` parameter disappears from all pipeline function signatures.

---

## What Changes

### Step 1 — New file: `src/api/llmClient.ts`

The entire refactor pivots on this one file. It owns:

1. Reading provider config and keys from storage at call time
2. Exporting the three typed functions that replace all 19 call sites
3. Routing each call to the right backend based on provider setting
4. Translating response shapes so all callers receive plain strings or bytes

**Exported API:**

```typescript
// Replaces Shape 1 — text generation
export async function generateContent(options: {
  task: keyof typeof LUMINA_CONFIG.AGENT_MAP;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string>

// Replaces Shape 2 — image generation
export async function generateImage(options: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
}): Promise<Uint8Array>

// Replaces Shape 3 — TTS
export async function synthesizeSpeech(options: {
  text: string;
  voice: string;
  chunkChars?: number;
}): Promise<Uint8Array>  // WAV bytes
```

**Routing logic inside `llmClient.ts`:**

```
generateContent(task="study_guide") + provider="odysseus"
  → POST localhost:7860/api/agents/curriculum/run
    body: { messages: [...], stream: false }
  → returns response.content

generateContent(task="study_guide") + provider="gemini"
  → POST generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=...
    body: { contents: [...], generationConfig: {...} }
  → returns candidates[0].content.parts[0].text
```

Both paths return the same `Promise<string>` — pipeline functions never see the difference.

### Step 2 — Additions to `src/config.ts`

Add to the bottom of `LUMINA_CONFIG` (no existing entries change):

```typescript
// Which backend to use by default. Overridden at runtime by the settings toggle.
DEFAULT_LLM_PROVIDER: "gemini" as "gemini" | "odysseus",

// Maps each Lumina pipeline task to an Odysseus agent name.
// Only consulted when provider = "odysseus".
AGENT_MAP: {
  semantic_analysis:    "curriculum",
  expository_analysis:  "reading",
  visual_direction:     "visual_analyst",
  image_generation:     "image_director",
  study_guide:          "curriculum",
  study_refine:         "curriculum",
  flashcards:           "quiz",
  quiz:                 "quiz",
  narrator_script:      "narrator",
  audio_overview:       "council",
  presentation:         "writer",
  source_profile:       "reading",
  visual_lore:          "visual_analyst",
  work_protocol:        "curriculum",
  story_shape:          "reading",
  narrative_threads:    "reading",
} as const,
```

### Step 3 — New functions in `src/hooks/useApiKeys.ts`

Add alongside existing `saveGoogleKey`, `loadGoogleKey`, etc.:

```typescript
export async function saveLlmProvider(provider: "gemini" | "odysseus"): Promise<void>
export async function loadLlmProvider(): Promise<"gemini" | "odysseus">
export async function saveOdysseusConfig(url: string, token: string): Promise<void>
export async function loadOdysseusConfig(): Promise<{ url: string; token: string }>
```

**New storage keys** (alongside existing `lumina_google_ai_key` etc.):

| Key | Values | Purpose |
|---|---|---|
| `lumina_llm_provider` | `"gemini"` \| `"odysseus"` | Active backend |
| `lumina_odysseus_url` | URL string | Odysseus base (default `http://localhost:7860`) |
| `lumina_odysseus_token` | Bearer token | Created in Odysseus → Settings → API Tokens |

### Step 4 — 12 text pipeline files (Shape 1)

Each file gets the same mechanical change:

**Remove** (1 line):
```typescript
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
```

**Add** (1 import line):
```typescript
import { generateContent } from "@/api/llmClient";
```

**Replace** the `fetch()` block. Example from `studyRefiner.ts:121`:

Before:
```typescript
const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  }),
});
if (!response.ok) throw new Error(`Gemini error ${response.status}`);
const data = await response.json();
const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
```

After:
```typescript
const text = await generateContent({
  task: "study_refine",
  messages: [{ role: "user", content: prompt }],
  temperature: 0.4,
  maxTokens: 8192,
});
```

**Remove `apiKey` from function signatures.** Every pipeline function that currently accepts `apiKey: string` drops that parameter. This is safe — `llmClient` reads it from storage.

Full list:

| File | task value |
|---|---|
| `semanticAnalyzer.ts` | `"semantic_analysis"` |
| `expositoryAnalyzer.ts` | `"expository_analysis"` |
| `visualDirector.ts` | `"visual_direction"` |
| `visualLore.ts` | `"visual_lore"` |
| `studyRefiner.ts` | `"study_refine"` |
| `studyQuizzer.ts` | `"quiz"` |
| `studyFlashcards.ts` | `"flashcards"` |
| `presentationStudio.ts` | `"presentation"` |
| `narrativeThreads.ts` | `"narrative_threads"` |
| `storyShape.ts` | `"story_shape"` |
| `sourceProfile.ts` | `"source_profile"` |
| `workProtocol.ts` | `"work_protocol"` |

### Step 5 — `src/pipeline/imageGenerator.ts` (Shape 2)

Remove `IMAGEN_BASE`, `FAL_BASE`.  
Remove `googleApiKey` and `falApiKey` from `GenerateImageOptions`.  
Replace the Imagen3 → Gemini-image → Flux fallback chain with:

```typescript
import { generateImage } from "@/api/llmClient";

// one call replaces the three-provider chain
const imageData = await generateImage({
  prompt,
  negativePrompt,
  aspectRatio: LUMINA_CONFIG.IMAGE_ASPECT_RATIO,
});
```

The fallback chain moves inside `llmClient`:
- Odysseus path: POST `/api/images/generate` → ComfyUI
- Gemini path: tries Imagen3, then Gemini-image, then fal.ai Flux (identical to today)

### Step 6 — `src/pipeline/audioOverview.ts` + `audioDirector.ts` (Shape 3)

**`audioOverview.ts`** — two call sites:
- Script generation (~364): replace with `generateContent({ task: "audio_overview", ... })`
- TTS synthesis (~306): replace with `synthesizeSpeech({ text: script, voice: voiceName })`

**`audioDirector.ts`** — ElevenLabs calls:
- Replace with `synthesizeSpeech({ text, voice: preset.providerVoiceName })`
- See Open Question #1 re: word-alignment data

Remove `apiKey` / `elevenLabsKey` from both files' function signatures.

### Step 7 — Caller cleanup in components

When pipeline functions lose `apiKey`, these component files need the same update at each call site — remove the `const apiKey = await storage.loadApiKey(...)` line and remove the argument:

| Component | Approximate lines |
|---|---|
| `src/components/knowledge/StudyGuide.tsx` | ~132, ~454, ~678 |
| `src/components/knowledge/AudioOverview.tsx` | wherever apiKey is passed |
| `src/components/knowledge/VoiceStudio.tsx` | wherever elevenLabsKey is passed |
| `src/components/knowledge/PresentationStudio.tsx` | wherever apiKey is passed |
| `src/components/layout/VisualPanel.tsx` | wherever googleApiKey / falApiKey is passed |
| `src/App.tsx` | ~130 |

### Step 8 — Settings UI: `ApiKeySetup.tsx` + `SettingsPanel.tsx`

Add a new section to both components:

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Backend                                                      │
│                                                                 │
│  ○ Google AI Studio   (uses the Google key above)               │
│  ● Local — Odysseus                                             │
│                                                                 │
│  Odysseus URL     [ http://localhost:7860              ]        │
│  API Token        [ ·····················              ]        │
│  (create one at Odysseus → Settings → API Tokens)               │
│                                                                 │
│  [ Test Connection ]    ✓ Connected · 6 agents available        │
└─────────────────────────────────────────────────────────────────┘
```

"Test Connection" calls `GET /api/agents` and shows agent count or an error.

When Odysseus is selected, the Google key field stays visible with a note:
> *Still used for image generation and TTS if local services are unavailable.*

---

## Complete File Change List

| File | Change | New / Modified |
|---|---|---|
| `src/api/llmClient.ts` | All routing logic lives here | **New** |
| `src/config.ts` | Add `DEFAULT_LLM_PROVIDER` + `AGENT_MAP` | Modified (+20 lines) |
| `src/hooks/useApiKeys.ts` | Add 4 storage functions | Modified (+~30 lines) |
| `src/components/common/ApiKeySetup.tsx` | Add backend toggle section | Modified |
| `src/components/common/SettingsPanel.tsx` | Add backend toggle section | Modified |
| `src/pipeline/semanticAnalyzer.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/expositoryAnalyzer.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/visualDirector.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/visualLore.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/studyRefiner.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/studyQuizzer.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/studyFlashcards.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/presentationStudio.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/narrativeThreads.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/storyShape.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/sourceProfile.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/workProtocol.ts` | Swap fetch, remove apiKey param | Modified |
| `src/pipeline/imageGenerator.ts` | Swap fetch chain, remove key params | Modified |
| `src/pipeline/audioOverview.ts` | Swap fetch ×2, remove apiKey param | Modified |
| `src/pipeline/audioDirector.ts` | Swap ElevenLabs fetch, remove key param | Modified |
| `src/components/knowledge/StudyGuide.tsx` | Remove apiKey threading | Modified |
| `src/components/knowledge/AudioOverview.tsx` | Remove apiKey threading | Modified |
| `src/components/knowledge/VoiceStudio.tsx` | Remove elevenLabsKey threading | Modified |
| `src/components/knowledge/PresentationStudio.tsx` | Remove apiKey threading | Modified |
| `src/components/layout/VisualPanel.tsx` | Remove googleApiKey/falApiKey threading | Modified |
| `src/App.tsx` | Remove apiKey threading | Modified |

**Total: 1 new file, 25 modified files.**  
**Net delta: ~19 `fetch()` blocks removed, ~19 `llmClient` calls added, ~25 `apiKey` argument removals.**

---

## Implementation Order

```
Step 1 — src/api/llmClient.ts             no dependencies, start here
Step 2 — src/config.ts                    AGENT_MAP needed by llmClient
Step 3 — src/hooks/useApiKeys.ts          storage helpers used by llmClient
Step 4 — 12 text pipeline files           all identical pattern, safe to batch
Step 5 — src/pipeline/imageGenerator.ts  different shape, do separately
Step 6 — audioOverview.ts + audioDirector.ts  TTS shape, do together
Step 7 — Component caller cleanup         must follow Steps 4–6 (signatures changed)
Step 8 — ApiKeySetup.tsx + SettingsPanel.tsx  can be done anytime after Step 3
Step 9 — tsc --noEmit                     catch any missed apiKey references
Step 10 — Manual test: Gemini path        confirm nothing regressed for cloud users
Step 11 — Manual test: Odysseus path      confirm routing reaches the right agent
```

Steps 4, 5, 6 are independent of each other. Steps 7 and 8 depend on 4–6 being complete.

---

## Phase 3 Enhancement — Parallel Agent Analysis

**Goal:** reduce book-processing time without corrupting the analysis order.

The semantic pass still owns the ground truth. Lumina cannot generate visuals, source
profiles, study material, audio overview plans, or presentation decks until the book has
a stable structure and semantic map. But the semantic work does not have to be one giant
single-file wait. Once the book structure and work protocol exist, the expensive section
analysis can be split across multiple non-overlapping workers.

### Dependency order

```
1. EPUB parse / structure
      ↓
2. Work protocol + global classification
      ↓
3. Parallel semantic section passes
      ↓
4. Merge / reconcile / score
      ↓
5. Dependent artifact builders
      ├─ visual plan / visual lore / storyboard
      ├─ source intelligence profile
      ├─ study guide / quizzes / flashcards
      ├─ presentation plan
      └─ audio overview plan
```

### Semantic section workers

After Step 2, Lumina divides the book into non-overlapping section ranges:

- by collection book when the EPUB contains multiple books
- otherwise by chapter groups
- otherwise by word-count windows with chapter boundaries respected

Example for a long novel:

```
Worker A: chapters 1-9
Worker B: chapters 10-18
Worker C: chapters 19-27
```

Each worker receives:

- the book title, author, and parser metadata
- the global work protocol
- its exact chapter/word range
- neighboring boundary summaries only, not overlapping full text
- a strict output schema

Each worker returns a partial semantic packet:

- local arc movement
- key events / claims / arguments
- characters, entities, settings, terms
- candidate visual scenes with absolute anchors
- unresolved mysteries / promises / payoffs
- study-worthy concepts
- confidence notes and weak spots

### Merge pass

The merge pass is not optional. Parallel workers create partial views, so Lumina needs a
single reducer step that turns those packets into one coherent semantic map.

The reducer should:

- dedupe repeated entities and scenes
- reconcile contradictions
- normalize all anchors to Lumina absolute positions
- choose final inflection points across the whole book
- preserve section-level findings for later retrieval
- produce one canonical `SemanticMap`
- produce optional auxiliary maps:
  - `sectionSemanticPackets`
  - `entityGraph`
  - `causalThreadMap`
  - `sourceProfileSeeds`

The useful mental model is:

```
whole_book_semantics =
  global_protocol
  + merge(section_packet_1, section_packet_2, section_packet_3, ...)
  + reducer_conflict_resolution
```

Not literally one equation in code, but the architecture should behave that way: many
section readings feeding one authoritative book understanding.

### Parallel artifact builders

After the canonical semantic map exists, several downstream builders can run side by
side because they consume the same stable map:

- visual lore dossier
- source intelligence profile
- study guide segmentation
- presentation outline
- audio overview source profile
- glossary / entity extraction

Image generation is different. It should remain slot-gated:

- one visual slot has one owner
- no duplicate generation for the same slot
- opening image may generate first
- read-ahead images generate lazily unless explicitly requested
- no regeneration unless explicit

### Concurrency controls

Add a small orchestration layer, not ad-hoc `Promise.all` calls everywhere.

Recommended defaults:

- semantic section workers: max 3 concurrent
- downstream text artifact builders: max 3 concurrent
- image generation: max 1 active slot by default
- audio generation: chunked queue, max 1 active chapter/chunk group unless explicitly streaming

The limit should be configurable because:

- Odysseus local hardware varies
- tunnel-backed requests can timeout
- cloud providers may rate-limit
- phone/tablet browsers have less memory

### Progress reporting

Parallel work must be visible in the UI, otherwise it will feel stuck.

Progress should show:

- current phase
- number of section workers complete
- which downstream builders are running
- failures per worker
- whether the final reducer succeeded

Example:

```
Semantic analysis
2 / 3 sections complete
Reducer waiting for final section...
```

Then:

```
Building artifacts
Visual lore complete · Source profile running · Study guide queued
```

### Failure behavior

If one section worker fails:

- retry once
- if it fails again, mark that section as thin
- reducer still runs with a visible warning
- downstream artifacts receive the warning so they avoid pretending certainty

If the reducer fails:

- do not generate images from partial section packets
- show "semantic merge failed"
- allow the reader to re-run analysis

### Implementation note

This should be built after the Odysseus routing refactor is stable. The first version
can live in a new orchestration service:

```typescript
src/services/parallelAnalysisOrchestrator.ts
```

It should call the existing semantic analyzer functions internally rather than forcing
every component to understand parallel workers. Components should still ask for one
thing: "analyze this book."

---

## Resolved Decisions

All open questions answered — record kept here so the reasoning is available when implementation starts.

---

### Image model: FLUX.1-schnell-fp8

**Decision:** FLUX.1-schnell-fp8 is the target checkpoint.

**Why:** Flux.1-schnell is the current industry standard for local image generation:
- Best quality-per-compute available for text-to-image on Apple Silicon
- Apache 2.0 license (free for personal/commercial use, no restrictions)
- 4-step generation (vs 20–50 for SDXL) — fast enough for read-ahead buffering
- Native ComfyUI support
- Fits in ~8 GB — runs well on M1 Max with Metal/MPS acceleration
- Handles painterly, symbolic, atmospheric styles well — matches Lumina's visual aesthetic

**What Lumina needs to know:** Nothing changes in Lumina code. `llmClient.generateImage()` calls Odysseus `/api/images/generate` and receives PNG bytes. The checkpoint selection is entirely inside Odysseus `local_agents.json`.

**Install instructions** (note for when Phase 2 is implemented):
```
# In ComfyUI/models/unet/
flux1-schnell-fp8.safetensors        (from huggingface.co/black-forest-labs/FLUX.1-schnell)

# In ComfyUI/models/clip/
clip_l.safetensors
t5xxl_fp8_e4m3fn.safetensors

# In ComfyUI/models/vae/
ae.safetensors
```

---

### Voice mapping: Lumina style presets → Kokoro voices

**Decision:** Odysseus `local_agents.json` owns this mapping. Lumina passes `style_preset` string; Kokoro voice ID is resolved server-side. Lumina needs no knowledge of Kokoro voice IDs.

| Lumina style preset | Kokoro voice ID | Character |
|---|---|---|
| `clear-narrator` | `af_sky` | Clear, neutral female — steady audiobook cadence |
| `warm-storyteller` | `af_bella` | Warm, expressive female — natural storytelling |
| `dark-dramatic` | `bm_george` | Deep British male — restrained tension |
| `quiet-intimate` | `af_sarah` | Soft, understated female — interior emotion |
| `epic-chronicle` | `bm_lewis` | Resonant British male — grand ceremonial |

**What Lumina needs to know:** Pass `style_preset` (the existing `AUDIO_STYLE_PRESETS[n].id` string) in the TTS request body. Do not pass raw Kokoro voice IDs.

---

### ElevenLabs word-alignment / read-along highlighting

**Decision:** Keep ElevenLabs as the sole provider for `audioDirector.ts` (chapter narration with read-along highlighting). On the Odysseus path, only `audioOverview.ts` (summary overviews) redirects to Kokoro.

**Why:** ElevenLabs returns per-word timing spans that Lumina maps onto book word positions for the read-along highlight bar. Kokoro returns raw WAV only. Rebuilding that alignment data from Kokoro would require forced-alignment tooling (Whisper or gentle) — significant extra work with no clear benefit since the current read-along feature is already a premium ElevenLabs use case.

**Effect on the refactor:**
- `audioDirector.ts` (narration): NOT refactored in Phase 2 — stays on ElevenLabs
- `audioOverview.ts` (summary scripts + overview TTS): IS refactored — text to Odysseus council agent, TTS to Kokoro
- Users who want full read-along narration still need an ElevenLabs key
- Users who only want audio overviews (summaries) can run fully local

---

### Image fallback when ComfyUI is offline

**Decision:** On the Odysseus path, if ComfyUI is not running, `llmClient.generateImage()` throws a clear error with instructions. Lumina shows a "Visual generation unavailable — ComfyUI is not running" notice in the visual panel. No silent fallback to Imagen3.

**Why:** Silent fallback would be confusing — the user chose local mode and should know when it's not working. The notice keeps the reading experience intact (text continues, visual panel shows the message) without blocking anything.

**What Lumina needs to know:** `llmClient.generateImage()` can throw `LLMServiceUnavailableError`. Visual panel should catch it and show the notice. This is a **note for Phase 2** — the error type needs to be defined and caught in `VisualPanel.tsx`.

---

### Streaming vs. blocking for study tools

**Decision:** Keep study tools blocking (wait for full response). No streaming progress UI in Phase 2.

**Why:** Odysseus local models are fast enough for study guide generation. Adding streaming would require changes to StudyGuide.tsx, AudioOverview.tsx, and others that go beyond the refactor scope. Can be added as a Phase 3 enhancement.

---

### AGENT_MAP task coverage audit

Full audit of every LLM-calling pipeline function against the AGENT_MAP:

| Pipeline function | File | task key | Agent |
|---|---|---|---|
| `analyzeBook` | semanticAnalyzer.ts | `semantic_analysis` | curriculum |
| `analyzeExpositoryBook` | expositoryAnalyzer.ts | `expository_analysis` | reading |
| `createVisualDirectorBrief(s)` | visualDirector.ts | `visual_direction` | visual_analyst |
| `buildVisualLoreDossier` | visualLore.ts | `visual_lore` | visual_analyst |
| `refineStudyGuide` | studyRefiner.ts | `study_refine` | curriculum |
| `generateSegmentQuiz` etc. | studyQuizzer.ts | `quiz` | quiz |
| `generateFlashcards` | studyFlashcards.ts | `flashcards` | quiz |
| `suggestPresentationPrompt` + `generatePresentationDeck` | presentationStudio.ts | `presentation` | writer |
| `buildNarrativeBlueprint` | narrativeThreads.ts | `narrative_threads` | reading |
| `analyzeStoryShape` | storyShape.ts | `story_shape` | reading |
| `buildSourceProfile` | sourceProfile.ts | `source_profile` | reading |
| `resolveWorkProtocol` | workProtocol.ts | `work_protocol` | curriculum |
| `generateOverviewScript` + `suggestFullerPrompt` | audioOverview.ts | `audio_overview` | council |
| `synthesizeOverviewAudio` | audioOverview.ts | TTS route | audio_director / Kokoro |
| `generateImage` | imageGenerator.ts | image route | image_director / ComfyUI |
| `generateNarration` | audioDirector.ts | **stays ElevenLabs** | — |

**`bookClassificationLookup.ts` calls Open Library (not an LLM) — no change needed.**

All 15 LLM-calling pipeline files are covered. No gaps in the AGENT_MAP.

---

### `task` type strictness

**Decision:** Use `keyof typeof LUMINA_CONFIG.AGENT_MAP` (strict). Compile-time guard is worth the minor inconvenience of updating `AGENT_MAP` when a new task type is added.

---

### Implementation start point

**Decision:** Start with the 12 text pipeline files (Steps 1–4) and confirm study guide generation through Odysseus works end-to-end before touching image or audio. This gives a complete working path with visible output quickly.

---

## Notes for Lumina Implementer

Things that need to happen on the Lumina side but are driven by decisions made in Odysseus:

1. **`LLMServiceUnavailableError`** — define this error class in `llmClient.ts`. `VisualPanel.tsx` should catch it and display a "ComfyUI offline" notice instead of a broken image slot.

2. **`style_preset` in TTS requests** — pass `AUDIO_STYLE_PRESETS[n].id` (e.g. `"clear-narrator"`) as the `style_preset` field in the `synthesizeSpeech()` call. Do not hardcode Kokoro voice IDs in Lumina — the mapping lives in Odysseus `local_agents.json` and can be updated there without touching Lumina.

3. **`audioDirector.ts` stays unchanged** — narration (chapter read-along) keeps ElevenLabs. Only `audioOverview.ts` routes through Odysseus.

4. **No Gemini key = "Install your API key"** — `llmClient.ts` should check: if provider=gemini and no key stored, throw the same error Lumina already handles (shows the setup prompt). If provider=odysseus and Odysseus is unreachable, throw `LLMServiceUnavailableError` with a "Check that Odysseus is running" message. No changes to the existing "no key" UI are needed.
