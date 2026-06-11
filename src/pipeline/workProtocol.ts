/**
 * Automatic work-protocol routing — invisible to the reader.
 * Decides whether analysis runs the narrative (fiction) or expository (ideas) pipeline.
 *
 * Priority: Open Library catalog lookup → local heuristics → Gemini (TOC only).
 */

import { llmGenerateJSON } from "@/api/llmClient";
import {
  lookupExternalClassification,
  titleSuggestsFiction,
} from "@/pipeline/bookClassificationLookup";
import type {
  AnalysisProtocol,
  AnalysisProgressReporter,
  BookStructure,
  ExpositoryDomain,
  WorkType,
} from "@/types";
import { diagnosticInfo } from "@/utils/diagnostics";

const EXPOSITORY_WORK_TYPES: WorkType[] = [
  "nonfiction",
  "scholarly",
  "manual",
  "reference",
  "other",
];

export interface WorkProtocolResult {
  protocol: AnalysisProtocol;
  workType: WorkType;
  domain: ExpositoryDomain;
  domainStyleHint: string;
  classificationSource?: string;
  classificationEvidence?: string[];
}

const DOMAIN_KEYWORDS: Record<ExpositoryDomain, string[]> = {
  neuroscience: ["brain", "neuron", "cortex", "neuroscience", "cognitive", "emotion", "interoception", "amygdala"],
  medical: ["patient", "clinical", "diagnosis", "disease", "treatment", "anatomy", "physiology", "hospital"],
  biology: ["cell", "organism", "evolution", "gene", "ecosystem", "species", "dna"],
  psychology: ["behavior", "mind", "therapy", "mental", "cognitive", "personality", "psychology"],
  physics: ["energy", "quantum", "force", "particle", "relativity", "thermodynamic"],
  economics: ["market", "economy", "gdp", "inflation", "trade", "capital", "supply"],
  history: ["century", "war", "empire", "revolution", "ancient", "historical"],
  technology: ["software", "algorithm", "computer", "network", "engineering", "system design"],
  general: [],
};

export function inferDomainFromSignals(title: string, sampleText: string): ExpositoryDomain {
  const blob = `${title} ${sampleText}`.toLowerCase();
  let best: ExpositoryDomain = "general";
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [ExpositoryDomain, string[]][]) {
    if (domain === "general") continue;
    const score = keywords.filter((kw) => blob.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }

  return best;
}

export function domainStyleHint(domain: ExpositoryDomain, keyTerms: string[] = []): string {
  const terms = keyTerms.slice(0, 4).join(", ");
  const termSuffix = terms ? ` Focus on: ${terms}.` : "";

  switch (domain) {
    case "neuroscience":
      return `Clean neuroscience educational diagram with labeled brain regions, neural pathways, and conceptual flow arrows.${termSuffix} Clinical textbook clarity, soft blues and warm neutrals.`;
    case "medical":
      return `Medical textbook illustration with anatomical accuracy, cross-sections, and clinical diagram conventions.${termSuffix} Precise linework, muted clinical palette.`;
    case "biology":
      return `Biology textbook diagram with cellular structures, process arrows, and organism-level schematics.${termSuffix}`;
    case "psychology":
      return `Psychology / behavioral science infographic with model diagrams, comparison panels, and process loops.${termSuffix}`;
    case "physics":
      return `Physics concept diagram with force vectors, system schematics, and spatial relationships.${termSuffix}`;
    case "economics":
      return `Economics infographic with flow charts, comparative panels, and quantitative relationships.${termSuffix}`;
    case "history":
      return `Historical concept diagram with timeline elements, comparative frames, and archival infographic tone.${termSuffix}`;
    case "technology":
      return `Technical system diagram with architecture blocks, data flows, and engineering schematic style.${termSuffix}`;
    default:
      return `Clear explanatory infographic or textbook diagram breaking down the central concept.${termSuffix} Information-dense layout, educational clarity.`;
  }
}

function heuristicProtocol(structure: BookStructure): WorkProtocolResult | null {
  const chapters = structure.chapters.filter((ch) => (ch.rawText || "").trim().length > 80);
  if (chapters.length === 0) return null;

  const sample = chapters
    .slice(0, 6)
    .map((ch) => ch.rawText || "")
    .join("\n")
    .slice(0, 12000);

  const dialogueDensity = (sample.match(/"[^"]{2,}"/g) || []).length;
  const saidCount = (sample.match(/\b(said|asked|replied|whispered|shouted)\b/gi) || []).length;
  const expositoryMarkers =
    (sample.match(/\b(therefore|however|hypothesis|evidence|study|research|model|theory|define|concept)\b/gi) || [])
      .length;

  const chapterTitles = chapters.map((ch) => ch.title).join(" | ");
  const scholarlyTitles = /introduction|conclusion|appendix|methods|chapter\s+\d|part\s+[IVX\d]/i.test(chapterTitles);

  const fictionSignals = dialogueDensity >= 8 || saidCount >= 6;
  const expositorySignals = expositoryMarkers >= 5 || scholarlyTitles;

  if (fictionSignals && !expositorySignals) {
    return {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      domainStyleHint: "",
    };
  }

  if (expositorySignals && !fictionSignals) {
    const domain = inferDomainFromSignals(structure.title, sample);
    return {
      protocol: "expository",
      workType: scholarlyTitles && expositoryMarkers >= 8 ? "scholarly" : "nonfiction",
      domain,
      domainStyleHint: domainStyleHint(domain),
    };
  }

  return null;
}

function fromExternal(
  external: NonNullable<Awaited<ReturnType<typeof lookupExternalClassification>>>
): WorkProtocolResult {
  return {
    protocol: external.protocol,
    workType: external.workType,
    domain: external.domain,
    domainStyleHint: external.protocol === "expository" ? domainStyleHint(external.domain) : "",
    classificationSource: external.source,
    classificationEvidence: external.evidence,
  };
}

export async function resolveWorkProtocol(
  structure: BookStructure,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<WorkProtocolResult> {
  onProgress?.({
    phase: "preparing",
    message: `Looking up "${structure.title}" in book catalogs…`,
    percent: 1,
    analysisProtocol: undefined,
  });

  const external = await lookupExternalClassification(structure.title, structure.author);
  if (external && external.confidence >= 0.72) {
    const result = fromExternal(external);
    diagnosticInfo("work_protocol.catalog", "Work protocol from Open Library", {
      title: structure.title,
      author: structure.author,
      protocol: result.protocol,
      workType: result.workType,
      domain: result.domain,
      confidence: external.confidence,
      source: external.source,
      matchedTitle: external.matchedTitle,
      evidence: external.evidence,
    });
    onProgress?.({
      phase: "preparing",
      message:
        result.protocol === "expository"
          ? `Catalog match: expository (${external.matchedTitle ?? structure.title})`
          : `Catalog match: narrative (${external.matchedTitle ?? structure.title})`,
      percent: 4,
      analysisProtocol: result.protocol,
    });
    return result;
  }

  const heuristic = heuristicProtocol(structure);
  if (heuristic?.protocol === "narrative") {
    if (!external || external.confidence < 0.72) {
      return { ...heuristic, classificationSource: external ? "heuristic+catalog-weak" : "heuristic" };
    }
  }
  if (titleSuggestsFiction(structure.title) && (!external || external.confidence < 0.72)) {
    const result: WorkProtocolResult = {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      domainStyleHint: "",
      classificationSource: "title-fiction-hint",
      classificationEvidence: [`Title pattern: ${structure.title}`],
    };
    diagnosticInfo("work_protocol.title_hint", "Fiction from title pattern (trilogy/saga/novel)", {
      title: structure.title,
    });
    return result;
  }

  const sampleChapters = structure.chapters
    .filter((ch) => (ch.rawText || "").trim().length > 100)
    .slice(0, 8);

  const outline = sampleChapters
    .map((ch) => `"${ch.title}" (${ch.wordCount} words)`)
    .join("\n");

  const catalogHint = external
    ? `Open Library hint (low confidence ${external.confidence.toFixed(2)}): ${external.protocol}, subjects: ${external.evidence.join("; ")}`
    : "No catalog match found.";

  const prompt = `Classify this book for an invisible reading-analysis pipeline.

Book: "${structure.title}" by ${structure.author}

External catalog: ${catalogHint}

Chapter outline (table of contents only — do NOT infer from opening anecdotes):
${outline}

Return STRICT JSON:
{
  "workType": "fiction|nonfiction|scholarly|manual|memoir|reference|scripture|other",
  "structureKind": "narrative|subjectHierarchy",
  "domain": "neuroscience|medical|biology|psychology|physics|economics|history|technology|general",
  "confidence": 0.0
}

Rules:
- Trust the external catalog hint when present — it reflects publisher/library metadata, not opening prose.
- Popular science / psychology / neuroscience (e.g. "How Emotions Are Made") → scholarly or nonfiction, subjectHierarchy, even if the introduction uses narrative anecdotes.
- memoir with narrative scenes → workType memoir, structureKind narrative
- novels and short fiction → fiction, narrative
- manuals and references → manual/reference, subjectHierarchy`;

  try {
    const parsed = await llmGenerateJSON<{
      workType?: WorkType;
      structureKind?: string;
      domain?: ExpositoryDomain;
    }>("reading", prompt, { temperature: 0.2, maxTokens: 400, geminiKey: apiKey });

    const workType = parsed.workType ?? "other";
    const isMemoirNarrative = workType === "memoir" && parsed.structureKind === "narrative";
    const isExpository =
      !isMemoirNarrative &&
      (EXPOSITORY_WORK_TYPES.includes(workType) ||
        parsed.structureKind === "subjectHierarchy" ||
        workType === "scholarly");

    const domain =
      parsed.domain && parsed.domain in DOMAIN_KEYWORDS
        ? parsed.domain
        : external?.domain ?? inferDomainFromSignals(structure.title, outline);

    if (isExpository || external?.protocol === "expository") {
      const result: WorkProtocolResult = {
        protocol: "expository",
        workType: external?.workType ?? workType,
        domain: external?.domain ?? domain,
        domainStyleHint: domainStyleHint(external?.domain ?? domain),
        classificationSource: external ? `${external.source}+gemini` : "gemini",
        classificationEvidence: external?.evidence,
      };
      diagnosticInfo("work_protocol.gemini", "Work protocol from Gemini", {
        title: structure.title,
        protocol: result.protocol,
        workType: result.workType,
        domain: result.domain,
      });
      return result;
    }

    if (external?.protocol === "narrative" && external.confidence >= 0.6) {
      return fromExternal(external);
    }

    const result: WorkProtocolResult = {
      protocol: "narrative",
      workType: workType === "memoir" ? "memoir" : "fiction",
      domain: "general",
      domainStyleHint: "",
      classificationSource: "gemini",
    };
    diagnosticInfo("work_protocol.gemini", "Work protocol from Gemini", {
      title: structure.title,
      protocol: result.protocol,
      workType: result.workType,
    });
    return result;
  } catch (err) {
    diagnosticInfo("work_protocol.llm_failed", "Classification LLM failed — using fallbacks", {
      title: structure.title,
      error: err instanceof Error ? err.message : String(err),
    });
    if (external && external.confidence >= 0.6) return fromExternal(external);
    if (heuristic) return { ...heuristic, classificationSource: "heuristic" };
    if (titleSuggestsFiction(structure.title)) {
      return {
        protocol: "narrative",
        workType: "fiction",
        domain: "general",
        domainStyleHint: "",
        classificationSource: "fallback-title-fiction",
      };
    }

    const chapterTitles = structure.chapters.map((ch) => ch.title).join(" ");
    const scholarlyToc = /introduction|appendix|methods|bibliography|index/i.test(chapterTitles);
    const numberedChaptersOnly =
      /chapter\s+\d/i.test(chapterTitles) &&
      !/introduction|appendix|methods/i.test(chapterTitles);
    if (scholarlyToc && !numberedChaptersOnly) {
      const domain = inferDomainFromSignals(structure.title, "");
      diagnosticInfo("work_protocol.fallback", "Scholarly TOC → expository", {
        title: structure.title,
      });
      return {
        protocol: "expository",
        workType: "nonfiction",
        domain,
        domainStyleHint: domainStyleHint(domain),
        classificationSource: "fallback-scholarly-toc",
      };
    }

    return {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      domainStyleHint: "",
      classificationSource: "fallback-fiction",
    };
  }
}

