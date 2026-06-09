/**
 * External book classification via Open Library (no API key).
 * Resolves fiction vs expository from catalog metadata — not prose samples.
 */

import type { AnalysisProtocol, ExpositoryDomain, WorkType } from "@/types";

export interface ExternalClassification {
  protocol: AnalysisProtocol;
  workType: WorkType;
  domain: ExpositoryDomain;
  confidence: number;
  source: "open-library-title" | "open-library-author";
  evidence: string[];
  matchedTitle?: string;
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  subject?: string[];
}

const FICTION_SUBJECT_RE =
  /\b(fiction|novel|short\s+stories|science\s+fiction|sci[- ]?fi|fantasy|romance|mystery|thriller|horror|detective|adventure\s+stories|drama)\b/i;

const SCHOLARLY_SUBJECT_RE =
  /\b(neuroscience|neurosciences|cognitive\s+science|psychology|philosophy|physics|biology|medicine|sociology|economics|epistemology|research|academic)\b/i;

const NONFICTION_SUBJECT_RE =
  /\b(nonfiction|non-fiction|biography|autobiography|memoir|history|science|self[- ]?help|business|politics|religion|spirituality|health|medical|education|reference|textbook|handbook|manual|guide|essay)\b/i;

const DOMAIN_FROM_SUBJECT: Array<{ domain: ExpositoryDomain; re: RegExp }> = [
  { domain: "neuroscience", re: /\b(neuroscience|neurosciences|brain|cognitive\s+science|emotions?\s+and\s+cognition)\b/i },
  { domain: "medical", re: /\b(medicine|medical|clinical|anatomy|physiology|patient)\b/i },
  { domain: "biology", re: /\b(biology|evolution|genetics|ecology|cell)\b/i },
  { domain: "psychology", re: /\b(psychology|behavior|mental\s+health|therapy|emotion)\b/i },
  { domain: "physics", re: /\b(physics|quantum|relativity|thermodynamic)\b/i },
  { domain: "economics", re: /\b(economics|finance|business|market)\b/i },
  { domain: "history", re: /\b(history|historical|ancient|century|war)\b/i },
  { domain: "technology", re: /\b(computer|software|engineering|technology|programming)\b/i },
];

const lookupCache = new Map<string, ExternalClassification | null>();

function cacheKey(title: string, author: string): string {
  return `${normalize(title)}|${normalize(author)}`;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOverlap(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

function classifySubjects(subjects: string[]): Omit<ExternalClassification, "source" | "matchedTitle" | "evidence"> & {
  evidence: string[];
} {
  const joined = subjects.join(" | ");
  const evidence = subjects.slice(0, 8);

  const fictionHits = subjects.filter((s) => FICTION_SUBJECT_RE.test(s)).length;
  const nonfictionHits = subjects.filter((s) => NONFICTION_SUBJECT_RE.test(s) || SCHOLARLY_SUBJECT_RE.test(s)).length;

  if (fictionHits > 0 && nonfictionHits === 0) {
    return {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      confidence: Math.min(0.95, 0.72 + fictionHits * 0.08),
      evidence,
    };
  }

  let domain: ExpositoryDomain = "general";
  for (const { domain: d, re } of DOMAIN_FROM_SUBJECT) {
    if (subjects.some((s) => re.test(s))) {
      domain = d;
      break;
    }
  }

  const scholarly = subjects.some((s) => SCHOLARLY_SUBJECT_RE.test(s));
  const workType: WorkType = scholarly ? "scholarly" : "nonfiction";
  const confidence = Math.min(
    0.98,
    0.75 + nonfictionHits * 0.04 + (scholarly ? 0.08 : 0) + (fictionHits === 0 ? 0.05 : 0)
  );

  return {
    protocol: "expository",
    workType,
    domain,
    confidence: fictionHits > 0 ? confidence * 0.6 : confidence,
    evidence: [...evidence, joined.slice(0, 120)],
  };
}

async function fetchOpenLibraryDocs(params: Record<string, string>): Promise<OpenLibraryDoc[]> {
  const qs = new URLSearchParams({ ...params, limit: "8", fields: "title,author_name,subject" });
  const response = await fetch(`https://openlibrary.org/search.json?${qs}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };
  return data.docs ?? [];
}

async function lookupByTitleAndAuthor(title: string, author: string): Promise<ExternalClassification | null> {
  const authorLine = cleanAuthor(author);
  if (!title.trim()) return null;

  const docs = await fetchOpenLibraryDocs({
    title: cleanTitle(title),
    ...(authorLine ? { author: authorLine } : {}),
  });

  if (docs.length === 0 && authorLine) {
    const fallback = await fetchOpenLibraryDocs({ title: cleanTitle(title) });
    docs.push(...fallback);
  }

  let best: { doc: OpenLibraryDoc; score: number } | null = null;
  for (const doc of docs) {
    if (!doc.subject?.length) continue;
    const score = titleOverlap(title, doc.title ?? "");
    if (!best || score > best.score) best = { doc, score };
  }

  if (!best || best.score < 0.45) return null;

  const classified = classifySubjects(best.doc.subject ?? []);
  if (classified.confidence < 0.65) return null;

  return {
    ...classified,
    source: "open-library-title",
    matchedTitle: best.doc.title,
    evidence: classified.evidence,
  };
}

async function lookupByAuthorProfile(author: string): Promise<ExternalClassification | null> {
  const authorLine = cleanAuthor(author);
  if (!authorLine || authorLine.length < 4) return null;

  const docs = await fetchOpenLibraryDocs({ author: authorLine });
  if (docs.length < 2) return null;

  const allSubjects: string[] = [];
  for (const doc of docs) {
    if (doc.subject?.length) allSubjects.push(...doc.subject);
  }
  if (allSubjects.length === 0) return null;

  const classified = classifySubjects([...new Set(allSubjects)]);
  if (classified.protocol !== "expository" || classified.confidence < 0.7) return null;

  return {
    ...classified,
    confidence: Math.min(0.88, classified.confidence - 0.05),
    source: "open-library-author",
    evidence: [`Author catalog profile (${docs.length} works)`, ...classified.evidence.slice(0, 4)],
  };
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[\[(].*?[\])]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAuthor(author: string): string {
  return author
    .replace(/\s+and\s+/gi, ", ")
    .split(",")[0]
    ?.replace(/[^\w\s.'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

/**
 * Look up title + author in Open Library. Falls back to author profile when title match is weak.
 */
export async function lookupExternalClassification(
  title: string,
  author: string
): Promise<ExternalClassification | null> {
  const key = cacheKey(title, author);
  if (lookupCache.has(key)) return lookupCache.get(key) ?? null;

  try {
    const byTitle = await lookupByTitleAndAuthor(title, author);
    if (byTitle && byTitle.confidence >= 0.72) {
      lookupCache.set(key, byTitle);
      return byTitle;
    }

    const byAuthor = await lookupByAuthorProfile(author);
    if (byAuthor) {
      lookupCache.set(key, byAuthor);
      return byAuthor;
    }

    if (byTitle) {
      lookupCache.set(key, byTitle);
      return byTitle;
    }

    lookupCache.set(key, null);
    return null;
  } catch (err) {
    console.warn("[BookLookup] Open Library classification failed:", err);
    lookupCache.set(key, null);
    return null;
  }
}
