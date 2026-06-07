/**
 * Study quiz generation — PLANv Phase 5.
 *
 * V1 supports Segment Quizzes only. Chapter and whole-book quizzes use the
 * selector shell from Phase 4 but wait for later phases because they need
 * different prompt structure and question-chain planning.
 */

import { LUMINA_CONFIG } from "@/config";
import type {
  BookStructure,
  StudyQuiz,
  StudyQuizQuestion,
  StudySegment,
  StudyQuestionLevel,
} from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface RawQuestion {
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
      const question: StudyQuizQuestion = {
        id: `q-${index + 1}`,
        questionNumber: index + 1,
        level: normaliseLevel(q.level),
        question: q.question.trim(),
        options,
        correctOptionIndex: correct,
        explanation: q.explanation?.trim() || "This answer best matches the segment.",
        purpose: q.purpose?.trim() || undefined,
      };
      return question;
    })
    .filter((item): item is StudyQuizQuestion => item !== null)
    .slice(0, 5);
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
{
  "questions": [
    {
      "level": "recall" | "relationship" | "interpretation" | "synthesis",
      "question": string,
      "options": string[4],
      "correctOptionIndex": number,
      "explanation": string,
      "purpose": string
    }
  ]
}

Segment title: ${segment.title}
Segment summary: ${segment.summary || "(none)"}
Segment concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}

Segment text:
"""
${text.slice(0, 9000)}
"""`;

  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini error ${response.status}`);

  const data = await response.json();
  const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(rawText.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim());
  const questions = normaliseQuestions(parsed.questions);
  if (questions.length < 3) throw new Error("AI returned too few usable quiz questions.");

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
