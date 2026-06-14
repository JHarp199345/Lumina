import type {
  BookProfile,
  BookProfileItem,
  BookStructure,
  Chapter,
  IdentifiedScene,
  PassageBoundary,
  SemanticMap,
  SourceIntelligenceProfile,
  StyleSeed,
  VisualCompositionArtifact,
} from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { visualSlotKeyForScene } from "@/utils/sceneDedup";
import { countWords } from "@/pipeline/gutenbergBoundaries";

const PROFILE_VERSION = 1;
const MAX_PASSAGE_WORDS = 1500;
const MIN_PASSAGE_WORDS = 420;

function words(text = ""): string[] {
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

function clean(input = ""): string {
  return input.replace(/\s+/g, " ").trim();
}

function uniq(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())).map((v) => v.trim()))];
}

function stableId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function chapterStartWords(chapters: Chapter[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const chapter of chapters) {
    starts[chapter.index] = cursor;
    cursor += chapter.wordCount;
  }
  return starts;
}

function chapterForWord(structure: BookStructure, wordPosition: number): { chapter: Chapter; startWord: number } | null {
  const starts = chapterStartWords(structure.chapters);
  for (const chapter of structure.chapters) {
    const startWord = starts[chapter.index] ?? 0;
    const endWord = startWord + chapter.wordCount;
    if (wordPosition >= startWord && wordPosition < endWord) return { chapter, startWord };
  }
  const last = structure.chapters[structure.chapters.length - 1];
  return last ? { chapter: last, startWord: starts[last.index] ?? 0 } : null;
}

export function detectStoryStart(structure: BookStructure): number {
  const frontMatterTerms = [
    "cover",
    "title",
    "copyright",
    "dedication",
    "contents",
    "table of contents",
    "acknowledg",
    "preface",
    "foreword",
    "introduction",
    "map",
    "dramatis",
    "glossary",
    "about the author",
    "also by",
  ];
  const starts = chapterStartWords(structure.chapters);
  let firstStory = structure.chapters.find((chapter, index) => {
    const title = chapter.title.trim().toLowerCase();
    const looksFrontMatter = frontMatterTerms.some((term) => title.includes(term));
    if (looksFrontMatter) return false;
    if (index < 4 && chapter.wordCount < 220) return false;
    return chapter.wordCount > 250 || /chapter|book|part|prologue|act|section/i.test(chapter.title);
  });
  if (!firstStory) firstStory = structure.chapters.find((chapter) => chapter.wordCount > 250);
  return firstStory ? starts[firstStory.index] ?? 0 : 0;
}

export function buildPassageBoundaries(structure: BookStructure, semanticMap?: SemanticMap | null): PassageBoundary[] {
  const starts = chapterStartWords(structure.chapters);
  const boundaries: PassageBoundary[] = [];

  for (const chapter of structure.chapters) {
    const chapterStart = starts[chapter.index] ?? 0;
    if (chapter.sections.length > 0) {
      for (const section of chapter.sections) {
        const startWord = chapterStart + section.startWordOffset;
        const wordCount = section.wordCount || countWords(section.rawText ?? "");
        boundaries.push({
          id: `passage:${stableId(chapter.id)}:${section.index}`,
          chapterId: chapter.id,
          sectionId: section.id,
          title: chapter.title || `Chapter ${chapter.index + 1}`,
          startWord,
          endWord: Math.min(structure.totalWords, startWord + wordCount),
          wordCount,
          source: "section",
          tags: uniq(["section", chapter.title]),
        });
      }
    } else {
      boundaries.push({
        id: `passage:${stableId(chapter.id)}`,
        chapterId: chapter.id,
        title: chapter.title || `Chapter ${chapter.index + 1}`,
        startWord: chapterStart,
        endWord: Math.min(structure.totalWords, chapterStart + chapter.wordCount),
        wordCount: chapter.wordCount,
        source: "chapter",
        tags: uniq(["chapter", chapter.title]),
      });
    }
  }

  for (const scene of semanticMap?.scenes ?? []) {
    const position = computeSceneWordPosition(scene, structure.chapters);
    const passage = getPassageForPosition(structure, position);
    boundaries.push({
      id: `scene:${stableId(scene.id)}`,
      chapterId: scene.chapterId,
      sectionId: scene.sectionId,
      title: scene.threadLabel || scene.publicVisualBrief?.title || scene.imageDescription || "Visual scene",
      startWord: passage.startWord,
      endWord: passage.endWord,
      wordCount: passage.endWord - passage.startWord,
      source: "scene",
      tags: uniq([
        "scene",
        scene.threadRole,
        scene.threadLabel,
        ...scene.emotionalVector,
        ...scene.symbolicMotifs,
        ...scene.atmosphericQualities,
      ]),
    });
  }

  return boundaries
    .filter((b) => b.endWord > b.startWord)
    .sort((a, b) => a.startWord - b.startWord || a.endWord - b.endWord);
}

export function buildBookProfile(params: {
  structure: BookStructure;
  semanticMap: SemanticMap;
  sourceProfile?: SourceIntelligenceProfile | null;
}): BookProfile {
  const { structure, semanticMap, sourceProfile } = params;
  const passageBoundaries = buildPassageBoundaries(structure, semanticMap);
  const threadLabels = uniq(semanticMap.narrativeBlueprint?.threads?.map((thread) => thread.label) ?? []);

  const items: BookProfileItem[] = [];
  for (const section of sourceProfile?.sections ?? []) {
    items.push({
      id: `source-section:${stableId(section.id)}`,
      kind: "source_profile",
      title: section.title,
      summary: section.teachingSummary,
      tags: uniq(["source", "section", section.title]),
      sourceIds: [section.id],
      weight: section.importance,
    });
  }

  for (const entity of sourceProfile?.entities ?? []) {
    items.push({
      id: `entity:${stableId(entity.name)}`,
      kind: "entity",
      title: entity.name,
      summary: entity.role,
      tags: uniq(["entity", entity.type, entity.name]),
      sourceIds: [entity.name],
      weight: 0.72,
    });
    for (const rel of entity.relationships) {
      if (!rel.to && !rel.nature && !rel.evolution) continue;
      items.push({
        id: `relationship:${stableId(`${entity.name}-${rel.to}-${rel.nature}`)}`,
        kind: "relationship",
        title: `${entity.name}${rel.to ? ` / ${rel.to}` : ""}`,
        summary: clean([rel.nature, rel.evolution].filter(Boolean).join(" — ")),
        tags: uniq(["relationship", entity.name, rel.to, rel.nature]),
        sourceIds: [entity.name, rel.to].filter(Boolean),
        weight: 0.64,
      });
    }
  }

  for (const entity of semanticMap.visualLore?.entities ?? []) {
    items.push({
      id: `visual-lore:${stableId(entity.name)}`,
      kind: "visual_lore",
      title: entity.name,
      summary: clean([
        entity.silhouette,
        entity.canonicalTraits.slice(0, 5).join(", "),
        entity.materials.length ? `Materials: ${entity.materials.slice(0, 4).join(", ")}` : "",
        entity.colors.length ? `Colors: ${entity.colors.slice(0, 4).join(", ")}` : "",
        entity.sceneUse,
      ].filter(Boolean).join(". ")),
      tags: uniq(["visual lore", entity.category, entity.name, ...entity.aliases, ...(entity.sourceTerms ?? [])]),
        sourceIds: uniq([entity.name, entity.sourceSceneId, entity.sourceChapterId]),
      startWord: entity.sourceStartWord,
      endWord: entity.sourceEndWord,
      weight: entity.confidence,
    });
  }

  for (const scene of semanticMap.scenes) {
    const position = computeSceneWordPosition(scene, structure.chapters);
    items.push({
      id: `scene:${stableId(scene.id)}`,
      kind: "scene",
      title: scene.publicVisualBrief?.title || scene.threadLabel || scene.imageDescription || "Visual scene",
      summary: clean([
        scene.publicVisualBrief?.expectedDepiction,
        scene.directorBrief?.composition,
        scene.imageDescription,
        scene.threadMotif ? `Thread motif: ${scene.threadMotif}` : "",
      ].filter(Boolean).join(" ")),
      tags: uniq([
        "scene",
        scene.threadRole,
        scene.threadLabel,
        ...scene.emotionalVector,
        ...scene.symbolicMotifs,
        ...scene.atmosphericQualities,
      ]),
      sourceIds: uniq([scene.id, scene.visualSlotKey]),
      startWord: Math.max(0, position - 450),
      endWord: Math.min(structure.totalWords, position + 900),
      weight: scene.narrativeWeight,
    });
  }

  return {
    bookId: structure.bookId,
    builtAt: new Date().toISOString(),
    version: PROFILE_VERSION,
    identity: {
      title: structure.title,
      author: structure.author,
      workType: sourceProfile?.workType ?? semanticMap.workType,
      analysisProtocol: semanticMap.analysisProtocol,
      expositoryDomain: semanticMap.expositoryDomain,
    },
    positions: {
      totalWords: structure.totalWords,
      frontMatterEndWordPos: detectStoryStart(structure),
      passageBoundaries,
    },
    artifactIds: {
      semanticMap: semanticMap.bookId,
      sourceProfile: sourceProfile?.bookId,
      visualLore: semanticMap.visualLore ? `${semanticMap.bookId}:visual-lore` : undefined,
      narrativeBlueprint: semanticMap.narrativeBlueprint ? `${semanticMap.bookId}:narrative-blueprint` : undefined,
      storyboard: semanticMap.storyboard ? `${semanticMap.bookId}:storyboard` : undefined,
    },
    storyCraft: {
      arcShape: semanticMap.arcShape,
      inflectionPoints: semanticMap.inflectionPoints,
      visualBeatCount: semanticMap.storyboard?.beats.length ?? semanticMap.scenes.length,
      pathwaySummary: semanticMap.storyboard?.pathwaySummary,
      threadLabels,
    },
    intelligence: {
      themes: uniq([
        ...(sourceProfile?.concepts.themes ?? []),
        ...(semanticMap.narrativeBlueprint?.threads.map((thread) => thread.centralMotif) ?? []),
      ]),
      motifs: uniq(semanticMap.scenes.flatMap((scene) => scene.symbolicMotifs)),
      tone: uniq(semanticMap.scenes.flatMap((scene) => scene.atmosphericQualities)),
      keyTerms: uniq(sourceProfile?.concepts.keyTerms ?? []),
      questions: uniq(sourceProfile?.concepts.questions ?? []),
    },
    items,
  };
}

export interface ScenePassage {
  text: string;
  startWord: number;
  endWord: number;
  chapterId: string;
  title: string;
}

export function getPassageForScene(
  scene: IdentifiedScene,
  structure: BookStructure,
  profile?: BookProfile | null
): ScenePassage {
  return getPassageForPosition(structure, computeSceneWordPosition(scene, structure.chapters), profile, scene);
}

function getPassageForPosition(
  structure: BookStructure,
  wordPosition: number,
  profile?: BookProfile | null,
  scene?: IdentifiedScene
): ScenePassage {
  const chapterHit = chapterForWord(structure, wordPosition);
  if (!chapterHit) {
    return { text: "", startWord: 0, endWord: 0, chapterId: "", title: structure.title };
  }

  const { chapter, startWord: chapterStart } = chapterHit;
  const chapterWords = words(chapter.rawText);
  const localPosition = Math.max(0, Math.min(chapterWords.length, wordPosition - chapterStart));
  const boundaries = profile?.positions.passageBoundaries ?? buildPassageBoundaries(structure, null);
  const nearestBoundary = boundaries
    .filter((b) => b.chapterId === chapter.id && wordPosition >= b.startWord - 80 && wordPosition <= b.endWord + 80)
    .sort((a, b) => {
      const aContains = wordPosition >= a.startWord && wordPosition <= a.endWord ? 0 : 1;
      const bContains = wordPosition >= b.startWord && wordPosition <= b.endWord ? 0 : 1;
      return aContains - bContains || (a.endWord - a.startWord) - (b.endWord - b.startWord);
    })[0];

  let localStart = Math.max(0, localPosition - 360);
  let localEnd = Math.min(chapterWords.length, localPosition + 900);
  if (nearestBoundary) {
    localStart = Math.max(0, nearestBoundary.startWord - chapterStart);
    localEnd = Math.min(chapterWords.length, nearestBoundary.endWord - chapterStart);
  }

  if (localEnd - localStart > MAX_PASSAGE_WORDS) {
    const before = Math.min(420, localPosition);
    localStart = Math.max(0, localPosition - before);
    localEnd = Math.min(chapterWords.length, localStart + MAX_PASSAGE_WORDS);
  }
  if (localEnd - localStart < MIN_PASSAGE_WORDS && chapterWords.length > MIN_PASSAGE_WORDS) {
    const pad = Math.ceil((MIN_PASSAGE_WORDS - (localEnd - localStart)) / 2);
    localStart = Math.max(0, localStart - pad);
    localEnd = Math.min(chapterWords.length, localEnd + pad);
  }

  if (scene?.anchor.wordOffset !== undefined) {
    localStart = Math.max(0, Math.min(localStart, scene.anchor.wordOffset));
    localEnd = Math.min(chapterWords.length, Math.max(localEnd, scene.anchor.wordOffset + 160));
  }

  return {
    text: chapterWords.slice(localStart, localEnd).join(" "),
    startWord: chapterStart + localStart,
    endWord: chapterStart + localEnd,
    chapterId: chapter.id,
    title: chapter.title || `Chapter ${chapter.index + 1}`,
  };
}

export function selectBookProfileItems(params: {
  profile?: BookProfile | null;
  scene: IdentifiedScene;
  passage: ScenePassage;
  limit?: number;
}): BookProfileItem[] {
  const profile = params.profile;
  if (!profile) return [];
  const limit = params.limit ?? 10;
  const queryTags = new Set(
    uniq([
      params.scene.threadLabel,
      params.scene.threadRole,
      ...params.scene.emotionalVector,
      ...params.scene.symbolicMotifs,
      ...params.scene.atmosphericQualities,
      ...(params.scene.directorBrief?.loreEntityNames ?? []),
    ]).map((tag) => tag.toLowerCase())
  );
  const passageText = params.passage.text.toLowerCase();
  return profile.items
    .map((item) => {
      const overlap = item.tags.filter((tag) => queryTags.has(tag.toLowerCase())).length;
      const titleHit = item.title && passageText.includes(item.title.toLowerCase()) ? 1 : 0;
      const hasRange = typeof item.startWord === "number" && typeof item.endWord === "number";
      const distance = hasRange
        ? params.passage.endWord < item.startWord!
          ? item.startWord! - params.passage.endWord
          : params.passage.startWord > item.endWord!
            ? params.passage.startWord - item.endWord!
            : 0
        : 6000;
      const proximity = Math.max(0, 1 - Math.min(distance, 12000) / 12000);
      return { item, score: item.weight + overlap * 0.35 + titleHit * 0.85 + proximity * 0.9 };
    })
    .filter(({ score }) => score > 0.45)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
    .slice(0, limit);
}

export function buildCompositionPrompt(params: {
  scene: IdentifiedScene;
  styleSeed: StyleSeed;
  passage: ScenePassage;
  profileItems: BookProfileItem[];
  readerDirection?: string;
}): string {
  const { scene, styleSeed, passage, profileItems } = params;
  const itemText = profileItems.length
    ? profileItems
        .map((item) => `- ${item.title}: ${item.summary.slice(0, 360)}`)
        .join("\n")
    : "- No extra profile items selected; rely on the passage and visual brief.";

  return `You are Lumina's local image composer. Convert this book passage into ONE vivid, literal, depictive frozen-frame image composition for a local image model.

Return only the final composition paragraph. Do not restate these instructions. Do not quote the source passage. Do not analyze. Do not critique. Do not include headings, JSON, bullet lists, labels, markdown, negative prompts, artist names, or copyrighted reference-image copying.

Requirements:
- 170 to 220 words.
- Present tense.
- Depict a specific physical moment from the passage, not a vague mood board.
- Render one instant only: no sequence, no "then", no before/after events; everything described is simultaneously visible in one frame.
- Preserve the important spatial relationships: who/what is foreground, background, above/below, near/far, moving/still.
- Use profile facts only when they are relevant to this passage.
- Respect reader direction if provided, but do not invent contradictions to the passage.
- Style seed to blend in naturally: ${styleSeed.name} — ${styleSeed.promptFragment}
- The first word of your answer must begin the composition itself, not a preface.

Format exemplar:
A small brass locket rests open in a gloved palm at the edge of a rain-dark window, its hinge catching a thin blade of cold morning light. Inside, a faded miniature portrait faces outward, half-obscured by a loose strand of hair caught beneath the glass. The hand holding it is tense but still, knuckles pale beneath worn leather, while the other hand hovers nearby as if afraid to touch the object. Behind the figure, the room falls into soft shadow: a chair pushed back, a candle guttering low, scattered letters lying unread on the table. The composition stays close and intimate, with the locket as the sharp focal point and the surrounding space blurred into grief, secrecy, and decision.

Scene target:
${scene.publicVisualBrief?.expectedDepiction || scene.directorBrief?.composition || scene.imageDescription || "Depict the selected story moment clearly."}

Reader visual direction:
${scene.publicVisualBrief?.readerDirection || params.readerDirection || "none"}

Relevant profile items:
${itemText}

Source passage (${passage.title}, words ${passage.startWord}-${passage.endWord}):
${passage.text}`;
}

export async function hashText(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function makeCompositionArtifact(params: {
  bookId: string;
  scene: IdentifiedScene;
  visualSlotKey?: string;
  passage: ScenePassage;
  composition: string;
  sourceItemIds: string[];
  provider: VisualCompositionArtifact["provider"];
  status?: VisualCompositionArtifact["status"];
  error?: string;
}): Promise<VisualCompositionArtifact> {
  const textHash = await hashText(`${params.passage.startWord}:${params.passage.endWord}:${params.passage.text}`);
  const now = new Date().toISOString();
  const id = `composition:${params.bookId}:${params.visualSlotKey ?? params.scene.id}:${textHash.slice(0, 12)}`;
  return {
    id,
    bookId: params.bookId,
    sceneId: params.scene.id,
    visualSlotKey: params.visualSlotKey,
    startWord: params.passage.startWord,
    endWord: params.passage.endWord,
    wordPosition: params.passage.startWord,
    provider: params.provider,
    textHash,
    composition: params.composition,
    sourceItemIds: params.sourceItemIds,
    createdAt: now,
    updatedAt: now,
    status: params.status ?? "ready",
    error: params.error,
  };
}
