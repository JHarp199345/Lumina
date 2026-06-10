/**
 * Study quiz generation — PLANv phases 5-7.
 *
 * Segment quizzes are short comprehension checks. Chapter quizzes pull from
 * multiple segments. Whole-book quizzes use question chains: grouped questions
 * that build from recall toward synthesis.
 */

import { llmGenerateJSON } from "@/api/llmClient";
import type {
  BookStructure,
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

function bookReviewText(segments: StudySegment[], structure: BookStructure): string {
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
    .join("\n\n");
}

export async function generateSegmentQuiz({
  segment,
  structure,
  apiKey,
}: {
  segment: StudySegment;
  structure: BookStructure;
  apiKey: string;
}): Promise<StudyQuiz> {
  const text = segmentText(segment, structure);
  if (text.split(/\s+/).filter(Boolean).length < 120) {
    throw new Error("This segment is too short for a meaningful quiz.");
  }

  const prompt = `You are generating a short Study Guide quiz for Lumina.

Create 3 to 5 multiple-choice questions for this single study segment.

Rules:
- Do not ask trivia unless it matters to understanding.
- Focus on what happened, why it mattered, what changed, and what the reader should understand before moving on.
- Use a mix of recall, relationship, interpretation, and light synthesis.
- No spoilers beyond this segment.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief and useful.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Segment title: ${segment.title}
Segment summary: ${segment.summary || "(none)"}
Segment concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}

Segment text:
"""
${text.slice(0, 9000)}
"""`;

  const questions = await requestQuestions(prompt, apiKey, 3, 5);
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
}: {
  chapter: StudyChapterGroup;
  structure: BookStructure;
  apiKey: string;
}): Promise<StudyQuiz> {
  const text = chapterText(chapter, structure);
  if (text.split(/\s+/).filter(Boolean).length < 180) {
    throw new Error("This chapter selection is too short for a meaningful quiz.");
  }

  const title = titleForChapterGroup(chapter);
  const prompt = `You are generating a Study Guide chapter quiz for Lumina.

Create 5 to 10 multiple-choice questions for this chapter.

Rules:
- Do not ask random trivia.
- Test recall only when it supports comprehension.
- Include cause/effect, character motivation, consequences, and theme when appropriate.
- Each question must have exactly 4 answer options.
- correctOptionIndex must be 0, 1, 2, or 3.
- Explanations should be brief and useful.

Return ONLY JSON:
{"questions":[{"level":"recall"|"relationship"|"interpretation"|"synthesis","question":string,"options":string[4],"correctOptionIndex":number,"explanation":string,"purpose":string}]}

Chapter target: ${title}

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
}: {
  segments: StudySegment[];
  structure: BookStructure;
  apiKey: string;
}): Promise<StudyQuiz> {
  const reviewText = bookReviewText(segments, structure);
  if (reviewText.split(/\s+/).filter(Boolean).length < 400) {
    throw new Error("This book needs more quiz-worthy guide material first.");
  }

  const prompt = `You are generating a whole-book Study Guide quiz for Lumina.

Create 8 to 12 multiple-choice questions arranged into 3 question chains.

A question chain is a set of 2-4 questions where each question prepares the reader for the next. Move from recall to relationship to interpretation to synthesis.

Rules:
- Every question must include a "chainTitle".
- Do not create isolated trivia questions.
- Focus on causation, consequences, character decisions, setup/payoff, callbacks, and themes.
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

  const questions = await requestQuestions(prompt, apiKey, 8, 12);
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
