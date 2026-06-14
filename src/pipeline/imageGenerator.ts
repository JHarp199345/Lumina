/**
 * Image Generation Pipeline
 *
 * Primary: Imagen 3 via Google AI Studio (same key as Gemini)
 * Fallbacks: Gemini native image generation, then Flux via fal.ai
 *
 * Style seed injected into every prompt.
 * Style continuity maintained via prior palette context.
 */

import type { BlackboardNote, BookProfile, BookStructure, IdentifiedScene, StyleSeed, CachedImage, VisualCompositionArtifact } from "@/types";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import { buildFinalImagePrompt, buildComfyUIPrompt, buildIterativePassPlan, buildNegativePrompt } from "./visualDirector";
import { getProvider, getOdysseusUrl, getOdysseusToken, llmGenerate } from "@/api/llmClient";
import { buildReaderVisualDirectionPrompt, buildReaderVisualDirectionTags } from "@/utils/visualDirectionPrompt";
import {
  buildCompositionPrompt,
  getPassageForScene,
  makeCompositionArtifact,
  selectBookProfileItems,
} from "@/utils/bookProfile";

const IMAGEN_BASE = "https://generativelanguage.googleapis.com/v1beta";
const FAL_BASE = "https://queue.fal.run";

// Negative prompt applied to every generation
const NEGATIVE_PROMPT =
  "photorealistic, photograph, celebrity likeness, portrait photography, comic book, anime, cartoon, " +
  "manga, readable text, words, letters, watermarks, graphic gore, mutilation, " +
  "modern objects, low quality, digital art style, 3d render, CGI";

const EXPOSITORY_NEGATIVE_PROMPT =
  "fantasy art, watercolor painting, symbolic landscape, dramatic narrative scene, monster, creature, " +
  "boss battle, photorealistic photograph, celebrity likeness, readable text, words, letters, watermarks, " +
  "low quality, blurry, decorative flourish without information";

import { appendStyleThumb } from "@/utils/styleThumbs";

/**
 * After a successful generation, downscale to a 320×180 JPEG thumbnail
 * and store it so the SeedPicker can show real examples per style.
 */
async function saveStyleThumbnail(styleSeedId: string, dataUrl: string): Promise<void> {
  if (typeof document === "undefined") return;
  if (!dataUrl.startsWith("data:")) return;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const srcRatio = img.naturalWidth / img.naturalHeight;
  const tgtRatio = 320 / 180;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcRatio > tgtRatio) {
    sw = Math.round(sh * tgtRatio);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else {
    sh = Math.round(sw / tgtRatio);
    sy = Math.round((img.naturalHeight - sh) / 2);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 320, 180);

  appendStyleThumb(styleSeedId, canvas.toDataURL("image/jpeg", 0.55));
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export interface GenerateImageOptions {
  scene: IdentifiedScene;
  styleSeed: StyleSeed;
  bookId: string;
  /** Absolute word position in the book — stamped permanently on the image record. */
  wordPosition: number;
  /** EPUB file slot — one image per slot in cache and generation. */
  visualSlotKey?: string;
  googleApiKey: string;
  falApiKey?: string;
  priorPaletteContext?: string; // from previous generations in this book
  bookStructure?: BookStructure;
  bookProfile?: BookProfile | null;
  forceCompositionRefresh?: boolean;
  onComplete?: (image: CachedImage) => void;
}

export async function generateImage(options: GenerateImageOptions): Promise<CachedImage> {
  const { scene, styleSeed, bookId, wordPosition, visualSlotKey, googleApiKey, falApiKey, priorPaletteContext } =
    options;

  // Build the full prompt
  const isExpository = Boolean(scene.expositoryBeat);
  const compositionArtifact =
    getProvider() === "odysseus"
      ? await ensureSceneComposition(options).catch((err) => {
          console.warn("[ImageGen] Composition planning failed; falling back to director prompt:", err);
          return null;
        })
      : null;
  const prompt = compositionArtifact?.composition || buildImagePrompt(scene, styleSeed, priorPaletteContext);
  const negativePrompt =
    scene.directorBrief?.negativePrompt ??
    (isExpository ? EXPOSITORY_NEGATIVE_PROMPT : NEGATIVE_PROMPT);

  let imageData: Uint8Array | null = null;
  let apiUsed: CachedImage["generationApi"] = "imagen3";

  if (getProvider() === "odysseus") {
    // Local path: iterative multi-pass refinement via Odysseus → ComfyUI.
    // Falls back to single-pass if the iterative endpoint isn't available.
    try {
      imageData = await generateWithComfyUIIterative(options.scene, options.styleSeed, prompt, negativePrompt);
    } catch (err) {
      throw new Error(describeOdysseusImageError(err));
    }
    apiUsed = "comfyui";
  } else {
    // Cloud path: Imagen 3 → Gemini image → fal.ai Flux
    try {
      imageData = await generateWithImagen3(prompt, googleApiKey, negativePrompt);
    } catch (err) {
      console.warn("[ImageGen] Imagen failed, trying Gemini image fallback:", err);

      try {
        imageData = await generateWithGeminiImage(prompt, googleApiKey);
        apiUsed = "gemini-image";
      } catch (geminiErr) {
        console.warn("[ImageGen] Gemini image fallback failed:", geminiErr);

        if (falApiKey) {
          try {
            imageData = await generateWithFlux(prompt, falApiKey);
            apiUsed = "flux";
          } catch (fluxErr) {
            console.error("[ImageGen] Flux also failed:", fluxErr);
            throw new Error("Image generation failed on all available APIs");
          }
        } else {
          throw new Error(
            `Image generation failed. Imagen: ${describeError(err)}. Gemini image: ${describeError(geminiErr)}.`
          );
        }
      }
    }
  }

  if (!imageData) throw new Error("No image data returned");
  assertSupportedImageData(imageData);

  // Metadata without filePath — saveImage fills that in
  const imageIdentity = safeImageIdentity(bookId, visualSlotKey ?? scene.id);
  const meta = {
    id: `img_${imageIdentity}`,
    bookId,
    sceneId: scene.id,
    wordPosition,
    visualSlotKey,
    descriptionUsed: prompt,
    visualCompositionId: compositionArtifact?.id,
    visualComposition: compositionArtifact?.composition,
    styleSeed: styleSeed.id,
    generatedAt: new Date().toISOString(),
    generationApi: apiUsed,
    emotionalThemes: scene.emotionalVector,
  };

  // Persist via the storage adapter (Tauri → disk + asset URL; Web → IndexedDB + blob URL)
  const filePath = await storage.saveImage(meta, imageData);

  // Tag this style with a real thumbnail so the SeedPicker can show
  // actual generated examples instead of SVG placeholders.
  saveStyleThumbnail(styleSeed.id, filePath).catch(() => {});

  const cachedImage: CachedImage = { ...meta, filePath };
  await verifyImagePersisted(cachedImage);

  options.onComplete?.(cachedImage);
  return cachedImage;
}

async function ensureSceneComposition(options: GenerateImageOptions): Promise<VisualCompositionArtifact | null> {
  const { scene, styleSeed, bookId, visualSlotKey, bookStructure, bookProfile, forceCompositionRefresh } = options;
  if (!bookStructure || scene.expositoryBeat) return null;

  if (!forceCompositionRefresh && scene.visualComposition?.status === "ready") {
    return scene.visualComposition;
  }

  const existing = !forceCompositionRefresh
    ? await loadSavedComposition(bookId, scene.id, visualSlotKey)
    : null;
  if (existing) return existing;

  const profile = bookProfile ?? null;
  const passage = getPassageForScene(scene, bookStructure, profile);
  if (!passage.text.trim()) return null;

  const selectedItems = selectBookProfileItems({
    profile,
    scene,
    passage,
    limit: 10,
  });
  const prompt = buildCompositionPrompt({
    scene,
    styleSeed,
    passage,
    profileItems: selectedItems,
  });

  try {
    const raw = await llmGenerate("reading", prompt, {
      temperature: 0.42,
      maxTokens: 1100,
      think: false,
    });
    const composition = normalizeComposition(raw);
    if (composition.length < 160) {
      throw new Error("Composition response was too short to guide image generation.");
    }
    const artifact = await makeCompositionArtifact({
      bookId,
      scene,
      visualSlotKey,
      passage,
      composition,
      sourceItemIds: selectedItems.map((item) => item.id),
      provider: "odysseus",
      status: "ready",
    });
    await saveCompositionArtifact(artifact);
    return artifact;
  } catch (err) {
    const failed = await makeCompositionArtifact({
      bookId,
      scene,
      visualSlotKey,
      passage,
      composition: "",
      sourceItemIds: selectedItems.map((item) => item.id),
      provider: "odysseus",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    await saveCompositionArtifact(failed).catch(() => {});
    throw err;
  }
}

async function loadSavedComposition(
  bookId: string,
  sceneId: string,
  visualSlotKey?: string
): Promise<VisualCompositionArtifact | null> {
  const notes = await storage.loadBlackboardNotes(bookId).catch(() => [] as BlackboardNote[]);
  const note = notes
    .filter((candidate) => candidate.kind === "image")
    .find((candidate) => {
      const tags = new Set(candidate.tags.map((tag) => tag.toLowerCase()));
      if (!tags.has("visual-composition")) return false;
      if (!tags.has("ready")) return false;
      if (candidate.sceneId !== sceneId) return false;
      return !visualSlotKey || candidate.visualSlotKey === visualSlotKey;
    });
  if (!note?.body.trim()) return null;
  return {
    id: note.id,
    bookId,
    sceneId,
    visualSlotKey: note.visualSlotKey,
    startWord: note.startWord ?? 0,
    endWord: note.endWord ?? note.startWord ?? 0,
    wordPosition: note.startWord ?? 0,
    provider: "odysseus",
    textHash: note.sourceIds.find((id) => id.startsWith("text-hash:"))?.replace("text-hash:", "") ?? "",
    composition: note.body,
    sourceItemIds: note.sourceIds.filter((id) => id.startsWith("source-item:")).map((id) => id.replace("source-item:", "")),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    status: "ready",
  };
}

async function saveCompositionArtifact(artifact: VisualCompositionArtifact): Promise<void> {
  const timestamp = new Date().toISOString();
  const note: BlackboardNote = {
    id: artifact.id,
    bookId: artifact.bookId,
    blackboardId: `${artifact.bookId}:blackboard`,
    kind: "image",
    title: artifact.status === "ready" ? "Saved visual composition" : "Failed visual composition",
    body: artifact.composition || artifact.error || "",
    tags: [
      "visual-composition",
      artifact.provider,
      artifact.status,
      artifact.visualSlotKey ?? "",
    ].filter(Boolean),
    sourceIds: [
      artifact.sceneId,
      artifact.visualSlotKey ?? "",
      `text-hash:${artifact.textHash}`,
      ...artifact.sourceItemIds.map((id) => `source-item:${id}`),
    ].filter(Boolean),
    sceneId: artifact.sceneId,
    visualSlotKey: artifact.visualSlotKey,
    startWord: artifact.startWord,
    endWord: artifact.endWord,
    confidence: artifact.status === "ready" ? 0.92 : 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
  await storage.saveBlackboardNotes([note]);
}

function normalizeComposition(raw: string): string {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, "").replace(/```/g, ""))
    .replace(/^["']|["']$/g, "")
    .trim();
  const paragraphs = cleaned
    .split(/\n{2,}|\r{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((part) => {
      const lower = part.toLowerCase();
      if (/^(requirements|format exemplar|scene target|reader visual direction|relevant profile items|source passage)\b/.test(lower)) {
        return false;
      }
      if (/^(lumina|convert|return only|length:|tense:|single frame:)/i.test(part)) return false;
      if (/^\*|^-|^["“]/.test(part)) return false;
      if (lower.includes("critique") || lower.includes("too short") || lower.includes("needs more")) return false;
      return part.split(/\s+/).length >= 45;
    });
  const candidate = paragraphs[paragraphs.length - 1] ?? cleaned.replace(/\s+/g, " ").trim();
  return trimToCompleteSentence(candidate).slice(0, 1800);
}

function trimToCompleteSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^([\s\S]*[.!?])(?:\s|$)/);
  if (match?.[1] && match[1].split(/\s+/).length >= 55) return match[1].trim();
  return normalized.replace(/[,:;–—-]\s*$/, "").trim();
}

// ─── Gemini Native Image Generation ──────────────────────────────────────────

async function generateWithGeminiImage(prompt: string, apiKey: string): Promise<Uint8Array> {
  const url = `${IMAGEN_BASE}/models/${LUMINA_CONFIG.GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini image error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inlinePart = parts.find((part: unknown) => {
    const p = part as { inlineData?: unknown; inline_data?: unknown };
    return p.inlineData || p.inline_data;
  }) as { inlineData?: { data?: string }; inline_data?: { data?: string } } | undefined;
  const base64 = inlinePart?.inlineData?.data ?? inlinePart?.inline_data?.data;
  if (!base64) {
    const text = parts
      .map((part: { text?: string }) => part.text)
      .filter(Boolean)
      .join(" ")
      .trim();
    throw new Error(text || "No image in Gemini image response");
  }

  return base64ToUint8Array(base64);
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildImagePrompt(
  scene: IdentifiedScene,
  styleSeed: StyleSeed,
  priorPaletteContext?: string
): string {
  if (scene.expositoryBeat) {
    return buildExpositoryImagePrompt(scene, styleSeed, priorPaletteContext);
  }

  if (scene.directorBrief) {
    // Local diffusion models (ComfyUI/Flux) need dense tag-format prompts, not
    // the structured scene-direction prose that Imagen3/Gemini understand.
    const directorPrompt = getProvider() === "odysseus"
      ? buildComfyUIPrompt(scene.directorBrief, styleSeed)
      : buildFinalImagePrompt(scene.directorBrief, styleSeed);
    const readerDirection = getProvider() === "odysseus"
      ? buildReaderVisualDirectionTags(scene)
      : buildReaderVisualDirectionPrompt(scene);
    return [
      directorPrompt,
      readerDirection,
      priorPaletteContext ? `established palette: ${priorPaletteContext}` : "",
    ].filter(Boolean).join(getProvider() === "odysseus" ? ", " : "\n\n");
  }

  const description = scene.imageDescription || buildFallbackDescription(scene);

  if (getProvider() === "odysseus") {
    // Tag-format for local diffusion models: description first, then compact tags.
    const tags = [
      ...scene.emotionalVector.slice(0, 3),
      ...scene.atmosphericQualities.slice(0, 2),
      ...scene.symbolicMotifs.slice(0, 3),
      ...styleSeed.paletteKeywords.slice(0, 3),
      styleSeed.promptFragment,
      buildReaderVisualDirectionTags(scene),
      "fine art quality",
      "no text",
      "no watermark",
      priorPaletteContext ? `palette: ${priorPaletteContext}` : "",
    ].filter(Boolean);
    return `${description}, ${tags.join(", ")}`;
  }

  const parts: string[] = [];
  parts.push(description);
  parts.push(styleSeed.promptFragment);
  const readerDirection = buildReaderVisualDirectionPrompt(scene);
  if (readerDirection) parts.push(readerDirection);
  parts.push(`Palette: ${styleSeed.paletteKeywords.join(", ")}`);
  if (priorPaletteContext) {
    parts.push(`Maintain visual continuity with established style: ${priorPaletteContext}`);
  }
  parts.push(
    "Fine art quality. Depictive cinematic illustration. Show the actual scene clearly through the chosen art style. No readable text or writing. Faces gestural rather than portrait-like. Atmospheric and evocative."
  );
  return parts.join(". ");
}

function buildExpositoryImagePrompt(
  scene: IdentifiedScene,
  styleSeed: StyleSeed,
  priorPaletteContext?: string
): string {
  const beat = scene.expositoryBeat!;
  const parts: string[] = [];

  parts.push(scene.imageDescription || `Educational diagram: ${beat.centralClaim}`);
  parts.push(beat.domainStyleHint);
  parts.push(
    `Infographic layout type: ${beat.visualType}. Section: "${beat.sectionTitle}". ` +
      `Key concepts to depict visually: ${beat.keyTerms.join(", ") || beat.centralClaim}.`
  );

  // Muted palette from seed for series consistency without painterly fiction look
  parts.push(`Color palette accents: ${styleSeed.paletteKeywords.slice(0, 4).join(", ")}.`);

  if (priorPaletteContext) {
    parts.push(`Maintain diagram series consistency: ${priorPaletteContext}`);
  }

  parts.push(
    "Educational textbook infographic quality. Clear visual hierarchy. Information-dense explanatory diagram. " +
      "Use abstract label bars and annotation callouts — no readable words or letters. " +
      "No fantasy illustration, no narrative scene, no symbolic watercolor."
  );

  return parts.join(" ");
}

function buildFallbackDescription(scene: IdentifiedScene): string {
  const emotions = scene.emotionalVector.slice(0, 2).join(" and ");
  const motifs = scene.symbolicMotifs.slice(0, 3).join(", ");
  return `Depictive cinematic book illustration evoking ${emotions}, with readable scene action and visual motifs of ${motifs}`;
}

function safeImageIdentity(...parts: string[]): string {
  return parts
    .join("__")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 180);
}

// Extract palette context to pass to next generation
export function extractPaletteContext(styleSeed: StyleSeed, prevPrompts: string[]): string {
  const seedPalette = styleSeed.paletteKeywords.join(", ");
  return `${styleSeed.name} style with ${seedPalette}`;
}

// ─── Imagen 3 ─────────────────────────────────────────────────────────────────

async function generateWithImagen3(prompt: string, apiKey: string, negativePrompt: string): Promise<Uint8Array> {
  const url = `${IMAGEN_BASE}/models/${LUMINA_CONFIG.IMAGEN_MODEL}:predict?key=${apiKey}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: LUMINA_CONFIG.IMAGE_ASPECT_RATIO,
        negativePrompt,
        personGeneration: "ALLOW_ADULT",
        safetySetting: "BLOCK_MOST",
        addWatermark: false,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Imagen 3 error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const base64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!base64) throw new Error("No image in Imagen 3 response");

  return base64ToUint8Array(base64);
}

// ─── Flux (fal.ai) Fallback ───────────────────────────────────────────────────

async function generateWithFlux(prompt: string, falApiKey: string): Promise<Uint8Array> {
  // Submit to Flux queue
  const submitResponse = await fetchWithTimeout(`${FAL_BASE}/fal-ai/flux/dev`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${falApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      image_size: "landscape_16_9",
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    }),
  });

  if (!submitResponse.ok) {
    throw new Error(`Flux submit error ${submitResponse.status}`);
  }

  const submitData = await submitResponse.json();
  const requestId = submitData.request_id;
  if (!requestId) throw new Error("No request ID from Flux");

  // Poll for result (Flux is async)
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(2000);

    const pollResponse = await fetchWithTimeout(`${FAL_BASE}/fal-ai/flux/dev/requests/${requestId}`, {
      headers: { "Authorization": `Key ${falApiKey}` },
    });

    if (!pollResponse.ok) continue;

    const pollData = await pollResponse.json();
    if (pollData.status === "COMPLETED") {
      const imageUrl = pollData.output?.images?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL in Flux response");

      // Fetch the image bytes
      const imgResponse = await fetchWithTimeout(imageUrl);
      const arrayBuffer = await imgResponse.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }

    if (pollData.status === "FAILED") {
      throw new Error("Flux generation failed");
    }
  }

  throw new Error("Flux generation timed out");
}

// ─── ComfyUI via Odysseus — iterative multi-pass ─────────────────────────────

async function generateWithComfyUIIterative(
  scene: IdentifiedScene,
  styleSeed: StyleSeed,
  fallbackPrompt: string,
  negativePrompt: string
): Promise<Uint8Array> {
  const base = getOdysseusUrl();
  const token = getOdysseusToken();
  const authHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

  // Build the three-pass plan when we have a director brief; fall back to
  // single-pass with the already-built prompt otherwise.
  const passPlan = scene.directorBrief
    ? buildIterativePassPlan(scene.directorBrief, styleSeed)
    : null;

  // Build the evaluation spec so the vision evaluator knows what to look for.
  const evalSpec = {
    required_elements: scene.directorBrief?.concreteAnchors ?? [],
    lore_entities: scene.directorBrief?.loreEntityNames ?? [],
    dominant_emotion: scene.directorBrief?.dominantEmotion ?? scene.emotionalVector[0] ?? "",
    focal_point: scene.directorBrief?.blocking.focalPoint ?? "",
    palette: scene.directorBrief?.palette ?? styleSeed.paletteKeywords,
    reader_visual_direction: scene.publicVisualBrief
      ? buildReaderVisualDirectionPrompt(scene)
      : "",
  };

  // Default to a single fast Flux pass. Multi-pass img2img + vision correction is
  // opt-in (LOCAL_ITERATIVE_REFINEMENT): on MPS it evicts Flux from memory and can
  // balloon one image to many minutes, which reads as "hung" on mobile. The server
  // also enforces this (single-pass when no pass2/3/eval is sent), so both old and
  // new clients stay reliable.
  const refine = LUMINA_CONFIG.LOCAL_ITERATIVE_REFINEMENT;
  const body = {
    pass1_prompt: passPlan?.pass1 ?? fallbackPrompt,
    pass2_prompt: refine ? (passPlan?.pass2 ?? null) : null,
    pass3_prompt: refine ? (passPlan?.pass3 ?? null) : null,
    negative_prompt: negativePrompt,
    // ~1 MP (16:9, both divisible by 16) — Flux's detail sweet spot. Verified on
    // MPS: 1280x720 keeps fine metal/wood/paper detail at ~80s single pass.
    width: 1280,
    height: 720,
    eval_spec: refine ? evalSpec : null,
    max_correction_passes: refine ? 2 : 0,
  };

  try {
    // Try the iterative endpoint first.
    const startRes = await fetchWithTimeout(
      `${base}/api/images/generate/iterative`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
      },
      LUMINA_CONFIG.LOCAL_IMAGE_FETCH_TIMEOUT_MS
    );

    if (startRes.ok) {
      const { job_id } = await startRes.json() as { job_id: string };
      return await pollComfyUIJob(job_id, base, authHeaders, LUMINA_CONFIG.LOCAL_IMAGE_JOB_TIMEOUT_MS);
    }

    // If 404, iterative endpoint not yet deployed — fall through to single-pass.
    if (startRes.status !== 404) {
      const msg = await startRes.text().catch(() => "");
      throw new Error(`ComfyUI iterative queue error ${startRes.status}: ${msg}`);
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes("iterative queue error")) {
      throw err; // real error, not a 404 fallthrough
    }
  }

  // Fallback: single-pass
  return generateWithComfyUI(fallbackPrompt, negativePrompt);
}

async function pollComfyUIJob(
  jobId: string,
  base: string,
  authHeaders: Record<string, string>,
  timeoutMs: number
): Promise<Uint8Array> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    const pollRes = await fetchWithTimeout(
      `${base}/api/images/jobs/${jobId}`,
      { headers: authHeaders },
      LUMINA_CONFIG.LOCAL_IMAGE_FETCH_TIMEOUT_MS
    );
    if (!pollRes.ok) continue;
    const job = await pollRes.json() as { status: string; image_url?: string; error?: string };
    if (job.status === "done" && job.image_url) {
      const imageUrl = resolveRemoteImageUrl(base, job.image_url);
      const imgRes = await fetchWithTimeout(
        imageUrl,
        { headers: authHeaders },
        LUMINA_CONFIG.LOCAL_IMAGE_FETCH_TIMEOUT_MS
      );
      if (!imgRes.ok) throw new Error(`Image fetch error ${imgRes.status}`);
      return new Uint8Array(await imgRes.arrayBuffer());
    }
    if (job.status === "error") throw new Error(`Generation failed: ${job.error ?? "unknown"}`);
  }
  throw new Error(`ComfyUI generation timed out after ${Math.round(timeoutMs / 60000)} min`);
}

// ─── ComfyUI via Odysseus — single pass ──────────────────────────────────────

async function generateWithComfyUI(prompt: string, negativePrompt: string): Promise<Uint8Array> {
  const base = getOdysseusUrl();
  const token = getOdysseusToken();
  const authHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

  // POST returns immediately with a job_id — no long-lived connection through the tunnel.
  const startRes = await fetchWithTimeout(
    `${base}/api/images/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ prompt, negative_prompt: negativePrompt, width: 1024, height: 576 }),
    },
    LUMINA_CONFIG.LOCAL_IMAGE_FETCH_TIMEOUT_MS
  );
  if (!startRes.ok) {
    const msg = await startRes.text().catch(() => "");
    if (startRes.status === 401 || startRes.status === 403) {
      throw new Error(
        `Odysseus image auth failed (${startRes.status}). Check your API token in Settings.`
      );
    }
    throw new Error(`ComfyUI queue error ${startRes.status}: ${msg}`);
  }
  const { job_id } = await startRes.json() as { job_id: string };
  return pollComfyUIJob(job_id, base, authHeaders, LUMINA_CONFIG.LOCAL_IMAGE_JOB_TIMEOUT_MS);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRemoteImageUrl(base: string, imageUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return new URL(imageUrl, `${base.replace(/\/+$/, "")}/`).toString();
}

function imageMimeType(data: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function assertSupportedImageData(data: Uint8Array): void {
  if (data.length < 16) {
    throw new Error(`Image engine returned too few bytes (${data.length})`);
  }
  if (imageMimeType(data)) return;
  const preview = new TextDecoder()
    .decode(data.slice(0, Math.min(data.length, 160)))
    .replace(/\s+/g, " ")
    .trim();
  throw new Error(`Image engine returned non-image data${preview ? `: ${preview.slice(0, 120)}` : ""}`);
}

function describeOdysseusImageError(err: unknown): string {
  const base = getOdysseusUrl();
  const message = describeError(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return (
      `Odysseus image request could not reach ${base}. ` +
      "If Lumina is running from GitHub Pages or a phone/tablet, the local Odysseus server must allow browser private-network requests. " +
      `Original error: ${message}`
    );
  }
  return message;
}

async function verifyImagePersisted(image: CachedImage): Promise<void> {
  const saved = await storage.loadImages(image.bookId);
  const match = saved.find(
    (candidate) =>
      candidate.id === image.id ||
      (!!image.visualSlotKey && candidate.visualSlotKey === image.visualSlotKey) ||
      candidate.sceneId === image.sceneId
  );
  if (!match) {
    throw new Error(
      `Image was generated but not found in Lumina storage after save (book=${image.bookId}, scene=${image.sceneId}, slot=${image.visualSlotKey ?? "none"})`
    );
  }
  if (image.visualSlotKey && match.visualSlotKey && match.visualSlotKey !== image.visualSlotKey) {
    throw new Error(
      `Image saved under the wrong visual slot (${match.visualSlotKey}); expected ${image.visualSlotKey}`
    );
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = LUMINA_CONFIG.IMAGE_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      throw new Error(`Image engine request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}
