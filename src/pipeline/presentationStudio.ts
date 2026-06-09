/**
 * Presentation Studio pipeline
 *
 *   chosen material (scope)
 *     + reader prompt (ghost-text angles from SIP)
 *     + template project brief (deck structure instructions)
 *     + actual book text / profile grounding
 *     → Gemini structured JSON slide deck
 *
 * Runs on the Google AI Studio key — same pool as Audio Overview.
 */

import { LUMINA_CONFIG } from "@/config";
import {
  profileGroundingText,
  defaultSpineForType,
  fallbackSuggestions,
  isUsableSourceProfile,
} from "@/pipeline/sourceProfile";
import type { OverviewScope } from "@/pipeline/audioOverview";
import { scopeLabel } from "@/pipeline/audioOverview";
import type {
  BookStructure,
  Chapter,
  PresentationDeck,
  PresentationSlide,
  PresentationTemplate,
  PresentationTemplateId,
  SemanticMap,
  SourceIntelligenceProfile,
  SourceProfileSuggestion,
  WorkType,
} from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export { scopeLabel };
export type { OverviewScope };

// ─── Templates (project briefs) ───────────────────────────────────────────────

export const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  {
    id: "teach",
    label: "Teaching deck",
    description: "Structured for a study session or classroom walkthrough",
    brief: `PROJECT BRIEF — Teaching presentation:
- Slide 1: title + subtitle framing what this material is
- Slide 2: learning objectives — what the audience will understand by the end
- Body: one section slide per major topic, then content slides (max 5 bullets each)
- Use quote slides only for pivotal passages worth showing verbatim
- Final slide: key takeaways the audience should recall
- Every slide needs speaker notes: what to say, transitions, emphasis
- Tone: clear teacher explaining to intelligent beginners; one idea per slide`,
  },
  {
    id: "pitch",
    label: "Quick pitch",
    description: "Short intro deck — hook, stakes, throughline",
    brief: `PROJECT BRIEF — Pitch presentation:
- Open with a hook: why this book/material matters now
- 3–5 content slides maximum on premise, central conflict or thesis, and payoff
- Name real characters, ideas, or evidence — no generic filler
- Close with a single memorable takeaway
- Speaker notes: conversational, confident, presenter-ready
- Minimal bullets; strong slide titles carry the narrative`,
  },
  {
    id: "chapter-walkthrough",
    label: "Chapter walkthrough",
    description: "Follows the book's parts in reading order",
    brief: `PROJECT BRIEF — Chapter walkthrough:
- Title slide for the scoped material
- One section slide per chapter or major part in order
- Under each section: 1–2 content slides summarizing what happens and why it matters
- Track turning points and relationship shifts across the sequence
- Summary slide: how the scoped material fits the larger work
- Speaker notes on every slide for a presenter walking an audience through the text`,
  },
  {
    id: "themes-deep",
    label: "Thematic analysis",
    description: "Organized by themes, not plot chronology",
    brief: `PROJECT BRIEF — Thematic analysis deck:
- Title slide + framing: which themes this deck explores
- One section slide per major theme
- Content slides show how each theme emerges, develops, and resolves — with specific examples
- Connect themes to characters, arguments, or evidence from the material
- Synthesis slide: how the themes interact
- Closing: what understanding the themes unlocks for a reader
- Speaker notes: analytical but accessible; cite real content from the material`,
  },
];

export function getPresentationTemplate(id: PresentationTemplateId): PresentationTemplate {
  return PRESENTATION_TEMPLATES.find((t) => t.id === id) ?? PRESENTATION_TEMPLATES[0];
}

// ─── Presentation-specific suggestion angles ────────────────────────────────────

function toPresentationPlan(planText: string): string {
  const trimmed = planText.trim();
  if (/^build a (slide|presentation)/i.test(trimmed)) return trimmed;
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `Build a slide deck presentation that ${lower} Structure the deck with a title slide, logical sections, content slides with concise bullets (max 5 per slide), and a closing takeaways slide. Include speaker notes on every slide explaining what the presenter should say and how to transition.`;
}

export function presentationSuggestions(
  structure: BookStructure,
  profile: SourceIntelligenceProfile | null
): SourceProfileSuggestion[] {
  const workType: WorkType = profile?.workType ?? "fiction";
  const base =
    profile?.suggestionBank?.length && isUsableSourceProfile(profile)
      ? profile.suggestionBank
      : fallbackSuggestions(structure, workType);

  return base.map((s) => ({
    ...s,
    id: `pres_${s.id}`,
    planText: toPresentationPlan(s.planText),
  }));
}

// ─── Scope + source material (mirrors Audio Overview) ───────────────────────────

function chaptersForScope(scope: OverviewScope, structure: BookStructure): Chapter[] {
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

function buildScopeOutline(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);
  const lines: string[] = [];

  if (scope.type === "whole" && semanticMap) {
    lines.push(`"${structure.title}" by ${structure.author}`);
    lines.push(`Arc: ${semanticMap.arcShape}`);
    const blueprint = semanticMap.narrativeBlueprint as { centralThemes?: string[] } | undefined;
    const themes = blueprint?.centralThemes ?? [];
    if (themes.length) lines.push(`Themes: ${themes.join(", ")}`);
    lines.push("Chapters:");
    chapters.forEach((c, i) => lines.push(`  ${i + 1}. ${c.title || `Chapter ${c.index + 1}`}`));
  } else {
    for (const c of chapters) {
      lines.push(`${c.title || `Chapter ${c.index + 1}`}:`);
      const words = (c.rawText || "").split(/\s+/).filter(Boolean).slice(0, 400).join(" ");
      if (words) lines.push(words);
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

function buildSourceContext(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null
): string {
  const chapters = chaptersForScope(scope, structure);
  if (scope.type === "whole") {
    return buildScopeOutline(scope, structure, semanticMap);
  }

  const MAX_WORDS = 6000;
  let budget = MAX_WORDS;
  const parts: string[] = [];
  for (const c of chapters) {
    const words = (c.rawText || "").split(/\s+/).filter(Boolean);
    const take = words.slice(0, Math.max(0, budget)).join(" ");
    budget -= words.length;
    parts.push(`## ${c.title || `Chapter ${c.index + 1}`}\n${take}`);
    if (budget <= 0) break;
  }
  return parts.join("\n\n");
}

function buildMaterialContext(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  profile: SourceIntelligenceProfile | null | undefined
): string {
  if (profile) {
    let context = profileGroundingText(profile);
    if (scope.type !== "whole") {
      const prose = buildSourceContext(scope, structure, semanticMap);
      if (prose) context += `\n\nRelevant passages:\n${prose}`;
    }
    return context;
  }
  return buildSourceContext(scope, structure, semanticMap);
}

// ─── Prompt expansion ───────────────────────────────────────────────────────────

export async function suggestPresentationPrompt(
  scope: OverviewScope,
  structure: BookStructure,
  semanticMap: SemanticMap | null,
  apiKey: string,
  options: {
    angleLabel?: string;
    seedPlan?: string;
    profile?: SourceIntelligenceProfile | null;
  } = {}
): Promise<string> {
  const { angleLabel, seedPlan, profile } = options;
  const context = buildMaterialContext(scope, structure, semanticMap, profile);

  const angleLine = angleLabel ? `Angle: "${angleLabel}".` : "";
  const seedLine = seedPlan?.trim()
    ? `Build on this starting instruction (expand and sharpen it, do not shorten it):\n${seedPlan.trim()}`
    : "Write a fresh, book-specific presentation instruction from the material below.";

  const prompt = `You are helping a reader shape what a PowerPoint-style slide deck should explain.
${angleLine}
${seedLine}

Write ONE continuous instruction paragraph (4–8 sentences) that a deck generator could follow directly.
It must be purposeful and specific to THIS material: name real entities, conflicts, ideas, and
developments; state what slides should cover, in what order, and what the audience should
understand by the end. No bullet points, no preamble, no headings — only the instruction text.

MATERIAL:
${truncateWords(context, 5000)}`;

  return (await geminiText(prompt, apiKey, 1400)).trim();
}

// ─── Deck generation ────────────────────────────────────────────────────────────

export interface PresentationArgs {
  scope: OverviewScope;
  structure: BookStructure;
  semanticMap: SemanticMap | null;
  userPrompt: string;
  slideCount: number;
  templateId: PresentationTemplateId;
  apiKey: string;
  profile?: SourceIntelligenceProfile | null;
  onProgress?: (msg: string) => void;
}

interface RawDeck {
  title?: string;
  slides?: Array<{
    layout?: string;
    title?: string;
    bullets?: string[];
    speakerNotes?: string;
    visualHint?: string;
  }>;
}

const VALID_LAYOUTS = new Set(["title", "section", "content", "quote", "summary"]);

export async function generatePresentationDeck(args: PresentationArgs): Promise<PresentationDeck> {
  const {
    scope,
    structure,
    semanticMap,
    userPrompt,
    slideCount,
    templateId,
    apiKey,
    profile,
    onProgress,
  } = args;

  onProgress?.("Building slide deck…");

  const template = getPresentationTemplate(templateId);
  const material = buildMaterialContext(scope, structure, semanticMap, profile);
  const label = scopeLabel(scope, structure);

  const defaultInstruction = profile
    ? defaultSpineForType(profile.workType, 20, 2800).replace(
        /spoken words|spoken narration|to be heard/gi,
        "slides"
      )
    : `Create a clear, structured slide deck explaining this material for a live presenter.`;

  const readerInstruction = userPrompt.trim()
    ? `READER INSTRUCTION (primary guide):\n"${userPrompt.trim()}"`
    : `READER INSTRUCTION: none — use the default teaching approach below.\n${defaultInstruction}`;

  const prompt = `${template.brief}

${readerInstruction}

TARGET DECK SIZE: approximately ${slideCount} slides (±2). Book: "${structure.title}" by ${structure.author}.
Scope: ${label}.

Return STRICT JSON only:
{
  "title": "deck title",
  "slides": [
    {
      "layout": "title|section|content|quote|summary",
      "title": "slide headline",
      "bullets": ["concise point", "..."],
      "speakerNotes": "what the presenter says on this slide",
      "visualHint": "optional visual direction for designers"
    }
  ]
}

Rules:
- Ground every slide in THIS material — real names, events, ideas, arguments.
- Max 5 bullets per content slide; section slides may have 0 bullets.
- Speaker notes on EVERY slide — presenter-ready, not empty.
- First slide layout "title"; last slide layout "summary".
- Output ONLY the JSON object.

MATERIAL:
${truncateWords(material, 7500)}`;

  const raw = await geminiJson<RawDeck>(prompt, apiKey, 8192);
  const slides = normalizeSlides(raw.slides ?? [], slideCount);
  if (slides.length === 0) throw new Error("The deck came back empty — try again.");

  const id = `pres-${Date.now()}`;
  return {
    id,
    bookId: structure.bookId,
    title: raw.title?.trim() || `${structure.title} — ${template.label}`,
    scopeLabel: label,
    templateId,
    projectBrief: template.brief,
    userPrompt: userPrompt.trim(),
    slideCount: slides.length,
    slides,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeSlides(raw: RawDeck["slides"], target: number): PresentationSlide[] {
  const slides: PresentationSlide[] = (raw ?? [])
    .filter((s) => s.title?.trim() || (s.bullets?.length ?? 0) > 0)
    .map((s, index) => ({
      index,
      layout: VALID_LAYOUTS.has(s.layout ?? "") ? (s.layout as PresentationSlide["layout"]) : "content",
      title: s.title?.trim() || `Slide ${index + 1}`,
      bullets: (s.bullets ?? []).map((b) => String(b).trim()).filter(Boolean).slice(0, 6),
      speakerNotes: s.speakerNotes?.trim() || "",
      visualHint: s.visualHint?.trim() || undefined,
    }));

  return slides.slice(0, Math.max(target + 4, 36));
}

// ─── Export helpers ─────────────────────────────────────────────────────────────

export function deckToMarkdown(deck: PresentationDeck): string {
  const lines: string[] = [`# ${deck.title}`, "", `*${deck.scopeLabel} · ${deck.slides.length} slides*`, ""];
  for (const slide of deck.slides) {
    lines.push(`## Slide ${slide.index + 1}: ${slide.title}`);
    lines.push(`*${slide.layout}*`);
    if (slide.bullets.length) {
      slide.bullets.forEach((b) => lines.push(`- ${b}`));
    }
    if (slide.speakerNotes) {
      lines.push("", `**Speaker notes:** ${slide.speakerNotes}`);
    }
    if (slide.visualHint) {
      lines.push("", `*Visual:* ${slide.visualHint}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ─── Gemini helpers ─────────────────────────────────────────────────────────────

async function geminiText(prompt: string, apiKey: string, maxOutputTokens: number): Promise<string> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.65, topP: 0.9, maxOutputTokens },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text ?? "").join("") ?? "";
}

async function geminiJson<T>(prompt: string, apiKey: string, maxOutputTokens: number): Promise<T> {
  const text = await geminiText(prompt, apiKey, maxOutputTokens);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini returned no JSON deck");
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error("Could not parse slide deck JSON");
  }
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}
