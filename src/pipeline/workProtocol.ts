/**
 * Automatic work-protocol routing — invisible to the reader.
 * Decides whether analysis runs the narrative (fiction) or expository (ideas) pipeline.
 */

import { LUMINA_CONFIG } from "@/config";
import type {
  AnalysisProtocol,
  BookStructure,
  ExpositoryDomain,
  WorkType,
} from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

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

export async function resolveWorkProtocol(
  structure: BookStructure,
  apiKey: string
): Promise<WorkProtocolResult> {
  const heuristic = heuristicProtocol(structure);
  if (heuristic && heuristic.protocol === "narrative") return heuristic;

  const sampleChapters = structure.chapters
    .filter((ch) => (ch.rawText || "").trim().length > 100)
    .slice(0, 8);

  const outline = sampleChapters
    .map((ch) => `"${ch.title}" (${ch.wordCount} words)`)
    .join("\n");

  const proseSample = sampleChapters
    .slice(0, 4)
    .map((ch) => `## ${ch.title}\n${(ch.rawText || "").split(/\s+/).slice(0, 180).join(" ")}`)
    .join("\n\n");

  const prompt = `Classify this book for an invisible reading-analysis pipeline.

Book: "${structure.title}" by ${structure.author}

Chapter outline:
${outline}

Prose sample:
${proseSample}

Return STRICT JSON:
{
  "workType": "fiction|nonfiction|scholarly|manual|memoir|reference|scripture|other",
  "structureKind": "narrative|subjectHierarchy",
  "domain": "neuroscience|medical|biology|psychology|physics|economics|history|technology|general",
  "confidence": 0.0
}

Rules:
- memoir with narrative scenes → workType memoir, structureKind narrative
- popular science / psychology / neuroscience → scholarly or nonfiction, subjectHierarchy
- novels and short fiction → fiction, narrative
- manuals and references → manual/reference, subjectHierarchy`;

  try {
    const raw = await callGemini(prompt, apiKey, 400);
    const parsed = parseJson(raw) as {
      workType?: WorkType;
      structureKind?: string;
      domain?: ExpositoryDomain;
    };

    const workType = parsed.workType ?? "other";
    const isMemoirNarrative = workType === "memoir" && parsed.structureKind === "narrative";
    const isExpository =
      !isMemoirNarrative &&
      (EXPOSITORY_WORK_TYPES.includes(workType) ||
        parsed.structureKind === "subjectHierarchy" ||
        workType === "scholarly");

    const domain = parsed.domain && parsed.domain in DOMAIN_KEYWORDS ? parsed.domain : inferDomainFromSignals(structure.title, proseSample);

    if (isExpository) {
      return {
        protocol: "expository",
        workType,
        domain,
        domainStyleHint: domainStyleHint(domain),
      };
    }

    return {
      protocol: "narrative",
      workType: workType === "memoir" ? "memoir" : "fiction",
      domain: "general",
      domainStyleHint: "",
    };
  } catch {
    if (heuristic) return heuristic;
    return {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      domainStyleHint: "",
    };
  }
}

async function callGemini(prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  return JSON.parse(cleaned);
}
