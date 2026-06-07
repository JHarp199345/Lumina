/**
 * Voice Studio audio director.
 *
 * ElevenLabs is the primary provider because it can return alignment data that
 * Lumina maps onto stable book word positions for read-along highlighting.
 */

import type {
  AudioAlignmentSpan,
  AudioArtifact,
  AudioGenerationMode,
  AudioStylePreset,
  AudioVoicePreset,
  BookStructure,
  StudySegment,
} from "@/types";

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
export const ELEVENLABS_KEY_NAME = "lumina_elevenlabs_key";
export const ELEVENLABS_VOICE_CACHE_KEY = "lumina.elevenlabs.voices";
export const ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

export const VOICE_PRESETS: AudioVoicePreset[] = [
  {
    id: "eleven-default",
    displayName: "Default ElevenLabs Voice",
    description: "Load your ElevenLabs voices to choose a narrator",
    providerVoiceName: "default",
    provider: "elevenlabs",
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

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

interface ElevenVoicesResponse {
  voices?: ElevenVoice[];
}

interface ElevenAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenTtsResponse {
  audio_base64?: string;
  alignment?: ElevenAlignment;
  normalized_alignment?: ElevenAlignment;
}

export interface SegmentAudioText {
  text: string;
  absoluteStartWord: number;
  absoluteEndWord: number;
}

export function getSegmentAudioText(segment: StudySegment, structure: BookStructure): SegmentAudioText {
  const chapter = structure.chapters.find((item) => item.index === segment.chapterIndex);
  if (!chapter?.rawText) return { text: "", absoluteStartWord: segment.approxWordStart, absoluteEndWord: segment.approxWordEnd };
  const words = chapter.rawText.split(/\s+/).filter(Boolean);
  const text = words.slice(segment.startWordOffset, segment.endWordOffset).join(" ").slice(0, 8500);
  const wordsBeforeChapter = structure.chapters
    .slice(0, chapter.index)
    .reduce((sum, item) => sum + item.wordCount, 0);
  return {
    text,
    absoluteStartWord: wordsBeforeChapter + segment.startWordOffset,
    absoluteEndWord: wordsBeforeChapter + segment.startWordOffset + text.split(/\s+/).filter(Boolean).length,
  };
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

function buildVoiceDescription(voice: ElevenVoice): string {
  const labelText = voice.labels ? Object.values(voice.labels).filter(Boolean).join(", ") : "";
  return voice.description || labelText || voice.category || "ElevenLabs voice";
}

export async function fetchElevenLabsVoices(apiKey: string): Promise<AudioVoicePreset[]> {
  const response = await fetch(`${ELEVEN_BASE}/voices`, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`ElevenLabs voices error ${response.status}`);
  const data = (await response.json()) as ElevenVoicesResponse;
  const voices = (data.voices ?? []).map<AudioVoicePreset>((voice) => ({
    id: voice.voice_id,
    displayName: voice.name,
    description: buildVoiceDescription(voice),
    providerVoiceName: voice.voice_id,
    provider: "elevenlabs",
    category: voice.category,
    labels: voice.labels,
    previewUrl: voice.preview_url,
  }));
  if (voices.length === 0) throw new Error("No ElevenLabs voices were returned.");
  localStorage.setItem(ELEVENLABS_VOICE_CACHE_KEY, JSON.stringify(voices));
  return voices;
}

export function loadCachedElevenLabsVoices(): AudioVoicePreset[] {
  try {
    const raw = localStorage.getItem(ELEVENLABS_VOICE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AudioVoicePreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function wordIndexAtChar(text: string): number[] {
  const indexes = new Array(text.length + 1).fill(0);
  let word = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const isWord = /\S/.test(text[i]);
    if (isWord && !inWord) {
      inWord = true;
      word += 1;
    }
    if (!isWord) inWord = false;
    indexes[i] = Math.max(0, word - 1);
  }
  indexes[text.length] = Math.max(0, word - 1);
  return indexes;
}

function buildAlignmentSpans(
  text: string,
  alignment: ElevenAlignment | undefined,
  absoluteStartWord: number
): AudioAlignmentSpan[] {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (chars.length === 0 || starts.length === 0 || ends.length === 0) return [];

  const wordAtChar = wordIndexAtChar(text);
  const spans: AudioAlignmentSpan[] = [];
  let i = 0;
  while (i < chars.length) {
    while (i < chars.length && /\s/.test(chars[i])) i += 1;
    if (i >= chars.length) break;
    const start = i;
    while (i < chars.length && !/\s/.test(chars[i])) i += 1;
    const end = i;
    const wordText = chars.slice(start, end).join("");
    const wordStart = wordAtChar[start] ?? 0;
    const wordEnd = wordAtChar[Math.max(start, end - 1)] ?? wordStart;
    spans.push({
      startMs: Math.max(0, Math.round((starts[start] ?? 0) * 1000)),
      endMs: Math.max(0, Math.round((ends[end - 1] ?? starts[start] ?? 0) * 1000)),
      text: wordText,
      charStart: start,
      charEnd: end,
      wordStart,
      wordEnd,
      absoluteWordStart: absoluteStartWord + wordStart,
      absoluteWordEnd: absoluteStartWord + wordEnd,
    });
  }
  return spans;
}

function voiceSettings(style: AudioStylePreset) {
  const dramatic = style.id === "dark-dramatic" || style.id === "epic-chronicle";
  const intimate = style.id === "quiet-intimate" || style.id === "warm-storyteller";
  return {
    stability: dramatic ? 0.46 : intimate ? 0.58 : 0.64,
    similarity_boost: 0.78,
    style: dramatic ? 0.42 : intimate ? 0.28 : 0.18,
    use_speaker_boost: true,
  };
}

async function callElevenLabsTts({
  apiKey,
  voice,
  text,
  style,
  mode,
}: {
  apiKey: string;
  voice: AudioVoicePreset;
  text: string;
  style: AudioStylePreset;
  mode: AudioGenerationMode;
}): Promise<ElevenTtsResponse> {
  const suffix = mode === "streamed" ? "stream/with-timestamps" : "with-timestamps";
  const url = `${ELEVEN_BASE}/text-to-speech/${voice.providerVoiceName}/${suffix}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      output_format: "mp3_44100_128",
      voice_settings: voiceSettings(style),
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs TTS error ${response.status}`);
  return (await response.json()) as ElevenTtsResponse;
}

export async function generateSegmentAudio({
  segment,
  structure,
  apiKey,
  voice,
  style,
  mode = "saved",
}: {
  segment: StudySegment;
  structure: BookStructure;
  apiKey: string;
  voice: AudioVoicePreset;
  style: AudioStylePreset;
  mode?: AudioGenerationMode;
}): Promise<{ artifact: Omit<AudioArtifact, "filePath">; data: Uint8Array }> {
  const { text, absoluteStartWord, absoluteEndWord } = getSegmentAudioText(segment, structure);
  if (text.split(/\s+/).filter(Boolean).length < 40) {
    throw new Error("This segment is too short for narration.");
  }

  const textHash = hashText(text);
  const promptHash = hashText(`${text}|${style.direction}|${voice.providerVoiceName}|${ELEVENLABS_MODEL_ID}|${mode}`);
  const data = await callElevenLabsTts({ apiKey, voice, text, style, mode });
  if (!data.audio_base64) throw new Error("ElevenLabs response did not include audio data.");

  const rawAlignment = data.normalized_alignment ?? data.alignment;
  const alignment = buildAlignmentSpans(text, rawAlignment, absoluteStartWord);
  const generatedAt = new Date().toISOString();
  const bytes = base64ToBytes(data.audio_base64);

  return {
    artifact: {
      id: `audio-${segment.bookId}-${segment.id}-${voice.id}-${style.id}-${mode}-${Date.now()}`,
      bookId: segment.bookId,
      segmentId: segment.id,
      chapterIndex: segment.chapterIndex,
      segmentTitle: segment.title,
      voiceId: voice.id,
      provider: "elevenlabs",
      voiceProviderId: voice.providerVoiceName,
      modelId: ELEVENLABS_MODEL_ID,
      mode,
      stylePresetId: style.id,
      textHash,
      promptHash,
      textStartPosition: absoluteStartWord,
      textEndPosition: absoluteEndWord,
      alignment,
      mimeType: "audio/mpeg",
      generatedAt,
      generationApi: `elevenlabs:${ELEVENLABS_MODEL_ID}`,
      status: "ready",
    },
    data: bytes,
  };
}
