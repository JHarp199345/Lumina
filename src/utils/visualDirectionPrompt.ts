import type { IdentifiedScene, PublicVisualBrief, WeightedVisualDirection } from "@/types";

function clampWeight(weight: number | undefined): number {
  if (!Number.isFinite(weight)) return 5;
  return Math.max(1, Math.min(10, Math.round(weight ?? 5)));
}

function sortDirections(items: WeightedVisualDirection[]): WeightedVisualDirection[] {
  return [...items].sort((a, b) => clampWeight(b.weight) - clampWeight(a.weight));
}

function formatWeighted(items: WeightedVisualDirection[], kind: WeightedVisualDirection["kind"]): string[] {
  return sortDirections(items)
    .filter((item) => item.kind === kind)
    .slice(0, kind === "avoid" ? 8 : 10)
    .map((item) => `${item.label} (weight ${clampWeight(item.weight)}/10, source ${item.source})`);
}

function referenceNotes(brief: PublicVisualBrief): string[] {
  return brief.referenceImages.slice(0, 4).map((ref) => {
    if (ref.analysisStatus === "analyzed" && ref.analysis) {
      const traits = ref.analysis.visualTraits.slice(0, 5).join(", ");
      const palette = ref.analysis.palette.slice(0, 4).join(", ");
      const preserve = ref.analysis.preserve.slice(0, 4).join(", ");
      const avoid = ref.analysis.avoidCopying.slice(0, 4).join(", ");
      return [
        `Reference "${ref.fileName}": ${ref.analysis.summary}`,
        traits ? `traits: ${traits}` : "",
        palette ? `palette: ${palette}` : "",
        preserve ? `preserve: ${preserve}` : "",
        avoid ? `avoid exact copying: ${avoid}` : "",
      ].filter(Boolean).join("; ");
    }
    return `Reference "${ref.fileName}" attached by reader, ownership confirmed, not yet visually analyzed; do not copy it exactly.`;
  });
}

export function buildReaderVisualDirectionPrompt(scene: IdentifiedScene): string {
  const brief = scene.publicVisualBrief;
  if (!brief) return "";

  const required = formatWeighted(brief.weightedDirections, "required");
  const important = formatWeighted(brief.weightedDirections, "important");
  const optional = formatWeighted(brief.weightedDirections, "optional");
  const style = formatWeighted(brief.weightedDirections, "style");
  const composition = formatWeighted(brief.weightedDirections, "composition");
  const avoid = formatWeighted(brief.weightedDirections, "avoid");
  const refs = referenceNotes(brief);

  const sections = [
    `READER-FACING VISUAL BRIEF: "${brief.title}". ${brief.teaser}`,
    `Expected depiction: ${brief.expectedDepiction}`,
    `Why chosen: ${brief.whyChosen}`,
    brief.readerDirection?.trim()
      ? `Reader override direction, honor strongly unless unsafe or impossible: ${brief.readerDirection.trim()}`
      : "",
    required.length ? `Required visual elements: ${required.join("; ")}` : "",
    important.length ? `Important visual elements: ${important.join("; ")}` : "",
    composition.length ? `Composition priorities: ${composition.join("; ")}` : "",
    style.length ? `Style/mood priorities: ${style.join("; ")}` : "",
    optional.length ? `Optional details: ${optional.join("; ")}` : "",
    refs.length ? `Reader reference image analysis: ${refs.join(" | ")}` : "",
    avoid.length ? `Avoid: ${avoid.join("; ")}` : "",
    "Treat reader additions as explicit creative overrides, separate from canonical book facts. Preserve the book anchor and scene position.",
  ].filter(Boolean);

  return sections.join("\n");
}

export function buildReaderVisualDirectionTags(scene: IdentifiedScene): string {
  const brief = scene.publicVisualBrief;
  if (!brief) return "";
  const weighted = sortDirections(brief.weightedDirections)
    .filter((item) => item.kind !== "avoid")
    .slice(0, 12)
    .map((item) => `${item.label}:weight-${clampWeight(item.weight)}`);
  const avoid = formatWeighted(brief.weightedDirections, "avoid").map((item) => `avoid ${item}`);
  const refs = referenceNotes(brief).slice(0, 2);
  return [...weighted, ...refs, ...avoid].join(", ");
}
