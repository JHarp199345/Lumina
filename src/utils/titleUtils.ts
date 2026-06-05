/**
 * titleUtils — display-layer title parsing.
 *
 * The parser stores cleaned title strings (e.g. "Book One / The Reaper").
 * These utilities break those strings into structured display parts for
 * rendering with proper hierarchy, and produce compact labels for tight spaces.
 *
 * Never used by the parser — UI only.
 */

export interface ChapterDisplay {
  /** e.g. "Book One — Born a Serf", null when chapter has no group context */
  groupLabel: string | null;
  /** e.g. "Chapter One", "The Reaper", "I" */
  title: string;
  /** e.g. "The Reaper" when the raw title was "Chapter One: The Reaper" */
  subtitle: string | null;
}

/**
 * Parses a stored chapter title string into structured display parts.
 *
 * Examples:
 *   "The Reaper"                       → { groupLabel: null,          title: "The Reaper",    subtitle: null }
 *   "Book One / The Reaper"            → { groupLabel: "Book One",    title: "The Reaper",    subtitle: null }
 *   "Book One / Chapter 1: The Reaper" → { groupLabel: "Book One",    title: "Chapter 1",     subtitle: "The Reaper" }
 *   "Chapter One — The Reaper"         → { groupLabel: null,          title: "Chapter One",   subtitle: "The Reaper" }
 *   "Part II / Act 3: Dawn"            → { groupLabel: "Part II",     title: "Act 3",         subtitle: "Dawn" }
 */
export function parseChapterDisplay(raw: string): ChapterDisplay {
  if (!raw || !raw.trim()) {
    return { groupLabel: null, title: "Untitled", subtitle: null };
  }

  let groupLabel: string | null = null;
  let remainder = raw.trim();

  // Split on the group separator injected by buildHierarchicalTitle (" / ")
  if (remainder.includes(" / ")) {
    const slashIdx = remainder.indexOf(" / ");
    const candidateGroup = remainder.slice(0, slashIdx).trim();
    groupLabel = candidateGroup || null;
    remainder = remainder.slice(slashIdx + 3).trim();
    if (groupLabel && areEquivalentTitleFragments(groupLabel, remainder)) {
      groupLabel = null;
    }
  }

  // Split title from subtitle on a colon followed by a space
  const colonMatch = remainder.match(/^(.+?):\s+(.+)$/);
  if (colonMatch) {
    return {
      groupLabel,
      title: colonMatch[1].trim(),
      subtitle: colonMatch[2].trim(),
    };
  }

  // Split title from subtitle on em-dash or en-dash surrounded by spaces
  const dashMatch = remainder.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (dashMatch) {
    return {
      groupLabel,
      title: dashMatch[1].trim(),
      subtitle: dashMatch[2].trim(),
    };
  }

  return { groupLabel, title: remainder, subtitle: null };
}

function areEquivalentTitleFragments(a: string, b: string): boolean {
  const left = normalizeComparableTitle(a);
  const right = normalizeComparableTitle(b);
  return Boolean(left && right && left === right);
}

function normalizeComparableTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(chapter|chap\.?|ch\.?)\b/g, "chapter")
    .replace(/\b(one|i)\b/g, "1")
    .replace(/\b(two|ii)\b/g, "2")
    .replace(/\b(three|iii)\b/g, "3")
    .replace(/\b(four|iv)\b/g, "4")
    .replace(/\b(five|v)\b/g, "5")
    .replace(/\b(six|vi)\b/g, "6")
    .replace(/\b(seven|vii)\b/g, "7")
    .replace(/\b(eight|viii)\b/g, "8")
    .replace(/\b(nine|ix)\b/g, "9")
    .replace(/\b(ten|x)\b/g, "10")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the shortest human-readable label for a chapter, suitable for
 * compact contexts like the rail indicator or a browser tab title.
 *
 * Priority:
 *   1. subtitle if <= 28 chars (it's the most specific part)
 *   2. title if <= 28 chars
 *   3. title truncated to 26 chars + ellipsis
 */
export function shortChapterLabel(display: ChapterDisplay): string {
  if (display.subtitle && display.subtitle.length <= 28) return display.subtitle;
  if (display.title.length <= 28) return display.title;
  return display.title.slice(0, 26) + "…";
}
