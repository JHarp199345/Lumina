import { LUMINA_CONFIG } from "@/config";
import { getProvider, runOdysseusParallel, type OdysseusParallelTask } from "@/api/llmClient";
import type {
  AnalysisProgressReporter,
  BookStructure,
  VisualLoreDossier,
  VisualLoreEntity,
} from "@/types";
import { diagnosticError, diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_LORE_TERMS = 25;
const VISUAL_LORE_MAX_CONCURRENCY = 4;

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

  // Odysseus: one dedicated agent per entity, with concurrency capped to the
  // real worker throughput. Higher values mostly create waiting tasks in logs.
  if (getProvider() === "odysseus") {
    try {
      const dossier = await buildLoreOdysseus(params.structure, terms, params.onProgress);
      diagnosticInfo("visual_lore.complete", "Visual lore dossier created (parallel)", {
        bookId: params.structure.bookId,
        entities: dossier.entities.length,
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

/** Per-entity prompt for one parallel visual_analyst task. */
function buildEntityPrompt(structure: BookStructure, entityName: string, snippet: string): string {
  const bookInfo = `"${structure.title}"${structure.author ? ` by ${structure.author}` : ""}`;
  const snippetBlock = snippet
    ? `\nBook passage mentioning this entity:\n---\n${snippet.slice(0, 600)}\n---\n`
    : "";
  return `You are a visual lore researcher for the EPUB reader Lumina.

Book: ${bookInfo}
Entity: "${entityName}"
${snippetBlock}
Your task: produce a comprehensive visual dossier entry for a LOCAL image-generation AI model. Draw on your full training knowledge. If this entity exists in a published fictional universe (Warhammer 40K, Star Wars, a novel series, game franchise, etc.), describe it with maximum visual specificity — the local AI has no internet access and needs every detail spelled out.

Cover all of the following:
- Physical form (height category, build, surface texture, skin/hide/metal, distinguishing features)
- Clothing / armor / equipment (construction, layering, ornamentation, wear and damage)
- Color palette (dominant colors, secondary accents, how colors shift in shadow vs. light)
- Silhouette (what unique shape does this entity cut against sky or background)
- Materials (be specific: bone, obsidian, ceramite, worn leather, silk, corroded iron, etc.)
- Visual motifs (symbols, geometric patterns, iconography associated with this entity)
- Scene use (how to place in foreground vs. background, lighting interactions)

Return ONLY valid JSON, no markdown fences:
{
  "name": "${entityName}",
  "category": "character|species|faction|place|object|concept|unknown",
  "confidence": 0.0-1.0,
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
}`;
}

/** Odysseus path: one dedicated visual_analyst task per entity, run in parallel. */
async function buildLoreOdysseus(
  structure: BookStructure,
  terms: string[],
  onProgress?: AnalysisProgressReporter
): Promise<VisualLoreDossier> {
  const tasks: OdysseusParallelTask[] = terms.map((term, i) => ({
    id: `lore-${i}`,
    agent: "visual_analyst",
    prompt: buildEntityPrompt(structure, term, findEntitySnippet(structure, term)),
    temperature: 0.3,
    max_tokens: 1500,
  }));

  onProgress?.({
    phase: "prompts",
    message: `Researching ${terms.length} lore entities in parallel…`,
    percent: 85,
    current: 0,
    total: terms.length,
  });

  const result = await runOdysseusParallel({
    workflow: {
      type: "visual-lore",
      label: `Visual lore research — ${structure.title}`,
      task_goal: `Build detailed visual dossier for ${terms.length} lore entities`,
      context: { book_title: structure.title, entity_count: terms.length },
    },
    tasks,
    max_concurrency: VISUAL_LORE_MAX_CONCURRENCY,
  });

  const entities: VisualLoreEntity[] = [];
  for (let i = 0; i < terms.length; i++) {
    const task = result.results.find((r) => r.id === `lore-${i}`);
    if (task?.status === "done" && task.content) {
      try {
        const cleaned = task.content.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
        const raw = JSON.parse(cleaned) as Partial<VisualLoreEntity>;
        const entity = normalizeEntity(raw);
        if (entity.name) {
          entities.push(entity);
          continue;
        }
      } catch {
        // fall through to fallback
      }
    }
    entities.push(fallbackEntity(terms[i]));
  }

  return {
    bookId: structure.bookId,
    generatedAt: new Date().toISOString(),
    universeHint: "unknown",
    searchQueries: [],
    entities,
    globalStyleNotes: [],
    safetyRules: [
      "Use public references only to infer broad visual traits.",
      "Do not recreate any specific official or fan artwork.",
      "Avoid named artist styles, exact compositions, logos, and watermarks.",
    ],
  };
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
  limit = 5
): VisualLoreEntity[] {
  if (!dossier) return [];
  const lower = text.toLowerCase();
  return dossier.entities
    .filter((entity) => {
      const names = [entity.name, ...entity.aliases].filter(Boolean);
      return names.some((name) => lower.includes(name.toLowerCase()));
    })
    .sort((a, b) => b.confidence - a.confidence)
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
