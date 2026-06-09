/**
 * Shared grounding for Audio Overview, Presentation Studio, and SIP —
 * branches on analysisProtocol so expository books teach ideas, not story arcs.
 */

import type {
  AnalysisProtocol,
  BookStructure,
  Chapter,
  ExpositoryDomain,
  IdentifiedScene,
  SemanticMap,
  SourceIntelligenceProfile,
  WorkType,
} from "@/types";

export interface KnowledgeScope {
  type: "whole" | "current" | "choose";
  chapterIds?: string[];
  currentChapterIndex?: number;
}

export function knowledgeProtocol(
  map: SemanticMap | null | undefined,
  profile?: SourceIntelligenceProfile | null
): AnalysisProtocol {
  if (profile?.analysisProtocol) return profile.analysisProtocol;
  if (map?.analysisProtocol) return map.analysisProtocol;
  const wt = profile?.workType ?? map?.workType;
  if (wt === "nonfiction" || wt === "scholarly" || wt === "manual" || wt === "reference") {
    return "expository";
  }
  if (profile?.structureKind === "subjectHierarchy") return "expository";
  return "narrative";
}

export function knowledgeWorkType(
  map: SemanticMap | null | undefined,
  profile?: SourceIntelligenceProfile | null
): WorkType {
  if (profile?.workType) return profile.workType;
  if (map?.workType) return map.workType;
  return knowledgeProtocol(map, profile) === "expository" ? "scholarly" : "fiction";
}

function chaptersForScope(scope: KnowledgeScope, structure: BookStructure): Chapter[] {
  const all = structure.chapters;
  if (scope.type === "whole") return all;
  if (scope.type === "current") {
    const idx = Math.max(0, scope.currentChapterIndex ?? 0);
    const ch = all[idx];
    return ch ? [ch] : all.slice(0, 1);
  }
  const ids = new Set(scope.chapterIds ?? []);
  const picked = all.filter((c) => ids.has(c.id));
  return picked.length > 0 ? picked : all;
}

function expositoryScenes(map: SemanticMap | null): IdentifiedScene[] {
  if (!map) return [];
  return map.scenes.filter((s) => s.expositoryBeat);
}

function sceneSort(scenes: IdentifiedScene[], chapters: Chapter[]): IdentifiedScene[] {
  const chapterIndex = new Map(chapters.map((c) => [c.id, c.index]));
  return [...scenes].sort((a, b) => {
    const ai = chapterIndex.get(a.chapterId) ?? 0;
    const bi = chapterIndex.get(b.chapterId) ?? 0;
    if (ai !== bi) return ai - bi;
    return (a.anchor?.wordOffset ?? 0) - (b.anchor?.wordOffset ?? 0);
  });
}

/** Idea-map outline for whole-book or chapter-scoped knowledge features. */
export function buildExpositoryScopeOutline(
  scope: KnowledgeScope,
  structure: BookStructure,
  map: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);
  const scenes = sceneSort(expositoryScenes(map), structure.chapters);
  const domain = map?.expositoryDomain ?? "general";
  const lines: string[] = [];

  lines.push(`"${structure.title}" by ${structure.author} — expository / teaching work.`);
  if (domain !== "general") lines.push(`Domain: ${domain}.`);

  const keyTerms = unique(
    scenes.flatMap((s) => s.expositoryBeat?.keyTerms ?? []).slice(0, 24)
  );
  if (keyTerms.length) lines.push(`Key terminology: ${keyTerms.join(", ")}.`);

  const claims = scenes
    .map((s) => s.expositoryBeat?.centralClaim)
    .filter(Boolean)
    .slice(0, 12) as string[];
  if (claims.length) {
    lines.push("Central ideas across the work:");
    claims.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
  }

  if (scope.type === "whole") {
    lines.push("");
    lines.push("Chapter path:");
    chapters.forEach((c, i) => {
      const chapterScenes = scenes.filter((s) => s.chapterId === c.id);
      const headline =
        chapterScenes[0]?.expositoryBeat?.centralClaim ??
        chapterScenes[0]?.expositoryBeat?.sectionTitle;
      lines.push(
        `  ${i + 1}. ${c.title || `Chapter ${c.index + 1}`}${headline ? ` — ${headline}` : ""}`
      );
    });
    return lines.join("\n").trim();
  }

  for (const c of chapters) {
    lines.push("");
    lines.push(`${c.title || `Chapter ${c.index + 1}`}:`);
    const chapterScenes = scenes.filter((s) => s.chapterId === c.id);
    if (chapterScenes.length === 0) {
      const opener = (c.rawText || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (opener) lines.push(`  ${opener}…`);
      continue;
    }
    for (const scene of chapterScenes) {
      const beat = scene.expositoryBeat!;
      lines.push(`  • ${beat.sectionTitle}: ${beat.centralClaim}`);
      if (beat.keyTerms.length) lines.push(`    Terms: ${beat.keyTerms.join(", ")}.`);
    }
  }

  return lines.join("\n").trim();
}

/** Chapter-scoped teaching material — focused excerpts first, raw prose as fallback. */
export function buildExpositorySourceContext(
  scope: KnowledgeScope,
  structure: BookStructure,
  map: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);
  const scenes = sceneSort(expositoryScenes(map), structure.chapters);
  const parts: string[] = [];
  let budget = 6000;

  for (const chapter of chapters) {
    const chapterScenes = scenes.filter((s) => s.chapterId === chapter.id);
    if (chapterScenes.length > 0) {
      for (const scene of chapterScenes) {
        if (budget <= 0) break;
        const beat = scene.expositoryBeat!;
        const header = `## ${beat.sectionTitle} (${chapter.title})`;
        const body = beat.focusedExcerpt || beat.centralClaim;
        const words = body.split(/\s+/).filter(Boolean);
        const take = words.slice(0, Math.min(budget, 900)).join(" ");
        budget -= words.length;
        parts.push(`${header}\nCentral claim: ${beat.centralClaim}\nKey terms: ${beat.keyTerms.join(", ") || "—"}\n\n${take}`);
      }
      continue;
    }

    const words = (chapter.rawText || "").split(/\s+/).filter(Boolean);
    const take = words.slice(0, Math.max(0, budget)).join(" ");
    budget -= words.length;
    parts.push(`## ${chapter.title || `Chapter ${chapter.index + 1}`}\n${take}`);
    if (budget <= 0) break;
  }

  return parts.join("\n\n");
}

/** Grounding block for SIP builder when analysisProtocol is expository. */
export function gatherExpositoryAnalysisGrounding(
  structure: BookStructure,
  map: SemanticMap | null
): string {
  const lines: string[] = [];
  lines.push(`Title: ${structure.title}`);
  lines.push(`Author: ${structure.author}`);
  lines.push(`Analysis protocol: expository (ideas / argument / teaching)`);
  if (map?.expositoryDomain) lines.push(`Domain: ${map.expositoryDomain}`);
  if (map?.workType) lines.push(`Work type: ${map.workType}`);
  lines.push(`Chapters: ${structure.chapters.length}, total words: ${structure.totalWords}`);

  const scenes = sceneSort(expositoryScenes(map), structure.chapters);
  if (scenes.length) {
    lines.push("Idea map (from analysis — use these as the spine):");
    for (const scene of scenes.slice(0, 40)) {
      const beat = scene.expositoryBeat!;
      lines.push(
        `  - [${beat.sectionTitle}] ${beat.centralClaim} (importance ${beat.importance.toFixed(2)}, type: ${beat.visualType})`
      );
      if (beat.keyTerms.length) lines.push(`    Terms: ${beat.keyTerms.join(", ")}`);
      const excerpt = beat.focusedExcerpt.split(/\s+/).slice(0, 120).join(" ");
      if (excerpt) lines.push(`    Teaching excerpt: ${excerpt}…`);
    }
  }

  lines.push("Chapter list:");
  structure.chapters.forEach((c, i) =>
    lines.push(`  ${i + 1}. ${c.title || `Chapter ${c.index + 1}`}`)
  );

  const sampleChapters = pickEvenly(structure.chapters, 4);
  let budget = 1800;
  lines.push("Supplementary prose samples (secondary to the idea map):");
  for (const c of sampleChapters) {
    if (budget <= 0) break;
    const words = (c.rawText || "").split(/\s+/).filter(Boolean).slice(0, 250);
    budget -= words.length;
    if (words.length) lines.push(`  [${c.title}] ${words.join(" ")}`);
  }

  return lines.join("\n");
}

export function expositoryProfileGroundingExtras(profile: SourceIntelligenceProfile): string {
  const lines: string[] = [];
  if (profile.expositoryDomain && profile.expositoryDomain !== "general") {
    lines.push(`Domain: ${profile.expositoryDomain}.`);
  }
  return lines.join("\n");
}

export function defaultKnowledgeSpine(
  protocol: AnalysisProtocol,
  workType: WorkType,
  minutes: number,
  targetWords: number,
  medium: "spoken" | "slides" = "spoken"
): string {
  const scholarly =
    protocol === "expository" ||
    workType === "nonfiction" ||
    workType === "scholarly" ||
    workType === "reference" ||
    workType === "manual";

  if (scholarly) {
    if (medium === "slides") {
      return `Create a clear teaching slide deck for this expository work. Organize by ideas and subject hierarchy — not chapter openings. Cover the central thesis, major concepts, definitions, contrasts between models, mechanisms, key terminology, supporting evidence, and implications. One main idea per slide; bullets should teach, not narrate anecdotes.`;
    }
    return `You are a subject-matter expert and an excellent teacher. In about ${minutes} minutes (~${targetWords} spoken words), give a structured explanation of this expository work. State the central thesis early. Explain the major concepts, definitions, and models; show how ideas build on each other; define key terminology; present the main arguments and evidence; address important contrasts or objections the author raises. Organize by topic and subject hierarchy — not by summarizing chapter openings or retelling anecdotes.`;
  }

  if (medium === "slides") {
    return `Create a clear slide deck explaining this narrative work: premise, characters, conflicts, turning points, relationships, and themes.`;
  }
  return `You are a subject-matter expert and an excellent teacher. In about ${minutes} minutes (~${targetWords} spoken words), explain this book clearly and engagingly. Cover the main story arc, major characters and factions, central conflicts, important turning points, and how relationships and themes develop. Organize by the book's natural parts or acts. Do not read passages aloud; explain what happens, why it matters, and how it develops.`;
}

export function suggestPromptFraming(protocol: AnalysisProtocol): string {
  if (protocol === "expository") {
    return "It must be purposeful and specific to THIS expository material: name real concepts, models, definitions, contrasts, and evidence; state what to explain, in what order, and what the listener should understand by the end. Do not frame this as character development or emotional plot arc.";
  }
  return "It must be purposeful and specific to THIS material: name real entities, conflicts, ideas, and developments; state what to explain, in what order, and what the listener should understand by the end.";
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

export function inferDomainFromMap(map: SemanticMap | null): ExpositoryDomain | undefined {
  return map?.expositoryDomain;
}
