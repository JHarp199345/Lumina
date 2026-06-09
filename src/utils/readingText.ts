/**
 * Paragraph-preserving text utilities for the structured reader.
 */

/** Restore paragraph breaks when stored chapter text was flattened to one block. */
export function ensureReadingParagraphs(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("\n\n")) return trimmed;

  if (/\n/.test(trimmed)) {
    const blocks = trimmed
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (blocks.length > 1) return blocks.join("\n\n");
  }

  const sentences =
    trimmed.match(/[^.!?…]+[.!?…]+(?:\s+|$)|\S+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length <= 2) return trimmed;

  const paragraphs: string[] = [];
  let batch: string[] = [];
  for (const sentence of sentences) {
    batch.push(sentence);
    if (batch.length >= 3) {
      paragraphs.push(batch.join(" "));
      batch = [];
    }
  }
  if (batch.length > 0) paragraphs.push(batch.join(" "));
  return paragraphs.join("\n\n");
}

/**
 * Slice chapter text by word offsets while keeping \\n\\n paragraph boundaries.
 */
export function sliceTextByWordRange(text: string, startWord: number, endWord: number): string {
  const normalized = ensureReadingParagraphs(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return "";

  const selected: string[] = [];
  let wordCursor = 0;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const paraStart = wordCursor;
    const paraEnd = wordCursor + words.length;
    wordCursor = paraEnd;

    if (paraEnd <= startWord || paraStart >= endWord) continue;

    if (paraStart >= startWord && paraEnd <= endWord) {
      selected.push(paragraph);
      continue;
    }

    const relStart = Math.max(0, startWord - paraStart);
    const relEnd = Math.min(words.length, endWord - paraStart);
    const slice = words.slice(relStart, relEnd).join(" ");
    if (slice) selected.push(slice);
  }

  return selected.join("\n\n");
}
