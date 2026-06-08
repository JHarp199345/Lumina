/**
 * Audio Overview pipeline (PLANvii).
 *
 * A generated spoken EXPLANATION of a book — not verbatim narration. Multi-step:
 *
 *   chosen material (scope)
 *     → SHAPED SUMMARIZER (Gemini, driven by the reader's prompt + minutes + scope)
 *     → a short SUMMARY SCRIPT (spoken-style, sized to the chosen minutes)
 *     → NARRATION via Gemini TTS (voices only that short script)
 *     → WAV audio
 *
 * Runs entirely on the Google AI Studio key. Lower fidelity than ElevenLabs by
 * design — much cheaper and workable for an explanatory piece. Voice Studio's
 * ElevenLabs path is untouched.
 */

import { LUMINA_CONFIG } from "@/config";
import type { BookStructure, Chapter, SemanticMap } from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GOOGLE_KEY_NAME = "lumina_google_ai_key";

// Prebuilt Gemini TTS voices (a curated subset; the API accepts the voiceName).
export interface GeminiVoice {
  id: string;          // the prebuiltVoiceConfig.voiceName
  label: string;
  description: string;
}
export const GEMINI_VOICES: GeminiVoice[] = [
  { id: "Kore", label: "Kore", description: "Clear, neutral narrator" },
  { id: "Puck", label: "Puck", description: "Bright and upbeat" },
  { id: "Charon", label: "Charon", description: "Deep and measured" },
  { id: "Fenrir", label: "Fenrir", description: "Warm and grounded" },
  { id: "Aoede", label: "Aoede", description: "Smooth and expressive" },
  { id: "Leda", label: "Leda", description: "Soft and reflective" },
];

export interface OverviewScope {
  type: "whole" | "current" | "choose";
  chapterIds?: string[];   // for "choose"
  currentChapterIndex?: number; // for "current"
}

// ─── Scope resolution ──────────────────────────────────────────────────────────

function chaptersForScope(scope: OverviewScope, structure: BookStructure): Chapter[] {
  const all = structure.chapters;
  if (scope.type === "whole") return all;
  if (scope.type === "current") {
    const idx = Math.max(0, scope.currentChapterIndex ?? 0);
    const ch = all[idx];
    return ch ? [ch] : all.slice(0, 1);
  }
  // choose
  const ids = new Set(scope.chapterIds ?? []);
  const picked = all.filter((c) => ids.has(c.id));
  return picked.length > 0 ? picked : all;
}

/** Human label for the chosen scope, used as the artifact title. */
export function scopeLabel(scope: OverviewScope, structure: BookStructure): string {
  const chs = chaptersForScope(scope, structure);
  if (scope.type === "whole") return "Whole book overview";
  if (chs.length === 1) return `Overview · ${chs[0].title || "Chapter"}`;
  return `Overview · ${chs.length} chapters`;
}

// ─── Tier 1: instant outline from the ingestion map (no API call) ───────────────

export function buildScopeOutline(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);
  const lines: string[] = [];

  if (scope.type === "whole" && semanticMap) {
    lines.push(`This overview will cover "${structure.title}" by ${structure.author}.`);
    lines.push(`Overall emotional arc: ${semanticMap.arcShape}.`);
    const themes = collectThemes(semanticMap);
    if (themes.length) lines.push(`Central themes: ${themes.slice(0, 5).join(", ")}.`);
    lines.push("");
    lines.push("Chapter path:");
    chapters.forEach((c, i) => lines.push(`  ${i + 1}. ${c.title || `Chapter ${c.index + 1}`}`));
  } else {
    for (const c of chapters) {
      lines.push(`${c.title || `Chapter ${c.index + 1}`}:`);
      const scenes = semanticMap?.scenes.filter((s) => s.chapterId === c.id) ?? [];
      const motifs = unique(scenes.flatMap((s) => s.emotionalVector)).slice(0, 4);
      if (motifs.length) lines.push(`  Emotional notes: ${motifs.join(", ")}.`);
      const firstLine = (c.rawText || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (firstLine) lines.push(`  Opens: "${firstLine}…"`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

function collectThemes(map: SemanticMap): string[] {
  const fromBlueprint = (map.narrativeBlueprint as { centralThemes?: string[] } | undefined)?.centralThemes ?? [];
  if (fromBlueprint.length) return fromBlueprint;
  return unique(map.scenes.flatMap((s) => s.symbolicMotifs ?? []));
}
function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

// ─── Source context for the summarizer ──────────────────────────────────────────
// Whole-book scope grounds on the map outline (can't fit a whole book). Chapter
// scope includes the actual prose (it fits), for a faithful summary.

function buildSourceContext(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);

  if (scope.type === "whole") {
    return buildScopeOutline(scope, structure, semanticMap);
  }

  // Chapter scope — include real text, capped to a safe word budget.
  const MAX_WORDS = 6000;
  let budget = MAX_WORDS;
  const parts: string[] = [];
  for (const c of chapters) {
    const words = (c.rawText || "").split(/\s+/).filter(Boolean);
    const take = words.slice(0, Math.max(0, budget)).join(" ");
    budget -= words.length;
    parts.push(`## ${c.title || `Chapter ${c.index + 1}`}\n${take}`);
    if (budget <= 0) break;
  }
  return parts.join("\n\n");
}

// ─── Tier 2: richer outline suggestion (one Gemini call) ────────────────────────

export async function suggestOutline(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  apiKey: string
): Promise<string> {
  const context = buildSourceContext(scope, structure, semanticMap);
  const prompt = `You are helping a reader decide what an audio overview of this material should cover.
Write a short, readable outline (5–9 bullet points) of the key things an explanatory overview COULD cover.
Be concrete and specific to this material. Output only the outline, no preamble.

MATERIAL:
${truncateWords(context, 4000)}`;
  const text = await geminiText(prompt, apiKey, 700);
  return text.trim();
}

// ─── Script generation (the shaped summarizer) ──────────────────────────────────

export interface ScriptArgs {
  scope: OverviewScope;
  structure: BookStructure;
  semanticMap: SemanticMap | null;
  userPrompt: string;   // "" → use the default expert prompt
  minutes: number;
  apiKey: string;
  onProgress?: (msg: string) => void;
}

export async function generateOverviewScript(args: ScriptArgs): Promise<string> {
  const { scope, structure, semanticMap, userPrompt, minutes, apiKey, onProgress } = args;
  onProgress?.("Summarizing the material…");

  const targetWords = Math.round(minutes * LUMINA_CONFIG.AUDIO_OVERVIEW_WPM);
  const context = buildSourceContext(scope, structure, semanticMap);

  const instruction = userPrompt.trim()
    ? `Follow the reader's instruction as the primary guide:\n"${userPrompt.trim()}"`
    : `You are a subject-matter expert and an excellent teacher. Give a clear, structured breakdown of the material: explain it, teach it, simplify the hard parts, and expand on what matters. Open by framing what this material is and why it matters, develop the key ideas in a logical order, and close with the throughline a listener should walk away understanding.`;

  const prompt = `${instruction}

You have approximately ${minutes} minutes — about ${targetWords} spoken words. Aim close to that length; do not pad with filler to fill time.

Write CONTINUOUS SPOKEN NARRATION meant to be heard, not read. Do NOT include headings, bullet points, stage directions, speaker labels, or any markup — only the words to be spoken, in flowing paragraphs.

MATERIAL TO EXPLAIN:
${truncateWords(context, 7000)}`;

  const maxTokens = Math.min(8192, Math.round(targetWords * 2.2));
  const script = await geminiText(prompt, apiKey, maxTokens);
  return script.trim();
}

// ─── Gemini TTS synthesis ───────────────────────────────────────────────────────

export interface SynthResult {
  data: Uint8Array;        // WAV bytes
  mimeType: string;        // "audio/wav"
  durationSeconds: number;
}

export async function synthesizeOverviewAudio(
  script: string,
  voiceName: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<SynthResult> {
  const chunks = chunkText(script, LUMINA_CONFIG.AUDIO_OVERVIEW_TTS_CHUNK_CHARS);
  const pcmParts: Uint8Array[] = [];
  let sampleRate = 24000;

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Voicing part ${i + 1} of ${chunks.length}…`);
    const { pcm, rate } = await geminiTts(chunks[i], voiceName, apiKey);
    pcmParts.push(pcm);
    sampleRate = rate;
  }

  const pcm = concatBytes(pcmParts);
  const wav = pcmToWav(pcm, sampleRate, 1);
  const durationSeconds = pcm.length / (sampleRate * 2 /* 16-bit */ * 1 /* mono */);
  return { data: wav, mimeType: "audio/wav", durationSeconds };
}

async function geminiTts(
  text: string,
  voiceName: string,
  apiKey: string
): Promise<{ pcm: Uint8Array; rate: number }> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini TTS error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data?: string } }) => p?.inlineData?.data
  );
  const base64 = part?.inlineData?.data as string | undefined;
  const mime = (part?.inlineData?.mimeType as string | undefined) ?? "audio/L16;rate=24000";
  if (!base64) throw new Error("Gemini TTS returned no audio");
  const rateMatch = mime.match(/rate=(\d+)/);
  const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  return { pcm: base64ToBytes(base64), rate };
}

// ─── Full orchestration ─────────────────────────────────────────────────────────

export interface OverviewResult {
  script: string;
  audio: SynthResult;
}

export async function generateAudioOverview(args: ScriptArgs & { voiceName: string }): Promise<OverviewResult> {
  const script = await generateOverviewScript(args);
  if (!script) throw new Error("The summary came back empty — try again.");
  const audio = await synthesizeOverviewAudio(script, args.voiceName, args.apiKey, args.onProgress);
  return { script, audio };
}

// ─── Gemini text helper ─────────────────────────────────────────────────────────

async function geminiText(prompt: string, apiKey: string, maxOutputTokens: number): Promise<string> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
}

// ─── Encoding helpers ───────────────────────────────────────────────────────────

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Wrap raw 16-bit PCM in a minimal WAV container so the browser can play it. */
function pcmToWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);          // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);

  return new Uint8Array(buffer);
}

// ─── Text helpers ───────────────────────────────────────────────────────────────

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

/** Split text into chunks under maxChars, preferring sentence boundaries. */
function chunkText(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\s*\S+\s*$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}
