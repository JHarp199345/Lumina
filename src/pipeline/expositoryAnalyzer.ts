/**
 * Expository analysis protocol — map books by ideas, not emotional arcs.
 * Sections are heading-bounded; visuals are diagrams / infographics.
 */

import { llmGenerate, llmGenerateJSON } from "@/api/llmClient";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
import { buildVisualStoryboard } from "@/pipeline/visualStoryboard";
import {
  catalogStructuralBoundaries,
  isBoilerplateChapterTitle,
  sectionTitleFromText,
  snapToBoundary,
} from "@/pipeline/expositoryBoundaries";
import { refreshStructuralSections } from "@/pipeline/structuralSections";
import { domainStyleHint, type WorkProtocolResult } from "@/pipeline/workProtocol";
import type {
  AnalysisProgressReporter,
  BookStructure,
  Chapter,
  ExpositoryBeat,
  ExpositoryDomain,
  ExpositoryVisualType,
  IdentifiedScene,
  MacroArc,
  Section,
  SemanticMap,
} from "@/types";

const MIN_SECTION_WORDS = 180;
const IMPORTANCE_THRESHOLD = 0.5;
const BATCH_SIZE = 6;

interface SectionCandidate {
  chapter: Chapter;
  section: Section;
  sectionTitle: string;
}

interface ExtractedIdea {
  sectionId: string;
  skip: boolean;
  importance: number;
  centralClaim: string;
  keyTerms: string[];
  visualType: ExpositoryVisualType;
  focusedExcerpt: string;
}

const VALID_VISUAL_TYPES: ExpositoryVisualType[] = [
  "definition",
  "contrast",
  "mechanism",
  "flowchart",
  "anatomy_diagram",
  "concept_map",
  "timeline",
  "case_study",
  "synthesis",
  "infographic",
];

export async function analyzeExpositoryBook(
  structure: BookStructure,
  apiKey: string,
  protocol: WorkProtocolResult,
  onProgress?: AnalysisProgressReporter
): Promise<SemanticMap> {
  const report = (p: Parameters<AnalysisProgressReporter>[0]) => {
    if (!onProgress) return;
    if (typeof p === "string") {
      onProgress({ phase: "preparing", message: p, percent: 0, analysisProtocol: "expository" });
      return;
    }
    onProgress({
      ...p,
      analysisProtocol: "expository",
      percent: Math.max(0, Math.min(100, Math.round(p.percent))),
    });
  };

  report({
    phase: "preparing",
    message: `Mapping ideas across ${structure.chapters.length} chapters…`,
    percent: 5,
  });

  const analysisStructure = refreshStructuralSections(structure, true);
  const candidates = collectSectionCandidates(analysisStructure);

  report({
    phase: "mapping",
    message: `Analyzing ${candidates.length} teaching sections for key ideas…`,
    percent: 18,
    total: candidates.length,
  });

  const extracted = await extractIdeasFromSections(
    analysisStructure.title,
    analysisStructure.author,
    protocol.domain,
    candidates,
    apiKey,
    report
  );

  const selected = extracted
    .filter((idea) => !idea.skip && idea.importance >= IMPORTANCE_THRESHOLD)
    .sort((a, b) => b.importance - a.importance);

  const goldenNumber = calculateExpositoryGoldenNumber(analysisStructure.totalWords, selected.length);
  const scenes = buildScenesFromIdeas(analysisStructure, selected, candidates, protocol, goldenNumber);

  report({
    phase: "prompts",
    message: `Writing diagram briefs for ${scenes.length} idea moments…`,
    percent: 72,
    current: 0,
    total: scenes.length,
  });

  const scenesWithDescriptions = await generateExpositoryDescriptions(
    scenes,
    analysisStructure.title,
    protocol,
    apiKey,
    report
  );

  const macroArc: MacroArc = {
    arcShape: "rise",
    dominantEmotions: [],
    centralThemes: [...new Set(scenesWithDescriptions.flatMap((s) => s.expositoryBeat?.keyTerms ?? []))].slice(0, 6),
    inflectionPoints: [],
  };

  const defaultSceneIds = new Set(
    scenesWithDescriptions
      .filter((_, i) => i < goldenNumber)
      .map((s) => s.id)
  );

  const storyboard = buildVisualStoryboard({
    bookId: analysisStructure.bookId,
    arcShape: macroArc.arcShape,
    structure: analysisStructure,
    scenes: scenesWithDescriptions,
    inflectionPoints: [],
    goldenNumber,
    defaultSceneIds,
  });

  report({
    phase: "complete",
    message: `Idea map complete: ${goldenNumber} priority diagrams and ${scenesWithDescriptions.length} teaching moments.`,
    percent: 88,
    current: goldenNumber,
    total: scenesWithDescriptions.length,
  });

  return {
    bookId: analysisStructure.bookId,
    visualPlanVersion: VISUAL_PLAN_VERSION,
    analysisProtocol: "expository",
    workType: protocol.workType,
    expositoryDomain: protocol.domain,
    arcShape: macroArc.arcShape,
    inflectionPoints: [],
    scenes: scenesWithDescriptions,
    goldenNumber,
    analyzedAt: new Date().toISOString(),
    storyboard,
  };
}

function collectSectionCandidates(structure: BookStructure): SectionCandidate[] {
  const result: SectionCandidate[] = [];

  for (const chapter of structure.chapters) {
    if (isBoilerplateChapterTitle(chapter.title)) continue;
    if (!chapter.rawText?.trim()) continue;

    const sections =
      chapter.sections.length > 0
        ? chapter.sections
        : [{ id: `${chapter.id}_s0`, chapterId: chapter.id, index: 0, wordCount: chapter.wordCount, startWordOffset: 0, rawText: chapter.rawText }];

    for (const section of sections) {
      if ((section.wordCount ?? 0) < MIN_SECTION_WORDS) continue;
      if (!(section.rawText || "").trim()) continue;

      result.push({
        chapter,
        section,
        sectionTitle: sectionTitleFromText(section.rawText || "", `${chapter.title} — section ${section.index + 1}`),
      });
    }
  }

  return result;
}

async function extractIdeasFromSections(
  title: string,
  author: string,
  domain: ExpositoryDomain,
  candidates: SectionCandidate[],
  apiKey: string,
  report: AnalysisProgressReporter
): Promise<ExtractedIdea[]> {
  const all: ExtractedIdea[] = [];

  for (let batchStart = 0; batchStart < candidates.length; batchStart += BATCH_SIZE) {
    const batch = candidates.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);

    report({
      phase: "scenes",
      message: `Extracting ideas from sections ${batchStart + 1}–${batchStart + batch.length}…`,
      percent: 20 + Math.round((batchStart / Math.max(1, candidates.length)) * 48),
      current: batchNum,
      total: totalBatches,
    });

    const prompt = buildExtractionPrompt(title, author, domain, batch);

    try {
      const parsed = await llmGenerateJSON<{ sections?: ExtractedIdea[] }>("reading", prompt, {
        temperature: 0.35,
        maxTokens: 4096,
        geminiKey: apiKey,
      });
      const items = parsed.sections ?? [];

      for (const candidate of batch) {
        const match =
          items.find((item) => item.sectionId === candidate.section.id) ??
          items[batch.indexOf(candidate)];

        if (match && match.centralClaim?.trim()) {
          all.push(normalizeExtractedIdea(match, candidate));
        } else {
          all.push(fallbackIdea(candidate, domain));
        }
      }
    } catch (err) {
      console.warn("[Expository] Idea extraction batch failed:", err);
      for (const candidate of batch) {
        all.push(fallbackIdea(candidate, domain));
      }
    }
  }

  return all;
}

function buildExtractionPrompt(
  title: string,
  author: string,
  domain: ExpositoryDomain,
  batch: SectionCandidate[]
): string {
  const sectionsBlock = batch
    .map((c) => {
      const text = truncateWords(c.section.rawText || "", 900);
      return `SECTION_ID: ${c.section.id}
CHAPTER: "${c.chapter.title}"
HEADING: "${c.sectionTitle}"
TEXT:
${text}`;
    })
    .join("\n\n---\n\n");

  return `You are building an invisible "idea map" for the expository book "${title}" by ${author}.
Domain: ${domain}.

For each section below:
1. Decide if it teaches a visualizable idea (skip front-matter fluff, transitions, anecdotes without a model).
2. Extract the central claim being explained.
3. List 2-5 key terms.
4. Choose the best visualType: definition|contrast|mechanism|flowchart|anatomy_diagram|concept_map|timeline|case_study|synthesis|infographic
5. Write focusedExcerpt: 250-500 words of CLEANED prose containing ONLY the passages needed to explain the idea.
   Remove unrelated anecdotes, citations clutter, and repetition. Keep definitions, mechanisms, contrasts, and evidence.
   Do not invent facts.

Return STRICT JSON:
{
  "sections": [
    {
      "sectionId": "",
      "skip": false,
      "importance": 0.0,
      "centralClaim": "",
      "keyTerms": [],
      "visualType": "infographic",
      "focusedExcerpt": ""
    }
  ]
}

SECTIONS:
${sectionsBlock}`;
}

function normalizeExtractedIdea(raw: ExtractedIdea, candidate: SectionCandidate): ExtractedIdea {
  const visualType = VALID_VISUAL_TYPES.includes(raw.visualType) ? raw.visualType : "infographic";
  return {
    sectionId: candidate.section.id,
    skip: Boolean(raw.skip),
    importance: clamp01(raw.importance ?? 0.55),
    centralClaim: raw.centralClaim?.trim() || candidate.sectionTitle,
    keyTerms: (raw.keyTerms ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 6),
    visualType,
    focusedExcerpt: (raw.focusedExcerpt || candidate.section.rawText || "").trim(),
  };
}

function fallbackIdea(candidate: SectionCandidate, domain: ExpositoryDomain): ExtractedIdea {
  return {
    sectionId: candidate.section.id,
    skip: false,
    importance: 0.52,
    centralClaim: candidate.sectionTitle,
    keyTerms: [],
    visualType: domain === "neuroscience" || domain === "medical" ? "anatomy_diagram" : "infographic",
    focusedExcerpt: truncateWords(candidate.section.rawText || "", 500),
  };
}

function buildScenesFromIdeas(
  structure: BookStructure,
  ideas: ExtractedIdea[],
  candidates: SectionCandidate[],
  protocol: WorkProtocolResult,
  goldenNumber: number
): IdentifiedScene[] {
  const candidateBySection = new Map(candidates.map((c) => [c.section.id, c]));
  const sorted = [...ideas].sort((a, b) => {
    const posA = sectionPosition(candidateBySection.get(a.sectionId), structure);
    const posB = sectionPosition(candidateBySection.get(b.sectionId), structure);
    return posA - posB || b.importance - a.importance;
  });

  const scenes: IdentifiedScene[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const idea = sorted[i];
    const candidate = candidateBySection.get(idea.sectionId);
    if (!candidate) continue;

    const { chapter, section, sectionTitle } = candidate;
    const boundaries = catalogStructuralBoundaries(chapter.rawText || "");
    const anchorOffset = snapToBoundary(section.startWordOffset ?? 0, boundaries, chapter.wordCount, 200);

    const beat: ExpositoryBeat = {
      sectionTitle,
      centralClaim: idea.centralClaim,
      keyTerms: idea.keyTerms,
      visualType: idea.visualType,
      domain: protocol.domain,
      domainStyleHint: domainStyleHint(protocol.domain, idea.keyTerms),
      focusedExcerpt: idea.focusedExcerpt,
      importance: idea.importance,
    };

    const isDefault = i < goldenNumber;

    scenes.push({
      id: `scene_expository_${structure.bookId}_${section.id}`,
      inflectionPointId: isDefault ? `idea_default_${i}` : `idea_planned_${i}`,
      chapterId: chapter.id,
      sectionId: section.id,
      visualSlotKey: section.id,
      anchorCfi: "",
      anchor: {
        href: chapter.href,
        fragment: chapter.fragment,
        spineIndex: chapter.spineIndex,
        wordOffset: anchorOffset,
      },
      emotionalVector: idea.keyTerms.slice(0, 2),
      symbolicMotifs: [idea.centralClaim, ...idea.keyTerms].slice(0, 4),
      atmosphericQualities: [beat.visualType, protocol.domain],
      narrativeWeight: idea.importance,
      expositoryBeat: beat,
    });
  }

  return scenes;
}

function sectionPosition(candidate: SectionCandidate | undefined, structure: BookStructure): number {
  if (!candidate) return 0;
  const chapter = candidate.chapter;
  const before = structure.chapters.slice(0, chapter.index).reduce((sum, ch) => sum + ch.wordCount, 0);
  return before + (candidate.section.startWordOffset ?? 0);
}

async function generateExpositoryDescriptions(
  scenes: IdentifiedScene[],
  bookTitle: string,
  protocol: WorkProtocolResult,
  apiKey: string,
  report: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  const result: IdentifiedScene[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const beat = scene.expositoryBeat;
    report({
      phase: "prompts",
      message: `Writing diagram brief ${i + 1} of ${scenes.length}…`,
      percent: 72 + Math.round(((i + 1) / Math.max(1, scenes.length)) * 14),
      current: i + 1,
      total: scenes.length,
      itemLabel: beat?.sectionTitle ?? scene.sectionId,
    });

    try {
      const description = await generateSingleExpositoryDescription(scene, bookTitle, protocol, apiKey);
      result.push({ ...scene, imageDescription: description });
    } catch {
      result.push({ ...scene, imageDescription: buildFallbackExpositoryDescription(scene, protocol) });
    }
  }

  return result;
}

async function generateSingleExpositoryDescription(
  scene: IdentifiedScene,
  bookTitle: string,
  protocol: WorkProtocolResult,
  apiKey: string
): Promise<string> {
  const beat = scene.expositoryBeat;
  if (!beat) return buildFallbackExpositoryDescription(scene, protocol);

  const visualTypeGuide = visualTypeInstructions(beat.visualType);
  const excerpt = truncateWords(beat.focusedExcerpt, 1200);

  const prompt = `You are writing a detailed image-generation prompt for an EDUCATIONAL DIAGRAM / INFOGRAPHIC
that accompanies a reader studying "${bookTitle}".

This is NOT fantasy art, NOT symbolic painting, NOT scene illustration.
The image must TEACH the idea through visual structure.

SECTION: "${beat.sectionTitle}"
CENTRAL CLAIM: ${beat.centralClaim}
KEY TERMS: ${beat.keyTerms.join(", ") || "none listed"}
VISUAL TYPE: ${beat.visualType}
DOMAIN STYLE: ${beat.domainStyleHint || protocol.domainStyleHint}

${visualTypeGuide}

SOURCE MATERIAL (cleaned excerpt — depict THIS information visually):
${excerpt}

Write a 5-10 sentence image generation prompt that:
- Describes a clear diagram, infographic, or textbook illustration layout
- Specifies labeled regions as ABSTRACT SHAPES (no readable letters — use "label bars", "annotation callouts")
- Shows relationships: arrows, loops, comparison panels, layers, cross-sections as appropriate
- Uses domain-appropriate visual language (${protocol.domain})
- Includes specific entities from the excerpt (brain regions, organs, process steps, model names as shapes)
- Avoids: fantasy creatures, dramatic narrative scenes, watercolor symbolism, photorealistic people
- Avoids: readable text, words, letters, watermarks

Respond with ONLY the prompt text. No JSON, no quotes, no preamble.`;

  return (await llmGenerate("visual_analyst", prompt, {
    temperature: 0.55,
    maxTokens: 800,
    geminiKey: apiKey,
  })).trim();
}

function visualTypeInstructions(type: ExpositoryVisualType): string {
  switch (type) {
    case "contrast":
      return "Layout: side-by-side comparison panels showing old model vs new model, with dividing line and matching annotation callouts.";
    case "mechanism":
      return "Layout: process mechanism with numbered stages, arrows showing causation, feedback loops where relevant.";
    case "flowchart":
      return "Layout: top-to-bottom or left-to-right flowchart with decision nodes and process boxes.";
    case "anatomy_diagram":
      return "Layout: anatomical or structural diagram with cross-section, labeled regions, and pathway arrows.";
    case "concept_map":
      return "Layout: radial or hierarchical concept map with central node and branching related ideas.";
    case "timeline":
      return "Layout: horizontal timeline with era markers and milestone nodes.";
    case "definition":
      return "Layout: central concept with surrounding definition panels and exemplar icons.";
    case "case_study":
      return "Layout: abstracted case vignette as labeled diagram — phenomenon illustrated, not dramatic scene.";
    case "synthesis":
      return "Layout: integrative summary diagram connecting multiple prior concepts into one model.";
    default:
      return "Layout: clean educational infographic with clear visual hierarchy and explanatory arrows.";
  }
}

function buildFallbackExpositoryDescription(scene: IdentifiedScene, protocol: WorkProtocolResult): string {
  const beat = scene.expositoryBeat;
  if (!beat) {
    return `Educational infographic explaining ${scene.symbolicMotifs[0] || "the section's central idea"}. ${protocol.domainStyleHint}`;
  }
  return (
    `${visualTypeInstructions(beat.visualType)} ` +
    `Educational diagram for "${beat.sectionTitle}": ${beat.centralClaim}. ` +
    `Depict key elements: ${beat.keyTerms.join(", ")}. ` +
    `${beat.domainStyleHint} Clean textbook infographic style. Abstract label bars only, no readable text.`
  );
}

function calculateExpositoryGoldenNumber(totalWords: number, candidateCount: number): number {
  let cap: number;
  if (totalWords < 50000) cap = 6;
  else if (totalWords < 150000) cap = 12;
  else cap = 20;

  return Math.max(3, Math.min(cap, candidateCount));
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return {} as T;
  }
}
