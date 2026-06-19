/**
 * Study quiz generation — PLANv phases 5-7.
 *
 * Segment quizzes are short comprehension checks. Chapter quizzes pull from
 * multiple segments. Whole-book quizzes use question chains: grouped questions
 * that build from recall toward synthesis.
 */

import { llmGenerateJSON } from "@/api/llmClient";
import { buildExpositoryScopeOutline, knowledgeProtocol } from "@/pipeline/knowledgeGrounding";
import type {
  BookStructure,
  SemanticMap,
  StudyQuestionLevel,
  StudyQuiz,
  StudyQuizQuestion,
  StudySegment,
} from "@/types";
import type { StudyChapterGroup } from "@/utils/studyProgress";

interface RawQuestion {
  chainTitle?: string;
  level?: string;
  question?: string;
  options?: unknown;
  correctOptionIndex?: unknown;
  explanation?: string;
  purpose?: string;
}

function segmentText(segment: StudySegment, structure: BookStructure): string {
  const chapter = structure.chapters.find((item) => item.index === segment.chapterIndex);
  if (!chapter?.rawText) return "";
  const words = chapter.rawText.split(/\s+/).filter(Boolean);
  return words.slice(segment.startWordOffset, segment.endWordOffset).join(" ");
}

function normaliseLevel(value: unknown): StudyQuestionLevel {
  const text = String(value ?? "").toLowerCase();
  if (text === "relationship") return "relationship";
  if (text === "interpretation") return "interpretation";
  if (text === "synthesis") return "synthesis";
  return "recall";
}

function cleanOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 4);
}

function normaliseQuestions(raw: unknown): StudyQuizQuestion[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map<StudyQuizQuestion | null>((item, index) => {
      const q = item as RawQuestion;
      const options = cleanOptions(q.options);
      const correct = Number(q.correctOptionIndex);
      if (!q.question || options.length !== 4 || !Number.isInteger(correct) || correct < 0 || correct > 3) {
        return null;
      }
      return {
        id: `q-${index + 1}`,
        questionNumber: index + 1,
        chainTitle: q.chainTitle?.trim() || undefined,
        level: normaliseLevel(q.level),
        question: q.question.trim(),
        options,
        correctOptionIndex: correct,
        explanation: q.explanation?.trim() || "This answer best matches the material.",
        purpose: q.purpose?.trim() || undefined,
      };
    })
    .filter((item): item is StudyQuizQuestion => item !== null);
}

async function requestQuestions(
  prompt: string,
  apiKey: string,
  minQuestions: number,
  maxQuestions: number
): Promise<StudyQuizQuestion[]> {
  const parsed = await llmGenerateJSON<{ questions?: unknown[] }>("quiz", prompt, {
    temperature: 0.35,
    maxTokens: 3072,
    geminiKey: apiKey,
  });
  const questions = normaliseQuestions(parsed.questions).slice(0, maxQuestions);
  if (questions.length < minQuestions) throw new Error("AI returned too few usable quiz questions.");
  return questions.map((question, index) => ({ ...question, questionNumber: index + 1, id: `q-${index + 1}` }));
}

function titleForChapterGroup(group: StudyChapterGroup): string {
  return group.chapterTitle || `Chapter ${group.chapterIndex + 1}`;
}

function chapterText(group: StudyChapterGroup, structure: BookStructure): string {
  return group.segments
    .map((segment) => segmentText(segment, structure))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function quizProtocol(map?: SemanticMap | null): "narrative" | "expository" {
  return knowledgeProtocol(map ?? null);
}

function chapterOrganizationContext(
  group: StudyChapterGroup,
  structure: BookStructure,
  semanticMap?: SemanticMap | null
): string {
  const protocol = quizProtocol(semanticMap);
  const chapter = structure.chapters.find((item) => item.index === group.chapterIndex);
  const segmentLines = group.segments
    .map((segment, index) =>
      `${index + 1}. ${segment.title}: ${segment.summary || "No summary."}` +
      `${segment.concepts?.length ? ` Concepts: ${segment.concepts.join(", ")}.` : ""}` +
      `${segment.themes?.length ? ` Themes: ${segment.themes.join(", ")}.` : ""}`
    )
    .join("\n");

  if (protocol === "expository") {
    const outline = buildExpositoryScopeOutline(
      { type: "choose", chapterIds: chapter ? [chapter.id] : [] },
      structure,
      semanticMap ?? null
    );
    return [
      "SECTION / TOPIC ORGANIZATION:",
      outline,
      "Study guide topics in this section:",
      segmentLines,
    ].filter(Boolean).join("\n");
  }

  return [
    "CHAPTER ORGANIZATION:",
    `Chapter: ${titleForChapterGroup(group)}`,
    "Study guide moments in this chapter:",
    segmentLines,
  ].join("\n");
}

function bookReviewText(segments: StudySegment[], structure: BookStructure, semanticMap?: SemanticMap | null): string {
  const protocol = quizProtocol(semanticMap);
  const organization =
    protocol === "expository"
      ? buildExpositoryScopeOutline({ type: "whole" }, structure, semanticMap ?? null)
      : "";
  return segments
    .filter((segment) => segment.quizWorthy)
    .map((segment) => {
      const excerpt = segmentText(segment, structure).slice(0, 1200);
      return `### ${segment.title}
Summary: ${segment.summary || "(none)"}
Concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}
Excerpt:
${excerpt}`;
    })
    .concat(organization ? [`## Whole-book organization\n${organization}`] : [])
    .join("\n\n");
}

export async function generateSegmentQuiz({
  segment,
  structure,
  apiKey,
  semanticMap,
}: {
  segment: StudySegment;
  structure: BookStructure;
  apiKey: string;
  semanticMap?: SemanticMap | null;
}): Promise<StudyQuiz> {
  const text = segmentText(segment, structure);
  if (text.split(/\s+/).filter(Boolean).length < 120) {
    throw new Error("This segment is too short for a meaningful quiz.");
  }

  const protocol = quizProtocol(semanticMap);
  const prompt = protocol === "expository"
    ? `You are generating a topic-level Study Guide quiz for Lumina.

Create 4 to 6 multiple-choice questions for this organized topic/section.

Rules:
- Follow the book's own organization. Test the topic as the author teaches it, not as isolated trivia.
- Cover definitions, key distinctions, mechanism/process, examples/applications, and how this topic connects to the surrounding section.
- Ask what a learner must understand before moving to the next topic.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should teach why the answer is right and why the closest distractor is wrong.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Topic title: ${segment.title}
Topic summary: ${segment.summary || "(none)"}
Topic concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}

Source text:
"""
${text.slice(0, 9000)}
"""`
    : `You are generating a chapter-safe fiction Study Guide quiz for Lumina.

Create 4 to 6 multiple-choice questions for this chapter moment.

Rules:
- Do not ask trivia unless it matters to understanding.
- Focus on what happened, why it mattered, what changed, character motivation, consequences, and the chapter's emotional/thematic movement.
- Use recall only to support understanding. Include relationship, interpretation, and light synthesis.
- No spoilers beyond this segment.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief, useful, and anchored in this chapter material.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Segment title: ${segment.title}
Segment summary: ${segment.summary || "(none)"}
Segment concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}

Segment text:
"""
${text.slice(0, 9000)}
"""`;

  const questions = await requestQuestions(prompt, apiKey, 4, 6);
  return {
    id: `quiz-${segment.id}-${Date.now()}`,
    bookId: segment.bookId,
    scope: "segment",
    targetId: segment.id,
    title: segment.title,
    generatedAt: new Date().toISOString(),
    questionCount: questions.length,
    questions,
  };
}

export async function generateChapterQuiz({
  chapter,
  structure,
  apiKey,
  semanticMap,
}: {
  chapter: StudyChapterGroup;
  structure: BookStructure;
  apiKey: string;
  semanticMap?: SemanticMap | null;
}): Promise<StudyQuiz> {
  const text = chapterText(chapter, structure);
  if (text.split(/\s+/).filter(Boolean).length < 180) {
    throw new Error("This chapter selection is too short for a meaningful quiz.");
  }

  const title = titleForChapterGroup(chapter);
  const protocol = quizProtocol(semanticMap);
  const organization = chapterOrganizationContext(chapter, structure, semanticMap);
  const prompt = protocol === "expository"
    ? `You are generating an organized section quiz for Lumina.

Create 6 to 10 multiple-choice questions for this section/topic group.

Rules:
- Follow the book's own organization. If the author teaches concept A before concept B, the quiz should respect that learning path.
- Cover definitions, key terms, distinctions, mechanisms/processes, examples, applications, and synthesis across topics in this section.
- Test recall only when it supports comprehension; do not ask random trivia.
- Include at least one question about how two ideas in this section relate.
- Include at least one application or transfer question.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief, useful, and teaching-oriented.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Section target: ${title}

${organization}

Text:
"""
${text.slice(0, 14000)}
"""`
    : `You are generating a fiction chapter quiz for Lumina.

Create 6 to 10 multiple-choice questions for this chapter.

Rules:
- This is the main quiz unit for fiction. Stay chapter-specific and do not spoil later chapters.
- Do not ask random trivia. Test recall only when it supports comprehension.
- Cover plot movement, character choices, motivations, cause/effect, consequences, relationships, and theme.
- Include at least one question about what changed from the beginning to the end of the chapter.
- Include at least one question that connects an event to its emotional or thematic significance.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief and useful.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Chapter target: ${title}

${organization}

Text:
"""
${text.slice(0, 14000)}
"""`;

  const questions = await requestQuestions(prompt, apiKey, 5, 10);
  return {
    id: `quiz-chapter-${chapter.chapterIndex}-${Date.now()}`,
    bookId: chapter.segments[0]?.bookId ?? structure.bookId,
    scope: "chapter",
    targetId: `chapter-${chapter.chapterIndex}`,
    title,
    generatedAt: new Date().toISOString(),
    questionCount: questions.length,
    questions,
  };
}

export async function generateWholeBookQuiz({
  segments,
  structure,
  apiKey,
  semanticMap,
}: {
  segments: StudySegment[];
  structure: BookStructure;
  apiKey: string;
  semanticMap?: SemanticMap | null;
}): Promise<StudyQuiz> {
  const protocol = quizProtocol(semanticMap);
  const reviewText = bookReviewText(segments, structure, semanticMap);
  if (reviewText.split(/\s+/).filter(Boolean).length < 400) {
    throw new Error("This book needs more quiz-worthy guide material first.");
  }

  const prompt = protocol === "expository"
    ? `You are generating a whole-book expository Study Guide quiz for Lumina.

Create 10 to 14 multiple-choice questions arranged into 3 or 4 learning chains.

A learning chain is a set of 2-4 questions where each question prepares the reader for the next. Move from definition to relationship/mechanism to application to synthesis.

Rules:
- Every question must include a "chainTitle".
- Follow the book's own organization: major sections, topics, key terms, mechanisms, examples, and synthesis.
- Do not create isolated trivia questions.
- Include questions that test how central ideas connect across chapters/sections.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should teach why the answer fits the book's structure.

Return ONLY JSON:
{"questions":[{"chainTitle":string,"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Book: ${structure.title}

Study guide material:
"""
${reviewText.slice(0, 18000)}
"""`
    : `You are generating a whole-book fiction Study Guide quiz for Lumina.

Create 8 to 12 multiple-choice questions arranged into 3 question chains.

A question chain is a set of 2-4 questions where each question prepares the reader for the next. Move from recall to relationship to interpretation to synthesis.

Rules:
- Every question must include a "chainTitle".
- Do not create isolated trivia questions.
- Focus on causation, consequences, character decisions, callbacks, transformations, relationships, and themes.
- Some recall is allowed, but recall must support understanding.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief and useful.

Return ONLY JSON:
{"questions":[{"chainTitle":string,"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Book: ${structure.title}

Study guide material:
"""
${reviewText.slice(0, 18000)}
"""`;

  const questions = await requestQuestions(prompt, apiKey, protocol === "expository" ? 10 : 8, protocol === "expository" ? 14 : 12);
  return {
    id: `quiz-book-${Date.now()}`,
    bookId: structure.bookId,
    scope: "book",
    targetId: "whole-book",
    title: "Whole Book Review",
    generatedAt: new Date().toISOString(),
    questionCount: questions.length,
    questions,
  };
}
