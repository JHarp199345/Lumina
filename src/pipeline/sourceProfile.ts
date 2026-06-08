/**
 * Source Intelligence Profile builder (PLANvii).
 *
 * Builds a hidden, teaching-oriented profile of a work in ONE enriched call that
 * REUSES what ingestion already extracted (arc shape, themes/threads from the
 * narrative blueprint, entities from visual lore, chapter structure) plus a small
 * sample of chapter prose. It is not a second analysis pass — it consolidates the
 * existing analysis output into a profile that powers Audio Overview prompts.
 *
 * New imports build it right after analysis (pre-warm); older books build it lazily
 * on first Audio Overview open. Cached either way.
 */

import { LUMINA_CONFIG } from "@/config";
import type {
  BookStructure,
  SemanticMap,
  SourceIntelligenceProfile,
  SourceProfileSuggestion,
  WorkType,
} from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ─── Public entry ────────────────────────────────────────────────────────────

export async function buildSourceProfile(
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<SourceIntelligenceProfile> {
  onProgress?.("Building book intelligence…");

  const grounding = gatherGrounding(structure, semanticMap);
  const raw = await geminiJson(buildPrompt(structure, grounding), apiKey);

  return normalize(raw, structure);
}

// ─── Grounding: reuse already-extracted ingestion artifacts ─────────────────────

function gatherGrounding(structure: BookStructure, map: SemanticMap | null): string {
  const lines: string[] = [];
  lines.push(`Title: ${structure.title}`);
  lines.push(`Author: ${structure.author}`);
  lines.push(`Chapters: ${structure.chapters.length}, total words: ${structure.totalWords}`);

  if (map) {
    lines.push(`Emotional arc shape: ${map.arcShape}`);
    const blueprint = map.narrativeBlueprint as
      | { centralThemes?: string[]; threads?: Array<{ label?: string }> }
      | undefined;
    const themes = blueprint?.centralThemes ?? [];
    if (themes.length) lines.push(`Central themes (from analysis): ${themes.join(", ")}`);
    const threads = (blueprint?.threads ?? []).map((t) => t.label).filter(Boolean);
    if (threads.length) lines.push(`Narrative threads: ${threads.join("; ")}`);

    const lore = map.visualLore as
      | { entries?: Array<{ name?: string; kind?: string; description?: string }> }
      | undefined;
    const entries = lore?.entries ?? [];
    if (entries.length) {
      lines.push("Known entities (from analysis):");
      for (const e of entries.slice(0, 24)) {
        lines.push(`  - ${e.name ?? "?"} (${e.kind ?? "?"}): ${(e.description ?? "").slice(0, 160)}`);
      }
    }
  }

  // Chapter titles + a small sample of prose so the model can infer subject/plot.
  lines.push("Chapter list:");
  structure.chapters.forEach((c, i) =>
    lines.push(`  ${i + 1}. ${c.title || `Chapter ${c.index + 1}`}`)
  );

  // Sample prose from a few evenly-spaced chapters (cap total words).
  const sampleChapters = pickEvenly(structure.chapters, 5);
  let budget = 2400;
  lines.push("Sample passages:");
  for (const c of sampleChapters) {
    if (budget <= 0) break;
    const words = (c.rawText || "").split(/\s+/).filter(Boolean).slice(0, 350);
    budget -= words.length;
    if (words.length) lines.push(`  [${c.title || `Ch ${c.index + 1}`}] ${words.join(" ")}`);
  }

  return lines.join("\n");
}

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(structure: BookStructure, grounding: string): string {
  return `You are building a hidden "source intelligence profile" of a book so a narrator can later
explain it well. Use the analysis grounding below. Infer carefully; do not invent specifics
you cannot support.

Return STRICT JSON with this shape:
{
  "workType": "fiction|nonfiction|scholarly|manual|memoir|reference|scripture|other",
  "identity": { "genre": "", "era": "" },
  "structureKind": "narrative|subjectHierarchy",
  "sections": [ { "title": "", "importance": 0.0, "teachingSummary": "what it's about + key developments" } ],
  "concepts": { "mainIdeas": [], "themes": [], "keyTerms": [], "questions": [] },
  "entities": [ { "name": "", "type": "character|person|org|place|concept", "role": "", "relationships": [ { "to": "", "nature": "", "evolution": "how it changes" } ] } ],
  "progression": [ "ordered plot movements OR argument/evidence steps" ],
  "suggestionBank": [
    { "id": "story|themes|relationships|chapter|first-time|lecture|by-subject|key-arguments|methods",
      "label": "short chip label",
      "workTypes": ["fiction"],
      "planText": "a 1-3 sentence overview instruction a reader could accept as-is, written about THIS book's actual content (name real entities/ideas), e.g. 'Explain how X and Y...'" }
  ]
}

Rules:
- planText must reference this book's real content (entities, ideas), never generic phrasing
  and never chapter opening lines.
- For fiction use narrative angles (as a story / themes / relationships / chapter-by-chapter /
  for a first-time reader / like a lecture). For nonfiction/scholarly use by-subject /
  key-arguments / methods & evidence plus first-time and lecture.
- Keep sections aligned to the chapter list; importance is 0..1.
- Output ONLY the JSON object.

ANALYSIS GROUNDING:
${grounding}`;
}

// ─── Normalize model output into a stored profile ───────────────────────────────

interface RawProfile {
  workType?: string;
  identity?: { genre?: string; era?: string };
  structureKind?: string;
  sections?: Array<{ title?: string; importance?: number; teachingSummary?: string }>;
  concepts?: { mainIdeas?: string[]; themes?: string[]; keyTerms?: string[]; questions?: string[] };
  entities?: Array<{
    name?: string;
    type?: string;
    role?: string;
    relationships?: Array<{ to?: string; nature?: string; evolution?: string }>;
  }>;
  progression?: string[];
  suggestionBank?: Array<{ id?: string; label?: string; workTypes?: string[]; planText?: string }>;
}

const VALID_WORK_TYPES: WorkType[] = [
  "fiction", "nonfiction", "scholarly", "manual", "memoir", "reference", "scripture", "other",
];

function normalize(raw: RawProfile, structure: BookStructure): SourceIntelligenceProfile {
  const workType: WorkType = VALID_WORK_TYPES.includes(raw.workType as WorkType)
    ? (raw.workType as WorkType)
    : "other";

  const sections = (raw.sections ?? []).map((s, i) => ({
    id: `sec_${i}`,
    title: s.title?.trim() || structure.chapters[i]?.title || `Section ${i + 1}`,
    importance: clamp01(s.importance ?? 0.5),
    teachingSummary: s.teachingSummary?.trim() || "",
  }));

  const entities = (raw.entities ?? []).slice(0, 40).map((e) => ({
    name: e.name?.trim() || "?",
    type: (["character", "person", "org", "place", "concept"].includes(e.type ?? "")
      ? e.type
      : "concept") as "character" | "person" | "org" | "place" | "concept",
    role: e.role?.trim() || "",
    relationships: (e.relationships ?? []).slice(0, 8).map((r) => ({
      to: r.to?.trim() || "",
      nature: r.nature?.trim() || "",
      evolution: r.evolution?.trim() || "",
    })),
  }));

  const suggestionBank: SourceProfileSuggestion[] = (raw.suggestionBank ?? [])
    .filter((s) => s.planText?.trim())
    .map((s, i) => ({
      id: s.id?.trim() || `angle_${i}`,
      label: s.label?.trim() || s.id?.trim() || `Angle ${i + 1}`,
      workTypes: (s.workTypes ?? []).filter((w) => VALID_WORK_TYPES.includes(w as WorkType)) as WorkType[],
      planText: s.planText!.trim(),
    }));

  return {
    bookId: structure.bookId,
    builtAt: new Date().toISOString(),
    workType,
    identity: {
      title: structure.title,
      author: structure.author,
      genre: raw.identity?.genre?.trim() || undefined,
      era: raw.identity?.era?.trim() || undefined,
    },
    structureKind: raw.structureKind === "subjectHierarchy" ? "subjectHierarchy" : "narrative",
    sections,
    concepts: {
      mainIdeas: clean(raw.concepts?.mainIdeas),
      themes: clean(raw.concepts?.themes),
      keyTerms: clean(raw.concepts?.keyTerms),
      questions: clean(raw.concepts?.questions),
    },
    entities,
    progression: clean(raw.progression),
    suggestionBank: suggestionBank.length > 0 ? suggestionBank : fallbackSuggestions(structure, workType),
  };
}

function fallbackSuggestions(structure: BookStructure, workType: WorkType): SourceProfileSuggestion[] {
  // If the model omitted the bank, provide minimal, still-grounded angles.
  const isScholarly = workType === "nonfiction" || workType === "scholarly" || workType === "reference";
  if (isScholarly) {
    return [
      { id: "by-subject", label: "By subject", workTypes: [workType], planText: `Explain "${structure.title}" by its major subjects and the hierarchy of ideas, with key terms and evidence.` },
      { id: "key-arguments", label: "Key arguments", workTypes: [workType], planText: `Explain the central thesis and main arguments of "${structure.title}", with supporting evidence and implications.` },
      { id: "first-time", label: "For a first-time reader", workTypes: [workType], planText: `Introduce "${structure.title}" for a first-time reader: what it is about, why it matters, and what to expect.` },
    ];
  }
  return [
    { id: "story", label: "As a story", workTypes: [workType], planText: `Explain the main story of "${structure.title}": the arc, the major characters and conflicts, and the turning points.` },
    { id: "themes", label: "Major themes", workTypes: [workType], planText: `Explain the major themes of "${structure.title}" and how they develop across the work.` },
    { id: "first-time", label: "For a first-time reader", workTypes: [workType], planText: `Introduce "${structure.title}" for a first-time reader: what it is about and what to expect.` },
  ];
}

// ─── Grounding text for the summarizer (used by audioOverview) ───────────────────

export function profileGroundingText(profile: SourceIntelligenceProfile): string {
  const lines: string[] = [];
  lines.push(`Work: "${profile.identity.title}" by ${profile.identity.author} (${profile.workType}).`);
  if (profile.concepts.mainIdeas.length) lines.push(`Main ideas: ${profile.concepts.mainIdeas.join("; ")}.`);
  if (profile.concepts.themes.length) lines.push(`Themes: ${profile.concepts.themes.join(", ")}.`);
  if (profile.concepts.keyTerms.length) lines.push(`Key terms: ${profile.concepts.keyTerms.join(", ")}.`);

  if (profile.entities.length) {
    lines.push("People / entities and how relationships evolve:");
    for (const e of profile.entities.slice(0, 16)) {
      const rels = e.relationships
        .filter((r) => r.to)
        .map((r) => `${r.to} — ${r.nature}${r.evolution ? ` (evolves: ${r.evolution})` : ""}`)
        .join("; ");
      lines.push(`  - ${e.name} (${e.type}${e.role ? `, ${e.role}` : ""})${rels ? `: ${rels}` : ""}`);
    }
  }

  if (profile.progression.length) {
    lines.push(profile.structureKind === "narrative" ? "Plot progression:" : "Argument progression:");
    profile.progression.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }

  if (profile.sections.length) {
    lines.push("Section summaries:");
    for (const s of profile.sections) {
      if (s.teachingSummary) lines.push(`  - ${s.title}: ${s.teachingSummary}`);
    }
  }

  return lines.join("\n");
}

// ─── Type-aware default prompt spine ────────────────────────────────────────────

export function defaultSpineForType(workType: WorkType, minutes: number, targetWords: number): string {
  const scholarly = workType === "nonfiction" || workType === "scholarly" || workType === "reference" || workType === "manual";
  if (scholarly) {
    return `You are a subject-matter expert and an excellent teacher. In about ${minutes} minutes (~${targetWords} spoken words), give a structured explanation of this work. Explain the central thesis, the major concepts, the subject hierarchy, the supporting arguments, key terminology, important examples and evidence, and the implications. Organize the overview by topic and subject hierarchy — not by summarizing chapter openings.`;
  }
  return `You are a subject-matter expert and an excellent teacher. In about ${minutes} minutes (~${targetWords} spoken words), explain this book clearly and engagingly. Explain the main story arc, the major characters and factions, the central conflicts, the important turning points, and the major themes — and how the relationships and ideas develop across the work. Organize the overview by the book's natural parts or acts. Do not read passages aloud; explain what happens, why it matters, and how it develops.`;
}

// ─── Gemini JSON helper ─────────────────────────────────────────────────────────

async function geminiJson(prompt: string, apiKey: string): Promise<RawProfile> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        topP: 0.9,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "{}";
  return parseJson(text);
}

function parseJson(raw: string): RawProfile {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as RawProfile;
  } catch {
    // Try to extract the first {...} block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as RawProfile; } catch { /* fall through */ }
    }
    console.warn("[sourceProfile] Could not parse model JSON");
    return {};
  }
}

// ─── small utils ────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));
}
function clean(arr: string[] | undefined): string[] {
  return (arr ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
}
