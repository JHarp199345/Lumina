/**
 * Voice Studio audio director (PLANVI).
 *
 * Generates one Study Guide segment at a time and returns playable audio bytes.
 */

import { LUMINA_CONFIG } from "@/config";
import type {
  AudioArtifact,
  AudioStylePreset,
  AudioVoicePreset,
  BookStructure,
  StudySegment,
} from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const VOICE_PRESETS: AudioVoicePreset[] = [
  {
    id: "kore",
    displayName: "Kore",
    description: "Clear, steady narrator",
    providerVoiceName: "Kore",
  },
  {
    id: "charon",
    displayName: "Charon",
    description: "Darker dramatic narration",
    providerVoiceName: "Charon",
  },
  {
    id: "leda",
    displayName: "Leda",
    description: "Warm intimate narration",
    providerVoiceName: "Leda",
  },
];

export const AUDIO_STYLE_PRESETS: AudioStylePreset[] = [
  {
    id: "clear-narrator",
    displayName: "Clear Narrator",
    direction:
      "Read with a clear, steady audiobook cadence. Keep the prose easy to follow and do not overperform.",
  },
  {
    id: "warm-storyteller",
    displayName: "Warm Storyteller",
    direction:
      "Read with warmth and gentle momentum, like a skilled storyteller keeping the reader close to the page.",
  },
  {
    id: "dark-dramatic",
    displayName: "Dark Dramatic",
    direction:
      "Read with restrained dramatic tension. Let ominous moments deepen without becoming theatrical.",
  },
  {
    id: "quiet-intimate",
    displayName: "Quiet Intimate",
    direction:
      "Read softly and intimately, emphasizing interior emotion and reflective passages.",
  },
  {
    id: "epic-chronicle",
    displayName: "Epic Chronicle",
    direction:
      "Read with a grand chronicle cadence, controlled and ceremonial, suited to large-scale events.",
  },
];

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

interface GeminiPart {
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

function segmentText(segment: StudySegment, structure: BookStructure): string {
  const chapter = structure.chapters.find((item) => item.index === segment.chapterIndex);
  if (!chapter?.rawText) return "";
  const words = chapter.rawText.split(/\s+/).filter(Boolean);
  return words.slice(segment.startWordOffset, segment.endWordOffset).join(" ");
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sampleRateFromMime(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const headerSize = 44;
  const wav = new Uint8Array(headerSize + pcm.length);
  const view = new DataView(wav.buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, headerSize);
  return wav;
}

function playableAudioBytes(bytes: Uint8Array, mimeType: string): { bytes: Uint8Array; mimeType: string } {
  const lower = mimeType.toLowerCase();
  if (lower.includes("wav") || lower.includes("mpeg") || lower.includes("mp3") || lower.includes("ogg")) {
    return { bytes, mimeType };
  }
  if (lower.includes("l16") || lower.includes("pcm")) {
    return { bytes: pcm16ToWav(bytes, sampleRateFromMime(mimeType)), mimeType: "audio/wav" };
  }
  return { bytes, mimeType };
}

function buildPrompt({
  segment,
  structure,
  style,
  text,
}: {
  segment: StudySegment;
  structure: BookStructure;
  style: AudioStylePreset;
  text: string;
}): string {
  return `${style.direction}

Book: ${structure.title}
Chapter: ${segment.chapterTitle}
Segment: ${segment.title}
Segment summary: ${segment.summary || "(none)"}

Read only the passage below. Do not add commentary, explanations, sound effects, or extra words.

Passage:
"""
${text}
"""`;
}

function extractInlineAudio(data: unknown): { base64: string; mimeType: string } | null {
  const candidates = (data as { candidates?: { content?: { parts?: GeminiPart[] } }[] }).candidates ?? [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) {
        return { base64: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? "audio/wav" };
      }
    }
  }
  return null;
}

export async function generateSegmentAudio({
  segment,
  structure,
  apiKey,
  voice,
  style,
}: {
  segment: StudySegment;
  structure: BookStructure;
  apiKey: string;
  voice: AudioVoicePreset;
  style: AudioStylePreset;
}): Promise<{ artifact: Omit<AudioArtifact, "filePath">; data: Uint8Array }> {
  const text = segmentText(segment, structure).slice(0, 8500);
  if (text.split(/\s+/).filter(Boolean).length < 40) {
    throw new Error("This segment is too short for narration.");
  }

  const prompt = buildPrompt({ segment, structure, style, text });
  const textHash = hashText(text);
  const promptHash = hashText(`${prompt}|${voice.providerVoiceName}|${LUMINA_CONFIG.GEMINI_TTS_MODEL}`);

  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice.providerVoiceName },
          },
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini TTS error ${response.status}`);

  const json = await response.json();
  const inline = extractInlineAudio(json);
  if (!inline) throw new Error("Gemini response did not include audio data.");

  const playable = playableAudioBytes(base64ToBytes(inline.base64), inline.mimeType);
  const generatedAt = new Date().toISOString();

  return {
    artifact: {
      id: `audio-${segment.bookId}-${segment.id}-${voice.id}-${style.id}-${Date.now()}`,
      bookId: segment.bookId,
      segmentId: segment.id,
      chapterIndex: segment.chapterIndex,
      segmentTitle: segment.title,
      voiceId: voice.id,
      stylePresetId: style.id,
      textHash,
      promptHash,
      mimeType: playable.mimeType,
      generatedAt,
      generationApi: LUMINA_CONFIG.GEMINI_TTS_MODEL,
      status: "ready",
    },
    data: playable.bytes,
  };
}
