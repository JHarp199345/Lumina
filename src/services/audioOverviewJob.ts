/**
 * Background Audio Overview generation — survives drawer/panel close.
 */

import { LUMINA_CONFIG } from "@/config";
import {
  generateAudioOverview,
  GOOGLE_KEY_NAME,
  scopeLabel,
  type OverviewScope,
} from "@/pipeline/audioOverview";
import { buildSourceProfile, isUsableSourceProfile } from "@/pipeline/sourceProfile";
import { storage } from "@/storage";
import type { AudioArtifact, BookStructure, SemanticMap, SourceIntelligenceProfile } from "@/types";

export interface AudioOverviewJobParams {
  bookId: string;
  scope: OverviewScope;
  structure: BookStructure;
  semanticMap: SemanticMap | null;
  profile: SourceIntelligenceProfile | null;
  userPrompt: string;
  minutes: number;
  voiceName: string;
  onProgress: (message: string) => void;
  isStale: () => boolean;
}

async function ensureProfile(
  params: AudioOverviewJobParams,
  apiKey: string
): Promise<SourceIntelligenceProfile | null> {
  if (isUsableSourceProfile(params.profile, params.semanticMap)) return params.profile;
  if (!params.semanticMap) return params.profile;
  params.onProgress("Building source intelligence…");
  const built = await buildSourceProfile(params.structure, params.semanticMap, apiKey);
  await storage.saveSourceProfile(built).catch(() => {});
  return built;
}

export async function runAudioOverviewJob(
  params: AudioOverviewJobParams
): Promise<AudioArtifact | null> {
  const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
  if (!apiKey) throw new Error("Add your Google AI Studio key in Settings to generate an overview.");

  params.onProgress("Preparing source intelligence…");
  const enrichedProfile = await ensureProfile(params, apiKey);
  if (params.isStale()) return null;

  const effectivePrompt = params.userPrompt.trim();
  const { script, audio } = await generateAudioOverview({
    scope: params.scope,
    structure: params.structure,
    semanticMap: params.semanticMap,
    profile: enrichedProfile,
    userPrompt: effectivePrompt,
    minutes: params.minutes,
    apiKey,
    voiceName: params.voiceName,
    onProgress: (message) => {
      if (!params.isStale()) params.onProgress(message);
    },
  });
  if (params.isStale()) return null;

  params.onProgress("Saving overview…");
  const id = `audio-overview-${Date.now()}`;
  const meta: Omit<AudioArtifact, "filePath"> = {
    id,
    bookId: params.bookId,
    segmentId: id,
    chapterIndex: params.scope.type === "current" ? Math.max(0, params.scope.currentChapterIndex ?? 0) : 0,
    segmentTitle: scopeLabel(params.scope, params.structure),
    voiceId: params.voiceName,
    provider: "gemini",
    scope: "overview",
    voiceProviderId: params.voiceName,
    modelId: LUMINA_CONFIG.GEMINI_TTS_MODEL,
    mode: "saved",
    stylePresetId: "overview",
    textHash: "",
    promptHash: "",
    mimeType: audio.mimeType,
    durationSeconds: audio.durationSeconds,
    generatedAt: new Date().toISOString(),
    generationApi: "gemini-tts",
    status: "ready",
    overviewMinutes: params.minutes,
    overviewPrompt: effectivePrompt,
    overviewScript: script,
  };
  const filePath = await storage.saveAudioArtifact(meta, audio.data);
  if (params.isStale()) return null;
  return { ...meta, filePath };
}
