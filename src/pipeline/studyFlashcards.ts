/**
 * Study flashcard generation.
 *
 * Flashcards piggyback on the Study Guide: the reader picks one or more
 * generated segments, then Lumina creates cards from those exact passages.
 */

import { LUMINA_CONFIG } from "@/config";
import type { BookStructure, StudyFlashcard, StudyFlashcardType, StudySegment } from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface RawFlashcard {
  front?: string;
  back?: string;
  type?: string;
  tags?: unknown;
}

function segmentText(segment: StudySegment, structure: BookStructure): string {
  const chapter = structure.chapters.find((item) => item.index === segment.chapterIndex);
  if (!chapter?.rawText) return "";
  const words = chapter.rawText.split(/\s+/).filter(Boolean);
  return words.slice(segment.startWordOffset, segment.endWordOffset).join(" ");
}

function selectedText(segments: StudySegment[], structure: BookStructure): string {
  return segments
    .map((segment) => {
      const text = segmentText(segment, structure).slice(0, 5000);
      return `### ${segment.title}
Chapter: ${segment.chapterTitle}
Summary: ${segment.summary || "(none)"}
Concepts: ${(segment.concepts ?? []).join(", ") || "(none)"}
Characters: ${(segment.characters ?? []).join(", ") || "(none)"}
Text:
${text}`;
    })
    .join("\n\n---\n\n")
    .slice(0, 16000);
}

function normaliseType(value: unknown): StudyFlashcardType {
  const text = String(value ?? "").toLowerCase();
  if (text === "term") return "term";
  if (text === "character") return "character";
  if (text === "event") return "event";
  if (text === "concept") return "concept";
  if (text === "cause-effect") return "cause-effect";
  return "question";
}

function normaliseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normaliseCards(raw: unknown, bookId: string, segmentIds: string[]): StudyFlashcard[] {
  const list = Array.isArray(raw) ? raw : [];
  const now = new Date().toISOString();
  return list
    .map<StudyFlashcard | null>((item, index) => {
      const card = item as RawFlashcard;
      const front = card.front?.trim();
      const back = card.back?.trim();
      if (!front || !back) return null;
      return {
        id: `flashcard-${bookId}-${Date.now()}-${index + 1}`,
        bookId,
        segmentIds,
        front,
        back,
        type: normaliseType(card.type),
        tags: normaliseTags(card.tags),
        createdAt: now,
      };
    })
    .filter((item): item is StudyFlashcard => item !== null);
}

export async function generateFlashcards({
  segments,
  structure,
  apiKey,
}: {
  segments: StudySegment[];
  structure: BookStructure;
  apiKey: string;
}): Promise<StudyFlashcard[]> {
  if (segments.length === 0) throw new Error("Choose at least one segment.");

  const material = selectedText(segments, structure);
  if (material.split(/\s+/).filter(Boolean).length < 100) {
    throw new Error("This selection is too short for useful flashcards.");
  }

  const requestedCount = Math.min(18, Math.max(6, segments.length * 5));
  const prompt = `You are generating Study Guide flashcards for Lumina.

Create ${requestedCount} useful flashcards from the selected book segments.

Rules:
- Make cards useful for remembering the book, not random trivia.
- Include a mix of terms, characters, events, concepts, cause/effect, and direct question cards when appropriate.
- Front side should be short and clear.
- Back side should be specific enough to study from.
- No spoilers beyond the selected material.
- Avoid duplicate cards.

Return ONLY JSON:
{"cards":[{"front":string,"back":string,"type":"term"|"character"|"event"|"concept"|"cause-effect"|"question","tags":string[]}]}

Book: ${structure.title}
Selected segment count: ${segments.length}

Selected material:
"""
${material}
"""`;

  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 3072,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini error ${response.status}`);

  const data = await response.json();
  const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(rawText.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim());
  const cards = normaliseCards(parsed.cards, structure.bookId, segments.map((segment) => segment.id)).slice(
    0,
    requestedCount
  );
  if (cards.length < 3) throw new Error("AI returned too few usable flashcards.");
  return cards;
}
