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
import { buildFinalImagePrompt } from "./visualDirector";

const IMAGEN_BASE = "https://generativelanguage.googleapis.com/v1beta";
const FAL_BASE = "https://queue.fal.run";

// Negative prompt applied to every generation
const NEGATIVE_PROMPT =
  "photorealistic, photograph, celebrity likeness, portrait photography, comic book, anime, cartoon, " +
  "manga, readable text, words, letters, watermarks, graphic gore, mutilation, " +
  "modern objects, low quality, digital art style, 3d render, CGI";

// ─── Main Generator ───────────────────────────────────────────────────────────

export interface GenerateImageOptions {
  scene: IdentifiedScene;
  styleSeed: StyleSeed;
  bookId: string;
  googleApiKey: string;
  falApiKey?: string;
  priorPaletteContext?: string; // from previous generations in this book
  onComplete?: (image: CachedImage) => void;
}

export async function generateImage(options: GenerateImageOptions): Promise<CachedImage> {
  const { scene, styleSeed, bookId, googleApiKey, falApiKey, priorPaletteContext } = options;

  // Build the full prompt
  const prompt = buildImagePrompt(scene, styleSeed, priorPaletteContext);
  const negativePrompt = scene.directorBrief?.negativePrompt ?? NEGATIVE_PROMPT;

  // Try Imagen 3 first
  let imageData: Uint8Array | null = null;
  let apiUsed: CachedImage["generationApi"] = "imagen3";

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

  if (!imageData) throw new Error("No image data returned");

  // Metadata without filePath — saveImage fills that in
  const meta = {
    id: `img_${scene.id}`,
    bookId,
    sceneId: scene.id,
    descriptionUsed: prompt,
    styleSeed: styleSeed.id,
    generatedAt: new Date().toISOString(),
    generationApi: apiUsed,
    emotionalThemes: scene.emotionalVector,
  };

  // Persist via the storage adapter (Tauri → disk + asset URL; Web → IndexedDB + blob URL)
  const filePath = await storage.saveImage(meta, imageData);

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
  if (scene.directorBrief) {
    const directorPrompt = buildFinalImagePrompt(scene.directorBrief, styleSeed);
    return priorPaletteContext
      ? `${directorPrompt} Maintain visual continuity with established style: ${priorPaletteContext}.`
      : directorPrompt;
  }

  const parts: string[] = [];

  // Core symbolic description
  parts.push(scene.imageDescription || buildFallbackDescription(scene));

  // Style seed injection
  parts.push(styleSeed.promptFragment);

  // Palette from seed
  parts.push(`Palette: ${styleSeed.paletteKeywords.join(", ")}`);

  // Style continuity (if not the first image)
  if (priorPaletteContext) {
    parts.push(`Maintain visual continuity with established style: ${priorPaletteContext}`);
  }

  // Universal quality directives
  parts.push(
    "Fine art quality. Depictive cinematic illustration. Show the actual scene clearly through the chosen art style. No readable text or writing. Faces gestural rather than portrait-like. Atmospheric and evocative."
  );

  return parts.join(". ");
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
