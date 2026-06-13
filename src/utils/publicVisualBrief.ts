import type { IdentifiedScene, PublicVisualBrief, VisualBeat } from "@/types";

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sceneTitle(scene: IdentifiedScene, beat?: VisualBeat): string {
  const motif = scene.symbolicMotifs.find((item) => item.length > 2);
  if (motif) return titleCase(motif).slice(0, 64);
  if (scene.expositoryBeat?.sectionTitle) return scene.expositoryBeat.sectionTitle.slice(0, 64);
  return titleCase(beat?.beatType ?? "visual moment");
}

export function buildPublicVisualBrief(scene: IdentifiedScene, beat?: VisualBeat): PublicVisualBrief {
  const beatLabel = titleCase(beat?.beatType ?? "planned moment");
  const emotions = scene.emotionalVector.slice(0, 2).join(" + ") || "story pressure";
  const motifs = scene.symbolicMotifs.slice(0, 3);
  const atmosphere = scene.atmosphericQualities.slice(0, 2).join(", ") || "the scene's atmosphere";

  return {
    title: sceneTitle(scene, beat),
    teaser: `${beatLabel} shaped by ${emotions}.`,
    expectedDepiction:
      scene.expositoryBeat?.centralClaim ||
      scene.directorBrief?.blocking?.focalPoint ||
      scene.imageDescription ||
      `A visual moment built around ${motifs.join(", ") || "the selected passage"}.`,
    whyChosen:
      beat?.emotionalPurpose ||
      `Lumina selected this moment for its ${atmosphere} and its place in the book's visual rhythm.`,
    tags: motifs.map((label, index) => ({
      id: `${scene.id}_tag_${index}`,
      label,
      description: `A visible ingredient Lumina may use when composing this image.`,
      weight: Math.max(3, Math.round((scene.narrativeWeight || 0.5) * 10) - index),
    })),
    weightedDirections: [
      ...motifs.map((label, index) => ({
        id: `${scene.id}_motif_${index}`,
        label,
        kind: "important" as const,
        weight: Math.max(4, 8 - index),
        source: "book" as const,
      })),
      ...scene.atmosphericQualities.slice(0, 2).map((label, index) => ({
        id: `${scene.id}_atmosphere_${index}`,
        label,
        kind: "style" as const,
        weight: Math.max(3, 6 - index),
        source: "book" as const,
      })),
    ],
    referenceImages: [],
    highlightColor: scene.publicVisualBrief?.highlightColor,
    updatedAt: new Date().toISOString(),
  };
}
