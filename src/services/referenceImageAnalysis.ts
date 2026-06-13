import { LUMINA_CONFIG } from "@/config";
import { getOdysseusToken, getOdysseusUrl, getProvider } from "@/api/llmClient";
import { storage } from "@/storage";
import { diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";
import type { ReferenceImageAnalysis, VisualReferenceImage } from "@/types";

interface ReferenceImageAnalysisResponse {
  summary?: string;
  visualTraits?: string[];
  palette?: string[];
  materials?: string[];
  compositionHints?: string[];
  lighting?: string[];
  mood?: string[];
  preserve?: string[];
  avoidCopying?: string[];
}

function normalizeList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeAnalysis(
  parsed: ReferenceImageAnalysisResponse,
  provider: ReferenceImageAnalysis["provider"]
): ReferenceImageAnalysis {
  return {
    summary: String(parsed.summary || "Reader reference image analyzed for broad visual traits."),
    visualTraits: normalizeList(parsed.visualTraits),
    palette: normalizeList(parsed.palette),
    materials: normalizeList(parsed.materials),
    compositionHints: normalizeList(parsed.compositionHints),
    lighting: normalizeList(parsed.lighting),
    mood: normalizeList(parsed.mood),
    preserve: normalizeList(parsed.preserve),
    avoidCopying: normalizeList(parsed.avoidCopying, [
      "Do not recreate the exact source image.",
      "Do not copy exact pose, composition, costume pattern, watermark, or artist style.",
    ]),
    provider,
    analyzedAt: new Date().toISOString(),
  };
}

function dataUrlParts(dataUrl?: string): { mimeType: string; base64: string } | null {
  if (!dataUrl?.startsWith("data:")) return null;
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function parseJsonText(text: string): ReferenceImageAnalysisResponse {
  const cleaned = text.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match?.[0] ?? cleaned) as ReferenceImageAnalysisResponse;
}

function buildPrompt(fileName: string): string {
  return `Analyze this reader-provided reference image for Lumina's image generation system.

The reader confirmed they own, created, licensed, or have permission to use the image.

Do not describe it as something to copy exactly. Extract broad visual guidance only.

Reference file: ${fileName}

Return JSON only:
{
  "summary": "one sentence summary of broad visual traits",
  "visualTraits": ["silhouette / subject / form traits"],
  "palette": ["dominant colors"],
  "materials": ["visible materials/textures"],
  "compositionHints": ["camera angle, framing, layout traits"],
  "lighting": ["lighting traits"],
  "mood": ["mood/atmosphere"],
  "preserve": ["broad qualities worth preserving"],
  "avoidCopying": ["specific things not to copy exactly"]
}`;
}

async function analyzeWithGemini(ref: VisualReferenceImage, apiKey?: string): Promise<ReferenceImageAnalysis | null> {
  const key = apiKey || await storage.loadApiKey("lumina_google_ai_key").catch(() => null);
  const image = dataUrlParts(ref.dataUrl);
  if (!key || !image) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: buildPrompt(ref.fileName) },
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini reference vision ${res.status}: ${text.slice(0, 160)}`);
  }

  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
  if (!text) throw new Error("Gemini reference vision returned no text.");
  return normalizeAnalysis(parseJsonText(text), "gemini");
}

async function analyzeWithOdysseus(ref: VisualReferenceImage): Promise<ReferenceImageAnalysis | null> {
  const image = dataUrlParts(ref.dataUrl);
  if (!image) return null;

  const base = getOdysseusUrl();
  const token = getOdysseusToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base}/api/vision/reference-image`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      file_name: ref.fileName,
      mime_type: image.mimeType,
      image_base64: image.base64,
      prompt: buildPrompt(ref.fileName),
    }),
  }).catch(() => null);

  if (!res || res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Odysseus reference vision ${res.status}: ${text.slice(0, 160)}`);
  }

  const payload = await res.json() as { analysis?: ReferenceImageAnalysisResponse; content?: string };
  const parsed = payload.analysis ?? (payload.content ? parseJsonText(payload.content) : {});
  return normalizeAnalysis(parsed, "odysseus");
}

export async function analyzeReferenceImage(ref: VisualReferenceImage): Promise<ReferenceImageAnalysis> {
  if (!ref.rightsConfirmed) {
    throw new Error("Confirm image ownership or permission before analyzing this reference.");
  }

  diagnosticInfo("visual_reference.analysis.start", "Analyzing reader reference image", {
    fileName: ref.fileName,
    provider: getProvider(),
  });

  try {
    if (getProvider() === "odysseus") {
      const local = await analyzeWithOdysseus(ref);
      if (local) return local;
    }
  } catch (err) {
    diagnosticWarn("visual_reference.odysseus_failed", "Odysseus reference analysis failed", {
      fileName: ref.fileName,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const gemini = await analyzeWithGemini(ref);
  if (gemini) return gemini;

  diagnosticWarn("visual_reference.analysis_unavailable", "No reference image analyzer available", {
    fileName: ref.fileName,
  });

  return normalizeAnalysis({
    summary: "Reference image stored, but no vision analyzer is configured.",
    avoidCopying: ["Do not copy the exact image."],
  }, "unavailable");
}
