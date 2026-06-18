import { LUMINA_CONFIG } from "@/config";
import { getProvider, llmGenerateJSON } from "@/api/llmClient";
import type {
  AnalysisProgressReporter,
  BookStructure,
  IdentifiedScene,
  VisualLoreDossier,
  VisualLoreEntity,
} from "@/types";
import { diagnosticError, diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";
import { computeSceneWordPosition } from "@/utils/scenePosition";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_LORE_TERMS = 60;
const INITIAL_LOCAL_ARTIFACT_COUNT = 8;

// Words that get capitalized at sentence starts but are NOT proper nouns.
// Pronouns are the primary offender: "She", "He", "His" etc. repeat the most.
const STOP_WORDS = new Set([
  // Articles / determiners
  "A", "An", "The",
  // Personal pronouns — all forms
  "I", "Me", "My", "Mine",
  "You", "Your", "Yours",
  "He", "Him", "His",
  "She", "Her", "Hers",
  "It", "Its",
  "We", "Us", "Our", "Ours",
  "They", "Them", "Their", "Theirs",
  // Reflexive
  "Himself", "Herself", "Itself", "Themselves", "Ourselves", "Yourself",
  // Demonstratives
  "This", "That", "These", "Those",
  // Coordinating conjunctions
  "And", "But", "Or", "Nor", "For", "Yet", "So",
  // Prepositions that never begin proper noun phrases
  "In", "On", "At", "By", "To", "Up", "Of", "As", "Out", "From", "With", "Into", "Upon",
  // Temporal / spatial adverbs
  "Now", "Then", "Here", "There", "When", "Where", "While",
  "Before", "After", "Since", "Until", "Though", "Although", "Because", "Unless",
  // Question words
  "Why", "How", "What", "Who", "Which", "Whose", "Whom",
  // Common expletives / discourse markers
  "Not", "No", "Yes", "Oh", "Ah", "Well",
  "Still", "Even", "Just", "Also", "Again",
  "If", "Like", "Than", "Whether", "Once",
  // Auxiliaries — never appear as proper nouns
  "Was", "Were", "Had", "Has", "Have", "Will", "Would", "Could", "Should",
  "May", "Might", "Must", "Shall", "Can",
  "Is", "Are", "Am", "Be", "Been", "Being",
  "Do", "Did", "Does", "Done",
  // Structural markers
  "Chapter", "Book", "Part",
]);

export async function buildVisualLoreDossier(params: {
  structure: BookStructure;
  scenes?: IdentifiedScene[];
  apiKey: string;
  onProgress?: AnalysisProgressReporter;
}): Promise<VisualLoreDossier | undefined> {
  const terms = extractLoreTerms(params.structure);
  if (terms.length === 0) {
    diagnosticInfo("visual_lore.skipped", "No recurring lore terms found", {
      bookId: params.structure.bookId,
    });
    return undefined;
  }

  params.onProgress?.({
    phase: "prompts",
    message: `Grounding visual lore for ${terms.length} recurring names…`,
    percent: 84,
    current: 0,
    total: terms.length,
    itemLabel: terms.slice(0, 3).join(", "),
  });

  // Odysseus and free mode: one visual-lore worker writes organized, stamped
  // artifacts from local book evidence. Free mode must not call Gemini Search;
  // it uses the OpenRouter proxy through llmGenerateJSON.
  if (getProvider() === "odysseus" || getProvider() === "openrouter-free") {
    try {
      const dossier = await buildLoreOdysseus(params.structure, terms, params.scenes ?? [], params.onProgress);
      diagnosticInfo("visual_lore.complete", "Visual lore dossier created", {
        bookId: params.structure.bookId,
        entities: dossier.entities.length,
        artifactStamps: dossier.artifactStamps?.length ?? 0,
      });
      return dossier;
    } catch (err) {
      diagnosticWarn("visual_lore.parallel_failed", "Parallel lore build failed, falling back", {
        bookId: params.structure.bookId,
        error: err instanceof Error ? err.message : String(err),
      });
      return buildFallbackDossier(params.structure.bookId, terms);
    }
  }

  // Gemini: single call with Google Search grounding
  try {
    const prompt = buildLorePrompt(params.structure, terms);
    const response = await callGeminiWithSearch(prompt, params.apiKey);
    const parsed = parseJsonResponse<Partial<VisualLoreDossier>>(response.text);
    const dossier = normalizeDossier(params.structure.bookId, parsed, terms, response.metadata);
    diagnosticInfo("visual_lore.complete", "Visual lore dossier created", {
      bookId: params.structure.bookId,
      entities: dossier.entities.length,
      searchQueries: dossier.searchQueries,
    });
    return dossier;
  } catch (err) {
    diagnosticError("visual_lore.failed", "Visual lore grounding failed", {
      bookId: params.structure.bookId,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
    return buildFallbackDossier(params.structure.bookId, terms);
  }
}

function extractLoreTerms(structure: BookStructure): string[] {
  const text = structure.chapters
    .map((chapter) => `${chapter.title}\n${chapter.rawText ?? ""}`)
    .join("\n")
    .slice(0, 180000);

  const counts = new Map<string, number>();
  const matches = text.matchAll(/\b(?:[A-Z][a-zA-Z’’.-]{2,})(?:\s+(?:the|of|and|[A-Z][a-zA-Z’’.-]{2,})){0,3}\b/g);

  for (const match of matches) {
    const term = match[0].replace(/\s+/g, " ").trim();
    if (!term || /^\d+$/.test(term)) continue;
    if (/^Chapter\s+/i.test(term)) continue;
    // Drop exact stop-word matches and any term whose first word is a stop word
    // (catches pronouns like "She", "His" and phrases like "He Will", "Their Order")
    const firstWord = term.split(/\s+/)[0];
    if (STOP_WORDS.has(firstWord)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([term, count]) => count >= 2 || term.split(/\s+/).length > 1)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term)
    .filter((term, index, arr) => !arr.slice(0, index).some((prior) => prior.includes(term) || term.includes(prior)))
    .slice(0, MAX_LORE_TERMS);
}

/** Pull a short passage from the book that mentions this entity, for in-prompt grounding. */
function findEntitySnippet(structure: BookStructure, entityName: string): string {
  const needle = entityName.toLowerCase();
  for (const chapter of structure.chapters) {
    const text = chapter.rawText ?? "";
    const idx = text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 150);
      const end = Math.min(text.length, idx + 400);
      return text.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

interface LoreArtifactPlan {
  bookId: string;
  sceneId?: string;
  chapterId?: string;
  packetIndex: number;
  packetCount: number;
  startWord: number;
  endWord: number;
  terms: string[];
  evidence: string;
}

function wordsBeforeChapter(structure: BookStructure, chapterId: string): number {
  const chapter = structure.chapters.find((item) => item.id === chapterId);
  if (!chapter) return 0;
  return structure.chapters.slice(0, chapter.index).reduce((sum, item) => sum + item.wordCount, 0);
}

function chapterAtPosition(structure: BookStructure, position: number) {
  let cursor = 0;
  for (const chapter of structure.chapters) {
    const next = cursor + chapter.wordCount;
    if (position >= cursor && position < next) return { chapter, start: cursor };
    cursor = next;
  }
  const last = structure.chapters[structure.chapters.length - 1];
  return last ? { chapter: last, start: Math.max(0, structure.totalWords - last.wordCount) } : null;
}

function textWindowForPosition(structure: BookStructure, startWord: number, endWord: number): string {
  const located = chapterAtPosition(structure, startWord);
  if (!located) return "";
  const words = (located.chapter.rawText ?? "").split(/\s+/).filter(Boolean);
  const localStart = Math.max(0, startWord - located.start);
  const localEnd = Math.min(words.length, Math.max(localStart + 80, endWord - located.start));
  return words.slice(localStart, localEnd).join(" ").slice(0, 1800);
}

function extractTermsFromText(text: string, maxTerms = 10): string[] {
  const counts = new Map<string, number>();
  const matches = text.matchAll(/\b(?:[A-Z][a-zA-Z’’.-]{2,})(?:\s+(?:the|of|and|[A-Z][a-zA-Z’’.-]{2,})){0,3}\b/g);
  for (const match of matches) {
    const term = match[0].replace(/\s+/g, " ").trim();
    const firstWord = term.split(/\s+/)[0];
    if (!term || STOP_WORDS.has(firstWord) || /^Chapter\s+/i.test(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term)
    .slice(0, maxTerms);
}

function selectTermsForEvidence(globalTerms: string[], evidence: string, fallbackOffset: number): string[] {
  const lower = evidence.toLowerCase();
  const localTerms = extractTermsFromText(evidence, 10);
  const matchedGlobal = globalTerms.filter((term) => lower.includes(term.toLowerCase())).slice(0, 8);
  const fallback = globalTerms.slice(fallbackOffset, fallbackOffset + 8);
  return [...new Set([...localTerms, ...matchedGlobal, ...fallback])].slice(0, 12);
}

function planInitialLoreArtifacts(
  structure: BookStructure,
  terms: string[],
  scenes: IdentifiedScene[]
): LoreArtifactPlan[] {
  const sortedScenes = scenes
    .map((scene) => ({ scene, position: computeSceneWordPosition(scene, structure.chapters) }))
    .sort((a, b) => a.position - b.position)
    .slice(0, INITIAL_LOCAL_ARTIFACT_COUNT);

  const anchors = sortedScenes.length
    ? sortedScenes
    : [{ scene: undefined, position: 0 } as { scene?: IdentifiedScene; position: number }];

  return anchors.map(({ scene, position }, index) => {
    const nextPosition = sortedScenes[index + 1]?.position;
    const startWord = Math.max(0, position - (index === 0 ? 0 : 250));
    const endWord = Math.min(
      structure.totalWords,
      Math.max(startWord + 900, Math.min(nextPosition ?? startWord + 1800, startWord + 2200))
    );
    const evidence = textWindowForPosition(structure, startWord, endWord);
    const termsForArtifact = selectTermsForEvidence(terms, evidence, index * 6);
    return {
      bookId: structure.bookId,
      sceneId: scene?.id,
      chapterId: scene?.chapterId ?? chapterAtPosition(structure, startWord)?.chapter.id,
      packetIndex: index,
      packetCount: anchors.length,
      startWord,
      endWord,
      terms: termsForArtifact,
      evidence,
    };
  });
}

function buildLoreArtifactPrompt(structure: BookStructure, artifacts: LoreArtifactPlan[], terms: string[]): string {
  const bookInfo = `"${structure.title}"${structure.author ? ` by ${structure.author}` : ""}`;
  const artifactBlocks = artifacts
    .map((artifact) => `Artifact ${artifact.packetIndex + 1}/${artifact.packetCount}
Stamp: ${JSON.stringify({
      bookId: artifact.bookId,
      sceneId: artifact.sceneId,
      chapterId: artifact.chapterId,
      packetIndex: artifact.packetIndex,
      packetCount: artifact.packetCount,
      startWord: artifact.startWord,
      endWord: artifact.endWord,
      terms: artifact.terms,
    })}
Source evidence:
${artifact.evidence || "(no local passage available)"}`)
    .join("\n\n---\n\n");

  return `You are the single visual lore worker for the EPUB reader Lumina.

Book: ${bookInfo}
Book ID stamp: ${structure.bookId}

You are not generating images. You are writing organized, readable lore artifacts that later visual directors and image generators can consult by book position.

The first artifact is opening-heavy because Lumina generates the first image from the first visual section. Later artifacts prepare nearby scene windows.

Global recurring terms, for context only:
${terms.slice(0, 40).map((term) => `- ${term}`).join("\n")}

Stamped local artifacts to fill:
${artifactBlocks}

For each artifact, create useful visual entities from its local evidence and term list. These can include characters, places, factions, objects, species, concepts, materials, architecture, flowers/plants, vehicles, weapons, weather, rituals, or anything visually important in that local section.

For each entity, cover:
- Physical form (height category, build, surface texture, skin/hide/metal, distinguishing features)
- Clothing / armor / equipment (construction, layering, ornamentation, wear and damage)
- Color palette (dominant colors, secondary accents, how colors shift in shadow vs. light)
- Silhouette (what unique shape does this entity cut against sky or background)
- Materials (be specific: bone, obsidian, ceramite, worn leather, silk, corroded iron, etc.)
- Visual motifs (symbols, geometric patterns, iconography associated with this entity)
- Scene use (how to place in foreground vs. background, lighting interactions)

Return ONLY valid JSON, no markdown fences:
{
  "universeHint": "short likely setting/franchise/world context, or unknown",
  "artifactStamps": [
    {
      "bookId": "${structure.bookId}",
      "sceneId": "scene id when present",
      "chapterId": "chapter id",
      "packetIndex": 0,
      "packetCount": ${artifacts.length},
      "startWord": 0,
      "endWord": 1200,
      "terms": ["terms covered"]
    }
  ],
  "entities": [
    {
      "name": "visual entity name",
      "category": "character|species|faction|place|object|concept|unknown",
      "confidence": 0.0-1.0,
      "sourceSceneId": "scene id when present",
      "sourceChapterId": "chapter id",
      "sourceStartWord": 0,
      "sourceEndWord": 1200,
      "sourceTerms": ["terms from the artifact this came from"],
      "aliases": ["other names if any"],
      "canonicalTraits": ["specific trait 1", "specific trait 2", "up to 8 traits"],
      "silhouette": "one sentence describing the distinctive silhouette",
      "materials": ["material1", "material2"],
      "colors": ["primary color", "secondary/accent color"],
      "motifs": ["motif1", "motif2"],
      "sceneUse": "how to compose this entity in a visual scene",
      "avoidCopying": ["specific official art or designs to avoid recreating exactly"],
      "sourceTitles": ["published source titles if applicable"],
      "sourceUrls": []
    }
  ],
  "globalStyleNotes": ["brief visual grammar discovered in this packet"],
  "safetyRules": [
    "Use traits as descriptive grounding only",
    "Do not recreate a specific public image"
  ]
}

Rules:
- Preserve the artifact stamps exactly enough that bookId/startWord/endWord remain correct.
- Every entity must include sourceStartWord and sourceEndWord from the artifact it came from.
- Favor local evidence over end-of-book or global lore, especially for artifact 1.
- Global/canonical knowledge may enrich visual traits, but do not copy a specific public image, composition, logo, or named artist style.
- Keep the artifact readable and organized; the next AI should be able to quickly find what matters for a local image.`;
}

/** Odysseus path: one visual-lore worker writes stamped readable artifacts. */
async function buildLoreOdysseus(
  structure: BookStructure,
  terms: string[],
  scenes: IdentifiedScene[],
  onProgress?: AnalysisProgressReporter
): Promise<VisualLoreDossier> {
  const limitedTerms = terms.slice(0, MAX_LORE_TERMS);
  const artifacts = planInitialLoreArtifacts(structure, limitedTerms, scenes);

  onProgress?.({
    phase: "prompts",
    message: `Writing ${artifacts.length} stamped visual lore artifact${artifacts.length === 1 ? "" : "s"}…`,
    percent: 85,
    current: 0,
    total: artifacts.length,
  });

  const raw = await llmGenerateJSON<Partial<VisualLoreDossier>>(
    "visual_analyst",
    buildLoreArtifactPrompt(structure, artifacts, limitedTerms),
    { temperature: 0.28, maxTokens: 9000 }
  );
  const dossier = normalizeDossier(structure.bookId, raw, limitedTerms);
  const stamped = applyArtifactFallbacks(dossier, artifacts);

  diagnosticInfo("visual_lore.artifacts_complete", "Visual lore artifacts built", {
    bookId: structure.bookId,
    artifacts: stamped.artifactStamps?.length ?? 0,
    entities: stamped.entities.length,
    openingRange: stamped.artifactStamps?.[0]
      ? [stamped.artifactStamps[0].startWord, stamped.artifactStamps[0].endWord]
      : null,
  });

  return stamped;
}

function buildLorePrompt(structure: BookStructure, terms: string[]): string {
  const sample = structure.chapters
    .slice(0, 8)
    .map((chapter) => `"${chapter.title}": ${(chapter.rawText ?? "").split(/\s+/).slice(0, 90).join(" ")}`)
    .join("\n\n");

  return `You are building a private visual lore dossier for an illustrated EPUB reader.

The reader needs broad canonical visual traits for proper nouns and lore terms so image generation does not guess wildly. Use Google Search grounding where useful. Do not copy any specific artwork, composition, pose, costume detail-for-detail, watermark, or artist style.

Book title: ${structure.title}
Author: ${structure.author}

Candidate terms:
${terms.map((term) => `- ${term}`).join("\n")}

Book sample:
${sample}

Return JSON only:
{
  "universeHint": "short likely setting/franchise/world context, or unknown",
  "entities": [
    {
      "name": "term",
      "category": "character|species|faction|place|object|concept|unknown",
      "confidence": 0.0-1.0,
      "aliases": ["..."],
      "canonicalTraits": ["broad visual trait, not a copied design detail"],
      "silhouette": "broad silhouette language",
      "materials": ["metal", "cloth", "stone", "..."],
      "colors": ["..."],
      "motifs": ["..."],
      "sceneUse": "how Lumina should use this when composing scenes",
      "avoidCopying": ["specific copying risks to avoid"],
      "sourceTitles": ["short source titles if available"],
      "sourceUrls": ["source URLs if available"]
    }
  ],
  "globalStyleNotes": ["broad visual grammar for this universe/book"],
  "safetyRules": [
    "Use traits as descriptive grounding only",
    "Do not recreate a specific public image"
  ]
}`;
}

async function callGeminiWithSearch(
  prompt: string,
  apiKey: string
): Promise<{ text: string; metadata?: Record<string, unknown> }> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.25,
        topP: 0.85,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini visual lore error ${response.status}: ${err}`);
  }

  const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: Record<string, unknown> }[] };
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "{}",
    metadata: data.candidates?.[0]?.groundingMetadata,
  };
}

function normalizeDossier(
  bookId: string,
  raw: Partial<VisualLoreDossier>,
  terms: string[],
  metadata?: Record<string, unknown>
): VisualLoreDossier {
  const metadataQueries = Array.isArray(metadata?.webSearchQueries)
    ? metadata.webSearchQueries.filter((item): item is string => typeof item === "string")
    : [];

  const entities = Array.isArray(raw.entities)
    ? raw.entities.map(normalizeEntity).filter((entity) => entity.name)
    : [];

  return {
    bookId,
    generatedAt: new Date().toISOString(),
    universeHint: stringOr(raw.universeHint, "unknown"),
    searchQueries: metadataQueries,
    entities: entities.length ? entities : terms.map(fallbackEntity),
    artifactStamps: Array.isArray(raw.artifactStamps)
      ? raw.artifactStamps
          .map((stamp) => ({
            bookId,
            sceneId: stringOr(stamp.sceneId, ""),
            chapterId: stringOr(stamp.chapterId, ""),
            packetIndex: numberOr(stamp.packetIndex, 0),
            packetCount: numberOr(stamp.packetCount, raw.artifactStamps?.length ?? 1),
            startWord: numberOr(stamp.startWord, 0),
            endWord: numberOr(stamp.endWord, 0),
            terms: cleanArray(stamp.terms, []),
          }))
          .map((stamp) => ({
            ...stamp,
            ...(stamp.sceneId ? { sceneId: stamp.sceneId } : {}),
            ...(stamp.chapterId ? { chapterId: stamp.chapterId } : {}),
          }))
      : undefined,
    globalStyleNotes: cleanArray(raw.globalStyleNotes, []),
    safetyRules: cleanArray(raw.safetyRules, [
      "Use public references only to infer broad visual traits.",
      "Do not recreate any specific official or fan artwork.",
      "Avoid named artist styles, exact compositions, logos, and watermarks.",
    ]),
  };
}

function normalizeEntity(raw: Partial<VisualLoreEntity>): VisualLoreEntity {
  return {
    name: stringOr(raw.name, ""),
    category: enumOr(raw.category, ["character", "species", "faction", "place", "object", "concept", "unknown"], "unknown"),
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
    ...(stringOr(raw.sourceSceneId, "") ? { sourceSceneId: stringOr(raw.sourceSceneId, "") } : {}),
    ...(stringOr(raw.sourceChapterId, "") ? { sourceChapterId: stringOr(raw.sourceChapterId, "") } : {}),
    ...(typeof raw.sourceStartWord === "number" ? { sourceStartWord: Math.max(0, Math.round(raw.sourceStartWord)) } : {}),
    ...(typeof raw.sourceEndWord === "number" ? { sourceEndWord: Math.max(0, Math.round(raw.sourceEndWord)) } : {}),
    ...(Array.isArray(raw.sourceTerms) ? { sourceTerms: cleanArray(raw.sourceTerms, []) } : {}),
    aliases: cleanArray(raw.aliases, []),
    canonicalTraits: cleanArray(raw.canonicalTraits, []),
    silhouette: stringOr(raw.silhouette, ""),
    materials: cleanArray(raw.materials, []),
    colors: cleanArray(raw.colors, []),
    motifs: cleanArray(raw.motifs, []),
    sceneUse: stringOr(raw.sceneUse, ""),
    avoidCopying: cleanArray(raw.avoidCopying, []),
    sourceTitles: cleanArray(raw.sourceTitles, []),
    sourceUrls: cleanArray(raw.sourceUrls, []),
  };
}

function applyArtifactFallbacks(dossier: VisualLoreDossier, artifacts: LoreArtifactPlan[]): VisualLoreDossier {
  const stamps = artifacts.map((artifact) => ({
    bookId: artifact.bookId,
    ...(artifact.sceneId ? { sceneId: artifact.sceneId } : {}),
    ...(artifact.chapterId ? { chapterId: artifact.chapterId } : {}),
    packetIndex: artifact.packetIndex,
    packetCount: artifact.packetCount,
    startWord: artifact.startWord,
    endWord: artifact.endWord,
    terms: artifact.terms,
  }));

  const existingStamps = dossier.artifactStamps?.length ? dossier.artifactStamps : stamps;
  const defaultStamp = existingStamps[0] ?? stamps[0];
  const stampedEntities = dossier.entities.map((entity, index) => {
    if (typeof entity.sourceStartWord === "number" && typeof entity.sourceEndWord === "number") {
      return entity;
    }

    const matchedStamp =
      existingStamps.find((stamp) =>
        [entity.name, ...entity.aliases].some((name) =>
          stamp.terms.some((term) => term.toLowerCase() === name.toLowerCase())
        )
      ) ??
      existingStamps[index % Math.max(1, existingStamps.length)] ??
      defaultStamp;

    if (!matchedStamp) return entity;
    return {
      ...entity,
      sourceSceneId: entity.sourceSceneId ?? matchedStamp.sceneId,
      sourceChapterId: entity.sourceChapterId ?? matchedStamp.chapterId,
      sourceStartWord: matchedStamp.startWord,
      sourceEndWord: matchedStamp.endWord,
      sourceTerms: entity.sourceTerms?.length ? entity.sourceTerms : matchedStamp.terms,
    };
  });

  return {
    ...dossier,
    artifactStamps: existingStamps,
    entities: stampedEntities,
  };
}

function buildFallbackDossier(bookId: string, terms: string[]): VisualLoreDossier {
  diagnosticWarn("visual_lore.fallback", "Using fallback visual lore dossier", { bookId, terms });
  return {
    bookId,
    generatedAt: new Date().toISOString(),
    universeHint: "unknown",
    searchQueries: [],
    entities: terms.map(fallbackEntity),
    globalStyleNotes: [],
    safetyRules: [
      "Use proper nouns as context clues only.",
      "Do not recreate any specific official or fan artwork.",
    ],
  };
}

function fallbackEntity(name: string): VisualLoreEntity {
  return {
    name,
    category: "unknown",
    confidence: 0.25,
    aliases: [],
    canonicalTraits: [],
    silhouette: "",
    materials: [],
    colors: [],
    motifs: [],
    sceneUse: "Use only if the source passage makes its role clear.",
    avoidCopying: ["Do not copy a specific public image."],
    sourceTitles: [],
    sourceUrls: [],
  };
}

export function findRelevantLoreEntities(
  dossier: VisualLoreDossier | undefined,
  text: string,
  limit = 5,
  wordPosition?: number
): VisualLoreEntity[] {
  if (!dossier) return [];
  const lower = text.toLowerCase();
  const proximityWindow = 2500;
  return dossier.entities
    .map((entity) => {
      const names = [entity.name, ...entity.aliases].filter(Boolean);
      const textMatch = names.some((name) => lower.includes(name.toLowerCase()));
      const hasRange =
        typeof wordPosition === "number" &&
        typeof entity.sourceStartWord === "number" &&
        typeof entity.sourceEndWord === "number";
      const distance = hasRange
        ? wordPosition < entity.sourceStartWord!
          ? entity.sourceStartWord! - wordPosition
          : wordPosition > entity.sourceEndWord!
            ? wordPosition - entity.sourceEndWord!
            : 0
        : Number.POSITIVE_INFINITY;
      const positionMatch = hasRange && distance <= proximityWindow;
      const score =
        entity.confidence +
        (textMatch ? 1.5 : 0) +
        (positionMatch ? 1.2 : 0) +
        (distance === 0 ? 0.8 : 0) -
        (Number.isFinite(distance) ? Math.min(distance / 10000, 0.5) : 0);
      return { entity, textMatch, positionMatch, score };
    })
    .filter((item) => item.textMatch || item.positionMatch)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entity)
    .slice(0, limit);
}

export function formatLoreForPrompt(entities: VisualLoreEntity[]): string {
  if (entities.length === 0) return "No grounded visual lore matched this scene.";
  return entities
    .map((entity) => {
      const traits = [
        entity.silhouette && `silhouette: ${entity.silhouette}`,
        entity.canonicalTraits.length && `traits: ${entity.canonicalTraits.join(", ")}`,
        entity.materials.length && `materials: ${entity.materials.join(", ")}`,
        entity.colors.length && `colors: ${entity.colors.join(", ")}`,
        entity.motifs.length && `motifs: ${entity.motifs.join(", ")}`,
        entity.sceneUse && `use: ${entity.sceneUse}`,
        entity.avoidCopying.length && `avoid: ${entity.avoidCopying.join(", ")}`,
        entity.sourceTitles.length && `source titles: ${entity.sourceTitles.slice(0, 3).join(", ")}`,
        entity.sourceUrls.length && `source URLs for provenance only: ${entity.sourceUrls.slice(0, 3).join(", ")}`,
      ].filter(Boolean);
      return `${entity.name} (${entity.category}, confidence ${Math.round(entity.confidence * 100)}%): ${traits.join("; ")}`;
    })
    .join("\n");
}

function cleanArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 12);
}

function numberOr(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return {} as T;
  }
}
