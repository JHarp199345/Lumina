import type {
  ArcShape,
  BookStructure,
  IdentifiedScene,
  InflectionPoint,
  VisualBeat,
  VisualBeatType,
  VisualStoryboard,
} from "@/types";

export function buildVisualStoryboard(params: {
  bookId: string;
  arcShape: ArcShape;
  structure: BookStructure;
  scenes: IdentifiedScene[];
  inflectionPoints: InflectionPoint[];
  goldenNumber: number;
  defaultSceneIds?: Set<string>;
}): VisualStoryboard {
  const totalWords = Math.max(1, params.structure.totalWords);
  const orderedScenes = [...params.scenes].sort((a, b) => sceneWordPosition(a, params.structure) - sceneWordPosition(b, params.structure));
  const beats = orderedScenes.map((scene, index) =>
    buildBeat({
      scene,
      index,
      sceneCount: orderedScenes.length,
      totalWords,
      structure: params.structure,
      inflectionPoints: params.inflectionPoints,
      defaultSceneIds: params.defaultSceneIds,
    })
  );

  return {
    bookId: params.bookId,
    arcShape: params.arcShape,
    visualBeatCount: beats.length,
    generatedAt: new Date().toISOString(),
    densityTarget: chooseStoryboardDensity(params.structure.totalWords, params.goldenNumber),
    pathwaySummary: summarizePathway(params.arcShape, beats),
    beats,
  };
}

export function sceneWordPosition(scene: IdentifiedScene, structure: BookStructure): number {
  const chapter =
    structure.chapters.find((ch) => ch.id === scene.chapterId) ??
    structure.chapters.find((ch) => ch.spineIndex === scene.anchor?.spineIndex);
  if (!chapter) return 0;
  const before = structure.chapters
    .slice(0, chapter.index)
    .reduce((sum, ch) => sum + ch.wordCount, 0);
  return before + Math.max(0, scene.anchor?.wordOffset ?? 0);
}

function buildBeat(params: {
  scene: IdentifiedScene;
  index: number;
  sceneCount: number;
  totalWords: number;
  structure: BookStructure;
  inflectionPoints: InflectionPoint[];
  defaultSceneIds?: Set<string>;
}): VisualBeat {
  const position = sceneWordPosition(params.scene, params.structure);
  const arcPosition = Math.max(0, Math.min(1, position / params.totalWords));
  const beatType = classifyBeat(params.scene, params.index, params.sceneCount, arcPosition, params.inflectionPoints);
  const density = chooseVisualDensity(beatType, params.scene.narrativeWeight);
  const origin = params.scene.inflectionPointId === "reader_selected" ? "reader_selection" : "arc";
  const generationIntent =
    origin === "reader_selection"
      ? "reader_requested"
      : params.defaultSceneIds
        ? params.defaultSceneIds.has(params.scene.id) ? "default" : "planned_only"
        : params.scene.inflectionPointId.startsWith("planned_") ? "planned_only" : "default";

  return {
    id: `beat_${params.index}_${params.scene.id}`,
    sceneId: params.scene.id,
    beatIndex: params.index,
    beatType,
    origin,
    generationIntent,
    arcPosition,
    readerTriggerWord: position,
    emotionalPurpose: describePurpose(beatType, params.scene),
    // Real thread linkage from the narrative blueprint (carried on the scene),
    // falling back to a motif guess only when the scene is on no thread.
    setupPayoffThread: params.scene.threadId ?? inferThread(beatType, params.scene),
    threadRole: params.scene.threadRole,
    threadMotif: params.scene.threadMotif,
    pacingNote: describePacing(beatType, params.index, params.sceneCount),
    visualDensity: density,
  };
}

function classifyBeat(
  scene: IdentifiedScene,
  index: number,
  sceneCount: number,
  arcPosition: number,
  inflectionPoints: InflectionPoint[]
): VisualBeatType {
  if (scene.inflectionPointId === "opening" || index === 0) return "opening";
  if (index === sceneCount - 1) return arcPosition > 0.82 ? "closing" : "aftermath";

  // Prefer the scene's real thread role over keyword heuristics — the blueprint
  // already decided what this moment does in the book's structure.
  if (scene.threadRole) {
    const fromThread = beatTypeFromThreadRole(scene.threadRole);
    if (fromThread) return fromThread;
  }

  const linkedPoint = inflectionPoints.find((point) => point.id === scene.inflectionPointId);
  const label = `${linkedPoint?.narrativeLabel ?? ""} ${linkedPoint?.emotionalShift ?? ""} ${scene.emotionalVector.join(" ")} ${scene.symbolicMotifs.join(" ")}`.toLowerCase();

  if (label.match(/payoff|climax|triumph|victory|fulfill|reveal|decisive/)) return "payoff";
  if (label.match(/cost|loss|grief|aftermath|ruin|consequence/)) return "cost";
  if (label.match(/betray|reverse|fall|break|turn/)) return "reversal";
  if (label.match(/promise|oath|vow|commit/)) return "promise";
  if (label.match(/mystery|secret|unknown|hidden|uncertainty/)) return "mystery_seed";
  if (label.match(/suspense|dread|fear|threat|foreboding|tension/)) return "suspense_build";

  if (arcPosition < 0.22) return "setup";
  if (arcPosition < 0.55) return "suspense_build";
  if (arcPosition < 0.78) return "approach";
  return "payoff";
}

function beatTypeFromThreadRole(role: NonNullable<IdentifiedScene["threadRole"]>): VisualBeatType | null {
  switch (role) {
    case "setup": return "setup";
    case "build": return "suspense_build";
    case "payoff": return "payoff";
    case "cost": return "cost";
    case "echo": return "aftermath";
    default: return null;
  }
}

function chooseStoryboardDensity(totalWords: number, beatCount: number): VisualStoryboard["densityTarget"] {
  const ratio = beatCount / Math.max(1, totalWords / 50000);
  if (ratio < 3.5) return "sparse";
  if (ratio > 6.5) return "rich";
  return "balanced";
}

function chooseVisualDensityForBeat(weight: number): VisualBeat["visualDensity"] {
  if (weight >= 0.82) return "high";
  if (weight <= 0.45) return "quiet";
  return "moderate";
}

function chooseVisualDensity(beatType: VisualBeatType, weight: number): VisualBeat["visualDensity"] {
  if (beatType === "opening" || beatType === "setup" || beatType === "mystery_seed") return "quiet";
  if (beatType === "payoff" || beatType === "reversal") return "high";
  if (beatType === "cost" || beatType === "aftermath") return "moderate";
  return chooseVisualDensityForBeat(weight);
}

function describePurpose(beatType: VisualBeatType, scene: IdentifiedScene): string {
  const themes = [...scene.emotionalVector, ...scene.symbolicMotifs].slice(0, 4).join(", ");
  const purposeByType: Record<VisualBeatType, string> = {
    opening: "Establish the visible world, tone, and first emotional invitation.",
    setup: "Plant visual context that later images can build from.",
    mystery_seed: "Introduce uncertainty or an object/question the reader will carry forward.",
    suspense_build: "Increase pressure before a payoff without exhausting the reader too early.",
    promise: "Mark a commitment, desire, or stated direction that can later be fulfilled or broken.",
    reversal: "Show a turn in the visual story where expectation changes.",
    approach: "Move the picture-story toward a major consequence or confrontation.",
    payoff: "Deliver a major visual event the arc has been building toward.",
    cost: "Show the price or consequence of a triumph, choice, or collision.",
    aftermath: "Let the reader sit with what changed after the event.",
    closing: "Give the visual thread a final resting image or last emotional shape.",
  };
  return `${purposeByType[beatType]} Scene qualities: ${themes || "emotional transition"}.`;
}

function inferThread(beatType: VisualBeatType, scene: IdentifiedScene): string | undefined {
  if (beatType === "setup" || beatType === "promise" || beatType === "mystery_seed") {
    return scene.symbolicMotifs[0] || scene.emotionalVector[0] || "unresolved visual thread";
  }
  if (beatType === "payoff" || beatType === "cost" || beatType === "aftermath") {
    return scene.symbolicMotifs[0] || "payoff consequence";
  }
  return undefined;
}

function describePacing(beatType: VisualBeatType, index: number, count: number): string {
  if (beatType === "opening") return "First visual anchor; should be inviting and readable without spoiling later plot.";
  if (beatType === "payoff") return "High-impact image; should feel earned by prior beats.";
  if (beatType === "cost" || beatType === "aftermath") return "Let intensity breathe; show consequence rather than another peak.";
  if (index > 0 && index < count - 1) return "Maintain contrast with surrounding beats so the visual sequence does not flatten.";
  return "Support the visual rhythm of the book.";
}

function summarizePathway(arcShape: ArcShape, beats: VisualBeat[]): string {
  const sequence = beats.map((beat) => beat.beatType.replace("_", " ")).join(" → ");
  return `A ${arcShape} visual pathway with ${beats.length} beats: ${sequence}.`;
}
