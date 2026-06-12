/**
 * Image Generation Pipeline
 *
 * Primary: Imagen 3 via Google AI Studio (same key as Gemini)
 * Fallbacks: Gemini native image generation, then Flux via fal.ai
 *
 * Style seed injected into every prompt.
 * Style continuity maintained via prior palette context.
 */

import type { IdentifiedScene, StyleSeed, CachedImage } from "@/types";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import { buildFinalImagePrompt, buildComfyUIPrompt, buildIterativePassPlan, buildNegativePrompt } from "./visualDirector";
import { getProvider, getOdysseusUrl, getOdysseusToken } from "@/api/llmClient";

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

// ─── Style Thumbnail Store ────────────────────────────────────────────────────

const THUMBS_MAX = 5;

export interface StyleThumbStore {
  thumbs: string[];       // JPEG data URLs, newest first (max THUMBS_MAX)
  pinned: string | null;  // if set, always shown in the picker
}

export const STYLE_THUMBS_KEY = (id: string) => `lumina:style_thumbs:${id}`;

export function loadStyleThumbs(id: string): StyleThumbStore {
  try {
    const raw = localStorage.getItem(STYLE_THUMBS_KEY(id));
    if (raw) return JSON.parse(raw) as StyleThumbStore;
  } catch { /* ignore */ }
  return { thumbs: [], pinned: null };
}

function _saveStyleThumbStore(id: string, store: StyleThumbStore): void {
  try {
    localStorage.setItem(STYLE_THUMBS_KEY(id), JSON.stringify(store));
  } catch { /* ignore quota errors */ }
}

export function pinStyleThumb(id: string, thumb: string): void {
  const store = loadStyleThumbs(id);
  store.pinned = store.pinned === thumb ? null : thumb; // toggle
  _saveStyleThumbStore(id, store);
  window.dispatchEvent(new CustomEvent("lumina:thumbs_updated"));
}

export function getDisplayThumb(id: string): string | null {
  const { thumbs, pinned } = loadStyleThumbs(id);
  if (pinned && thumbs.includes(pinned)) return pinned;
  if (thumbs.length === 0) return null;
  return thumbs[Math.floor(Math.random() * thumbs.length)];
}

/**
 * After a successful generation, downscale to a 320×180 JPEG thumbnail
 * and prepend it to this style's stored array (capped at THUMBS_MAX).
 * Fires a custom event so same-tab UI can refresh without polling.
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

  // Center-crop to 16:9
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

  const thumb = canvas.toDataURL("image/jpeg", 0.55);
  const store = loadStyleThumbs(styleSeedId);
  // Prepend; deduplicate exact match; cap length
  store.thumbs = [thumb, ...store.thumbs.filter((t) => t !== thumb)].slice(0, THUMBS_MAX);
  // If pinned thumb was evicted, clear pin
  if (store.pinned && !store.thumbs.includes(store.pinned)) store.pinned = null;
  _saveStyleThumbStore(styleSeedId, store);
  window.dispatchEvent(new CustomEvent("lumina:thumbs_updated"));
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
  onComplete?: (image: CachedImage) => void;
}

export async function generateImage(options: GenerateImageOptions): Promise<CachedImage> {
  const { scene, styleSeed, bookId, wordPosition, visualSlotKey, googleApiKey, falApiKey, priorPaletteContext } =
    options;

  // Build the full prompt
  const isExpository = Boolean(scene.expositoryBeat);
  const prompt = buildImagePrompt(scene, styleSeed, priorPaletteContext);
  const negativePrompt =
    scene.directorBrief?.negativePrompt ??
    (isExpository ? EXPOSITORY_NEGATIVE_PROMPT : NEGATIVE_PROMPT);

  let imageData: Uint8Array | null = null;
  let apiUsed: CachedImage["generationApi"] = "imagen3";

  if (getProvider() === "odysseus") {
    // Local path: iterative multi-pass refinement via Odysseus → ComfyUI.
    // Falls back to single-pass if the iterative endpoint isn't available.
    imageData = await generateWithComfyUIIterative(options.scene, options.styleSeed, prompt, negativePrompt);
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

  // Metadata without filePath — saveImage fills that in
  const meta = {
    id: `img_${scene.id}`,
    bookId,
    sceneId: scene.id,
    wordPosition,
    visualSlotKey,
    descriptionUsed: prompt,
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

  options.onComplete?.(cachedImage);
  return cachedImage;
}

// ─── Gemini Native Image Generation ──────────────────────────────────────────

async function generateWithGeminiImage(prompt: string, apiKey: string): Promise<Uint8Array> {
  const url = `${IMAGEN_BASE}/models/${LUMINA_CONFIG.GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
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
    return priorPaletteContext
      ? `${directorPrompt}, established palette: ${priorPaletteContext}`
      : directorPrompt;
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

// Extract palette context to pass to next generation
export function extractPaletteContext(styleSeed: StyleSeed, prevPrompts: string[]): string {
  const seedPalette = styleSeed.paletteKeywords.join(", ");
  return `${styleSeed.name} style with ${seedPalette}`;
}

// ─── Imagen 3 ─────────────────────────────────────────────────────────────────

async function generateWithImagen3(prompt: string, apiKey: string, negativePrompt: string): Promise<Uint8Array> {
  const url = `${IMAGEN_BASE}/models/${LUMINA_CONFIG.IMAGEN_MODEL}:predict?key=${apiKey}`;

  const response = await fetch(url, {
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
  const submitResponse = await fetch(`${FAL_BASE}/fal-ai/flux/dev`, {
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

    const pollResponse = await fetch(`${FAL_BASE}/fal-ai/flux/dev/requests/${requestId}`, {
      headers: { "Authorization": `Key ${falApiKey}` },
    });

    if (!pollResponse.ok) continue;

    const pollData = await pollResponse.json();
    if (pollData.status === "COMPLETED") {
      const imageUrl = pollData.output?.images?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL in Flux response");

      // Fetch the image bytes
      const imgResponse = await fetch(imageUrl);
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
  };

  const body = {
    pass1_prompt: passPlan?.pass1 ?? fallbackPrompt,
    pass2_prompt: passPlan?.pass2 ?? null,
    pass3_prompt: passPlan?.pass3 ?? null,
    negative_prompt: negativePrompt,
    width: 1024,
    height: 576,
    eval_spec: evalSpec,
    max_correction_passes: 2,
  };

  try {
    // Try the iterative endpoint first.
    const startRes = await fetch(`${base}/api/images/generate/iterative`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });

    if (startRes.ok) {
      const { job_id } = await startRes.json() as { job_id: string };
      return await pollComfyUIJob(job_id, base, authHeaders, 180);
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
  maxAttempts: number
): Promise<Uint8Array> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${base}/api/images/jobs/${jobId}`, { headers: authHeaders });
    if (!pollRes.ok) continue;
    const job = await pollRes.json() as { status: string; image_url?: string; error?: string };
    if (job.status === "done" && job.image_url) {
      const imgRes = await fetch(`${base}${job.image_url}`, { headers: authHeaders });
      if (!imgRes.ok) throw new Error(`Image fetch error ${imgRes.status}`);
      return new Uint8Array(await imgRes.arrayBuffer());
    }
    if (job.status === "error") throw new Error(`Generation failed: ${job.error ?? "unknown"}`);
  }
  throw new Error("ComfyUI generation timed out");
}

// ─── ComfyUI via Odysseus — single pass ──────────────────────────────────────

async function generateWithComfyUI(prompt: string, negativePrompt: string): Promise<Uint8Array> {
  const base = getOdysseusUrl();
  const token = getOdysseusToken();
  const authHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

  // POST returns immediately with a job_id — no long-lived connection through the tunnel.
  const startRes = await fetch(`${base}/api/images/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ prompt, negative_prompt: negativePrompt, width: 1024, height: 576 }),
  });
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
  return pollComfyUIJob(job_id, base, authHeaders, 120);
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

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}
