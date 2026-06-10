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
import { llmGenerate, getProvider, getOdysseusUrl, getOdysseusToken } from "@/api/llmClient";
import {
  buildExpositoryScopeOutline,
  buildExpositorySourceContext,
  defaultKnowledgeSpine,
  knowledgeProtocol,
  knowledgeWorkType,
  suggestPromptFraming,
} from "@/pipeline/knowledgeGrounding";
import { profileGroundingText } from "@/pipeline/sourceProfile";
import type { BookStructure, Chapter, SemanticMap, SourceIntelligenceProfile } from "@/types";

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

// Local Kokoro voices (via Odysseus /api/tts/synthesize, style_preset field).
export interface KokoroVoice {
  id: string;         // style_preset sent to the TTS endpoint
  label: string;
  description: string;
}
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: "clear-narrator",   label: "Sky",    description: "Clear, neutral narrator" },
  { id: "warm-storyteller", label: "Bella",  description: "Warm and expressive" },
  { id: "dark-dramatic",    label: "George", description: "Deep and measured" },
  { id: "quiet-intimate",   label: "Sarah",  description: "Soft and reflective" },
  { id: "epic-chronicle",   label: "Lewis",  description: "Epic and resonant" },
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
  const shorten = (t: string) => (t.length > 28 ? t.slice(0, 27) + "…" : t);
  const titles = chs.map((c) => shorten(c.title || `Ch ${c.index + 1}`));
  if (chs.length === 2) return `Overview · ${titles[0]} & ${titles[1]}`;
  return `Overview · ${titles[0]}, ${titles[1]} +${chs.length - 2}`;
}

// ─── Tier 1: instant outline from the ingestion map (no API call) ───────────────

export function buildScopeOutline(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null
): string {
  const protocol = knowledgeProtocol(semanticMap);
  if (protocol === "expository") {
    return buildExpositoryScopeOutline(scope, structure, semanticMap);
  }

  const chapters = chaptersForScope(scope, structure);
  const lines: string[] = [];

  if (scope.type === "whole" && semanticMap) {
    lines.push(`This overview will cover "${structure.title}" by ${structure.author}.`);
    lines.push(`Overall emotional arc: ${semanticMap.arcShape}.`);
    const themes = collectNarrativeThemes(semanticMap);
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

function collectNarrativeThemes(map: SemanticMap): string[] {
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
  const protocol = knowledgeProtocol(semanticMap);

  if (scope.type === "whole") {
    return buildScopeOutline(scope, structure, semanticMap);
  }

  if (protocol === "expository") {
    return buildExpositorySourceContext(scope, structure, semanticMap);
  }

  const chapters = chaptersForScope(scope, structure);

  // Chapter scope — include real text, capped to a safe word budget.
  const MAX_WORDS = 10000;
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

/** Expand or refine an overview angle into a full, actionable instruction paragraph. */
export async function suggestFullerPrompt(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  apiKey: string,
  options: {
    angleLabel?: string;
    seedPlan?: string;
    profile?: SourceIntelligenceProfile | null;
  } = {}
): Promise<string> {
  const { angleLabel, seedPlan, profile } = options;
  const context = profile
    ? `${profileGroundingText(profile)}\n\n${buildSourceContext(scope, structure, semanticMap)}`
    : buildSourceContext(scope, structure, semanticMap);

  const angleLine = angleLabel ? `Angle: "${angleLabel}".` : "";
  const seedLine = seedPlan?.trim()
    ? `Build on this starting instruction (expand and sharpen it, do not shorten it):\n${seedPlan.trim()}`
    : "Write a fresh, book-specific instruction from the material below.";

  const protocol = knowledgeProtocol(semanticMap, profile);
  const prompt = `You are helping a reader shape what an audio overview should explain.
${angleLine}
${seedLine}

Write ONE continuous instruction paragraph (4–8 sentences) that a narrator could follow directly.
${suggestPromptFraming(protocol)}
No bullet points, no preamble, no headings — only the instruction text.

MATERIAL:
${truncateWords(context, 5000)}`;

  const text = await llmGenerate("audio_director", prompt, { temperature: 0.7, maxTokens: 1400, geminiKey: apiKey });
  return text.trim();
}

/** @deprecated Use suggestFullerPrompt — kept as alias for callers. */
export async function suggestOutline(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  apiKey: string
): Promise<string> {
  return suggestFullerPrompt(scope, structure, semanticMap, apiKey);
}

// ─── Script generation (the shaped summarizer) ──────────────────────────────────

export interface ScriptArgs {
  scope: OverviewScope;
  structure: BookStructure;
  semanticMap: SemanticMap | null;
  userPrompt: string;   // "" → use the default expert prompt
  minutes: number;
  apiKey: string;
  /** Source Intelligence Profile — when present, grounds the summary on discovered
   *  meaning (concepts, relationship evolution, progression) and uses the type-aware
   *  default. Falls back to the semantic-map outline when absent. */
  profile?: SourceIntelligenceProfile | null;
  onProgress?: (msg: string) => void;
}

export async function generateOverviewScript(args: ScriptArgs): Promise<string> {
  const { scope, structure, semanticMap, userPrompt, minutes, apiKey, profile, onProgress } = args;
  onProgress?.("Summarizing the material…");

  const targetWords = Math.round(minutes * LUMINA_CONFIG.AUDIO_OVERVIEW_WPM);

  // ── Layer 1: structural outline (chapter path, arc, themes — always free) ──
  const outline = buildScopeOutline(scope, structure, semanticMap);

  // ── Layer 2: source intelligence profile (deep meaning, relationships) ──────
  const profileSection = profile ? profileGroundingText(profile) : "";

  // ── Layer 3: raw prose passages ────────────────────────────────────────────
  // Always include for chapter/choose scope; omit for whole-book (too large).
  const prose = scope.type !== "whole" ? buildSourceContext(scope, structure, semanticMap) : "";

  // ── Assemble combined context ──────────────────────────────────────────────
  const contextParts: string[] = [];
  if (profileSection) contextParts.push(profileSection);
  if (outline) contextParts.push(`STRUCTURE:\n${outline}`);
  if (prose) contextParts.push(`SOURCE PASSAGES:\n${prose}`);
  const context = contextParts.join("\n\n") || outline;

  // ── Coverage checklist: every key idea the narration must address ──────────
  const coverageItems: string[] = [
    ...(profile?.concepts.mainIdeas ?? []),
    ...(profile?.progression ?? []),
    ...(profile?.concepts.keyTerms?.slice(0, 10) ?? []),
  ].filter(Boolean);

  const coverageSection = coverageItems.length
    ? `\nCOVERAGE CHECKLIST — your narration must address every item below. Do not skip any:\n${coverageItems.map((item) => `  - ${item}`).join("\n")}\n`
    : "";

  // ── Instruction ────────────────────────────────────────────────────────────
  const protocol = knowledgeProtocol(semanticMap, profile);
  const workType = knowledgeWorkType(semanticMap, profile);
  const defaultSpine = profile
    ? defaultKnowledgeSpine(protocol, profile.workType, minutes, targetWords, "spoken")
    : defaultKnowledgeSpine(protocol, workType, minutes, targetWords, "spoken");

  const instruction = userPrompt.trim()
    ? `Follow the reader's instruction as the primary guide:\n"${userPrompt.trim()}"`
    : defaultSpine;

  const prompt = `${instruction}
${coverageSection}
Your explanation must be thorough and complete. Do not abbreviate, rush past, or skip key ideas — cover each concept in enough depth that a listener builds real understanding. Aim for approximately ${minutes} minutes of narration (~${targetWords} words at a calm pace). Let the material determine the length; completeness matters more than hitting a target.

Write CONTINUOUS SPOKEN NARRATION meant to be heard, not read. Do NOT include headings, bullet points, stage directions, speaker labels, or any markup — only the words to be spoken, in flowing paragraphs.

MATERIAL TO EXPLAIN:
${truncateWords(context, 12000)}`;

  const maxTokens = Math.min(8192, Math.round(targetWords * 2.5));
  const script = await llmGenerate("audio_director", prompt, { temperature: 0.7, maxTokens, geminiKey: apiKey });
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
  if (getProvider() === "odysseus") {
    return _synthesizeLocalTts(script, voiceName, onProgress);
  }

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

async function _synthesizeLocalTts(
  script: string,
  stylePreset: string,
  onProgress?: (msg: string) => void
): Promise<SynthResult> {
  const base = getOdysseusUrl();
  const token = getOdysseusToken();
  const authHeader: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
  const postHeaders = { "Content-Type": "application/json", ...authHeader };

  // Chunk the script — same as Gemini path — so each job fits well under the
  // Cloudflare 100-second tunnel timeout. Each POST returns a job_id immediately;
  // we poll until done, then fetch the WAV and extract raw PCM for concatenation.
  const chunks = chunkText(script, LUMINA_CONFIG.AUDIO_OVERVIEW_TTS_CHUNK_CHARS);
  const pcmParts: Uint8Array[] = [];
  let sampleRate = 24000;

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Voicing part ${i + 1} of ${chunks.length}…`);

    const startRes = await fetch(`${base}/api/tts/kokoro/synthesize`, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({ text: chunks[i], style_preset: stylePreset, speed: 1.0 }),
    });
    if (!startRes.ok) {
      const msg = await startRes.text().catch(() => "");
      throw new Error(`Local TTS error ${startRes.status}: ${msg}`);
    }
    const { job_id } = await startRes.json() as { job_id: string };

    // Poll up to 4 minutes per chunk (120 × 2 s)
    let audioUrl: string | null = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`${base}/api/tts/jobs/${job_id}`, { headers: authHeader });
      if (!pollRes.ok) continue;
      const job = await pollRes.json() as { status: string; audio_url?: string; error?: string };
      if (job.status === "done" && job.audio_url) { audioUrl = job.audio_url; break; }
      if (job.status === "error") throw new Error(`Local TTS failed: ${job.error ?? "unknown"}`);
    }
    if (!audioUrl) throw new Error("Local TTS chunk timed out (4 min)");

    const wavRes = await fetch(`${base}${audioUrl}`, { headers: authHeader });
    if (!wavRes.ok) throw new Error(`Local TTS audio fetch error ${wavRes.status}`);
    const wav = new Uint8Array(await wavRes.arrayBuffer());
    // Read sample rate from WAV header byte 24, extract raw PCM after the 44-byte header.
    const view = new DataView(wav.buffer, wav.byteOffset);
    sampleRate = view.getUint32(24, true);
    pcmParts.push(wav.slice(44));
  }

  const pcm = concatBytes(pcmParts);
  const finalWav = pcmToWav(pcm, sampleRate, 1);
  const durationSeconds = pcm.length / (sampleRate * 2);
  return { data: finalWav, mimeType: "audio/wav", durationSeconds };
}

const TTS_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const TTS_MAX_ATTEMPTS = 3;

async function geminiTts(
  text: string,
  voiceName: string,
  apiKey: string
): Promise<{ pcm: Uint8Array; rate: number }> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  });

  let lastError = "Gemini TTS request failed.";
  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
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

    lastError = `Gemini TTS error ${res.status}: ${await res.text().catch(() => "")}`;
    if (!TTS_RETRY_STATUSES.has(res.status) || attempt === TTS_MAX_ATTEMPTS) {
      throw new Error(lastError);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
  }

  throw new Error(lastError);
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
