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
  /\b(fiction|novel|novella|short\s+stories|fairy\s+tales?|science\s+fiction|sci[- ]?fi|fantasy|romance|mystery|thriller|horror|detective|adventure\s+stories|drama|literature|literary|comics?|graphic\s+novels?|space\s+opera|cyberpunk|dystopias?|dystopian|grim\s*dark|mythology|legends?|epic\s+poetry|hard\s+science\s+fiction|steampunk)\b/i;

/** Title shapes that strongly suggest fiction even when catalog lookup fails. */
const FICTION_TITLE_RE =
  /\b(trilogy|omnibus|saga|chronicles|cycle|book\s+one|book\s+1|a\s+novel|novels?)\b/i;

// Known fiction franchises / shared-universe markers. Library catalogs often tag
// these works WITHOUT the literal word "fiction" (e.g. only "Warhammer 40K"), so we
// recognise the franchise itself as a fiction signal.
const FICTION_FRANCHISE_RE =
  /\b(warhammer|star\s*wars|star\s*trek|middle[- ]?earth|forgotten\s+realms|dragonlance|discworld|dungeons\s*(&|and)\s*dragons|40\s*0{3}|40k)\b/i;

const SCHOLARLY_SUBJECT_RE =
  /\b(neuroscience|neurosciences|cognitive\s+science|psychology|philosophy|physics|biology|medicine|sociology|economics|epistemology|research|academic)\b/i;

// NOTE: a bare "science" was removed — it collides with "science fiction". Fiction is
// matched first (precedence) so genre tags never count as nonfiction.
const NONFICTION_SUBJECT_RE =
  /\b(nonfiction|non-fiction|biography|autobiography|memoir|history|self[- ]?help|business|politics|religion|spirituality|health|medical|education|reference|textbook|handbook|manual|guide|essays?|treatise)\b/i;

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

  // Classify each subject fiction-FIRST: a genre tag like "Science fiction" is fiction,
  // never nonfiction (the word "science" inside it must not flip the verdict).
  let fictionHits = 0;
  let nonfictionHits = 0;
  let scholarly = false;
  for (const s of subjects) {
    if (FICTION_SUBJECT_RE.test(s) || FICTION_FRANCHISE_RE.test(s)) {
      fictionHits++;
      continue;
    }
    const sch = SCHOLARLY_SUBJECT_RE.test(s);
    const non = NONFICTION_SUBJECT_RE.test(s);
    if (sch) scholarly = true;
    if (sch || non) nonfictionHits++;
  }

  // No usable signal in either direction → INCONCLUSIVE. Return zero confidence so
  // the caller discards it and the heuristic / Gemini steps decide instead. (This is
  // the key fix: absence of a fiction tag must NOT be read as proof of nonfiction.)
  if (fictionHits === 0 && nonfictionHits === 0) {
    return { protocol: "narrative", workType: "fiction", domain: "general", confidence: 0, evidence };
  }

  // Fiction wins on ties — genre fiction frequently carries an incidental nonfiction
  // tag (e.g. "war", "history") that should not outweigh clear fiction signals.
  if (fictionHits > 0 && fictionHits >= nonfictionHits) {
    return {
      protocol: "narrative",
      workType: "fiction",
      domain: "general",
      confidence: Math.min(0.95, 0.78 + fictionHits * 0.05),
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

  const workType: WorkType = scholarly ? "scholarly" : "nonfiction";
  const confidence = Math.min(
    0.98,
    0.75 + nonfictionHits * 0.04 + (scholarly ? 0.08 : 0) + (fictionHits === 0 ? 0.05 : 0)
  );

  return {
    protocol: "expository",
    workType,
    domain,
    // Some fiction signal present but outnumbered → soften confidence.
    confidence: fictionHits > 0 ? confidence * 0.75 : confidence,
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

  const variants = titleSearchVariants(title);
  let docs: OpenLibraryDoc[] = [];

  for (const variant of variants) {
    const batch = await fetchOpenLibraryDocs({
      title: variant,
      ...(authorLine ? { author: authorLine } : {}),
    });
    docs.push(...batch);
    if (batch.length > 0) break;
  }

  if (docs.length === 0) {
    for (const variant of variants) {
      const batch = await fetchOpenLibraryDocs({ title: variant });
      docs.push(...batch);
      if (batch.length > 0) break;
    }
  }

  let best: { doc: OpenLibraryDoc; score: number } | null = null;
  for (const doc of docs) {
    if (!doc.subject?.length) continue;
    const score = Math.max(
      ...variants.map((v) => titleOverlap(v, doc.title ?? "")),
      titleOverlap(title, doc.title ?? "")
    );
    if (!best || score > best.score) best = { doc, score };
  }

  if (!best || best.score < 0.4) return null;

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
  if (classified.confidence < 0.7) return null;

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

/** Strip collection/series suffixes so "Altered Carbon Trilogy" → "Altered Carbon". */
function titleSearchVariants(title: string): string[] {
  const cleaned = cleanTitle(title);
  const variants = [cleaned];
  const stripped = cleaned
    .replace(/\b(the\s+)?(complete|full|entire)\s+/gi, "")
    .replace(
      /\b(trilogy|omnibus|collection|box\s*set|series|saga|anthology|compendium|edition)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped !== cleaned && stripped.length >= 4) {
    variants.push(stripped);
  }
  return [...new Set(variants)];
}

export function titleSuggestsFiction(title: string): boolean {
  return FICTION_TITLE_RE.test(title);
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
