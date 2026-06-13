import type {
  BlackboardNote,
  CachedImage,
  Chapter,
  IdentifiedScene,
  SemanticMap,
  VisualLoreEntity,
} from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { visualSlotKeyForScene } from "@/utils/sceneDedup";
import { diagnosticInfo } from "@/utils/diagnostics";

const BLACKBOARD_VERSION = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function uniq(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function noteBase(params: {
  bookId: string;
  blackboardId: string;
  kind: BlackboardNote["kind"];
  idTail: string;
  title: string;
  body: string;
  tags: string[];
  sourceIds: string[];
  chapterId?: string;
  sceneId?: string;
  visualSlotKey?: string;
  startWord?: number;
  endWord?: number;
  confidence?: number;
}): BlackboardNote {
  const timestamp = nowIso();
  return {
    id: `${params.blackboardId}:${params.kind}:${slug(params.idTail)}`,
    bookId: params.bookId,
    blackboardId: params.blackboardId,
    kind: params.kind,
    title: params.title,
    body: params.body,
    tags: uniq(params.tags),
    sourceIds: uniq(params.sourceIds),
    ...(params.chapterId ? { chapterId: params.chapterId } : {}),
    ...(params.sceneId ? { sceneId: params.sceneId } : {}),
    ...(params.visualSlotKey ? { visualSlotKey: params.visualSlotKey } : {}),
    ...(typeof params.startWord === "number" ? { startWord: params.startWord } : {}),
    ...(typeof params.endWord === "number" ? { endWord: params.endWord } : {}),
    confidence: Math.max(0, Math.min(1, params.confidence ?? 0.7)),
    createdAt: timestamp,
    updatedAt: timestamp,
    version: BLACKBOARD_VERSION,
  };
}

function sceneNote(map: SemanticMap, scene: IdentifiedScene, chapters: Chapter[]): BlackboardNote {
  const position = computeSceneWordPosition(scene, chapters);
  const slotKey = visualSlotKeyForScene(scene, chapters);
  const tags = uniq([
    "scene",
    slotKey,
    scene.threadRole,
    scene.threadLabel,
    ...scene.emotionalVector,
    ...scene.symbolicMotifs,
    ...scene.atmosphericQualities,
    scene.expositoryBeat?.visualType,
    scene.expositoryBeat?.domain,
  ]);
  const body = [
    scene.imageDescription,
    scene.publicVisualBrief?.expectedDepiction,
    scene.publicVisualBrief?.whyChosen,
    scene.directorBrief?.composition,
    scene.expositoryBeat?.centralClaim,
    scene.threadMotif ? `Thread motif: ${scene.threadMotif}` : "",
  ].filter(Boolean).join("\n");

  return noteBase({
    bookId: map.bookId,
    blackboardId: `${map.bookId}:semantic`,
    kind: "scene",
    idTail: scene.id,
    title: scene.publicVisualBrief?.title ?? scene.expositoryBeat?.sectionTitle ?? scene.id,
    body,
    tags,
    sourceIds: [scene.id, scene.chapterId, scene.sectionId],
    chapterId: scene.chapterId,
    sceneId: scene.id,
    visualSlotKey: slotKey ?? undefined,
    startWord: position,
    endWord: position + 900,
    confidence: scene.narrativeWeight || scene.expositoryBeat?.importance || 0.65,
  });
}

function loreNote(map: SemanticMap, entity: VisualLoreEntity): BlackboardNote {
  const body = [
    entity.silhouette && `Silhouette: ${entity.silhouette}`,
    entity.canonicalTraits.length ? `Traits: ${entity.canonicalTraits.join(", ")}` : "",
    entity.materials.length ? `Materials: ${entity.materials.join(", ")}` : "",
    entity.colors.length ? `Colors: ${entity.colors.join(", ")}` : "",
    entity.motifs.length ? `Motifs: ${entity.motifs.join(", ")}` : "",
    entity.sceneUse && `Scene use: ${entity.sceneUse}`,
  ].filter(Boolean).join("\n");

  return noteBase({
    bookId: map.bookId,
    blackboardId: `${map.bookId}:semantic`,
    kind: "lore",
    idTail: entity.sourceSceneId ? `${entity.sourceSceneId}-${entity.name}` : entity.name,
    title: entity.name,
    body,
    tags: uniq([
      "lore",
      entity.category,
      entity.name,
      ...entity.aliases,
      ...(entity.sourceTerms ?? []),
      ...entity.motifs,
      ...entity.colors,
      ...entity.materials,
    ]),
    sourceIds: uniq([entity.sourceSceneId, entity.sourceChapterId, entity.name]),
    chapterId: entity.sourceChapterId,
    sceneId: entity.sourceSceneId,
    startWord: entity.sourceStartWord,
    endWord: entity.sourceEndWord,
    confidence: entity.confidence,
  });
}

function imageNote(map: SemanticMap, image: CachedImage): BlackboardNote {
  return noteBase({
    bookId: map.bookId,
    blackboardId: `${map.bookId}:semantic`,
    kind: "image",
    idTail: image.id,
    title: `Generated image ${image.sceneId}`,
    body: image.descriptionUsed,
    tags: uniq(["image", image.styleSeed, image.generationApi, ...image.emotionalThemes]),
    sourceIds: [image.id, image.sceneId],
    sceneId: image.sceneId,
    startWord: image.wordPosition,
    endWord: typeof image.wordPosition === "number" ? image.wordPosition + 900 : undefined,
    confidence: 0.75,
  });
}

export function buildBlackboardImageNote(semanticMap: SemanticMap, image: CachedImage): BlackboardNote {
  return imageNote(semanticMap, image);
}

export function buildBlackboardNotesForBook(params: {
  semanticMap: SemanticMap;
  chapters: Chapter[];
  images?: CachedImage[];
}): BlackboardNote[] {
  const notes: BlackboardNote[] = [];
  notes.push(...params.semanticMap.scenes.map((scene) => sceneNote(params.semanticMap, scene, params.chapters)));
  notes.push(...(params.semanticMap.visualLore?.entities ?? []).map((entity) => loreNote(params.semanticMap, entity)));
  notes.push(...(params.images ?? []).map((image) => imageNote(params.semanticMap, image)));

  diagnosticInfo("blackboard.notes.built", "Indexed blackboard notes built", {
    bookId: params.semanticMap.bookId,
    scenes: params.semanticMap.scenes.length,
    lore: params.semanticMap.visualLore?.entities.length ?? 0,
    images: params.images?.length ?? 0,
    notes: notes.length,
  });

  return notes;
}

export function retrieveBlackboardNotes(params: {
  notes: BlackboardNote[];
  wordPosition?: number;
  tags?: string[];
  limit?: number;
}): BlackboardNote[] {
  const limit = params.limit ?? 12;
  const queryTags = new Set((params.tags ?? []).map((tag) => tag.toLowerCase()));
  return params.notes
    .map((note) => {
      const overlap = note.tags.filter((tag) => queryTags.has(tag.toLowerCase())).length;
      const hasRange =
        typeof params.wordPosition === "number" &&
        typeof note.startWord === "number" &&
        typeof note.endWord === "number";
      const distance = hasRange
        ? params.wordPosition! < note.startWord!
          ? note.startWord! - params.wordPosition!
          : params.wordPosition! > note.endWord!
            ? params.wordPosition! - note.endWord!
            : 0
        : Number.POSITIVE_INFINITY;
      const positionScore = hasRange ? Math.max(0, 1 - Math.min(distance, 8000) / 8000) : 0;
      return {
        note,
        score: note.confidence + overlap * 0.45 + positionScore * 1.25,
      };
    })
    .filter(({ score }) => score > 0.2)
    .sort((a, b) => b.score - a.score)
    .map(({ note }) => note)
    .slice(0, limit);
}
