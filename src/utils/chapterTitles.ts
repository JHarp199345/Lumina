export interface DisplayChapterTitle {
  eyebrow: string;
  title: string;
}

export function formatChapterTitle(rawTitle: string, fallbackIndex = 0): DisplayChapterTitle {
  const normalized = rawTitle.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      eyebrow: `Chapter ${fallbackIndex + 1}`,
      title: `Chapter ${fallbackIndex + 1}`,
    };
  }

  const parts = normalized
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  const lastPart = parts[parts.length - 1] || normalized;
  const cleanedTitle = cleanTitleFragment(lastPart) || `Chapter ${fallbackIndex + 1}`;
  const bookContext = parts.length > 1 ? cleanBookContext(parts[0]) : "";
  const fallbackChapter = `Chapter ${fallbackIndex + 1}`;

  return {
    eyebrow: bookContext || (isGenericChapterLabel(cleanedTitle) ? "" : fallbackChapter),
    title: cleanedTitle,
  };
}

function cleanTitleFragment(title: string): string {
  return title
    .replace(/^\[[^\]]+\]\s*[•\-:]\s*/u, "")
    .replace(/\s+by\s+[^/]+$/iu, "")
    .replace(/^chapter\s+chapter\s+/iu, "Chapter ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBookContext(context: string): string {
  return context
    .replace(/^\[([^\]]+)\]\s*[•\-:]\s*/u, "$1 ")
    .replace(/\s+by\s+[^/]+$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericChapterLabel(title: string): boolean {
  return /^chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\.?$/iu.test(
    title.trim()
  );
}
