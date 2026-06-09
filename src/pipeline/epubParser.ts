/**
 * Adaptive EPUB Parser
 *
 * Fallback chain (never fails — always produces usable output):
 *   Level 1 — NCX/OPF manifest (HIGH confidence)
 *   Level 2 — Heading tag detection (MEDIUM confidence)
 *   Level 3 — Scene break pattern detection (MEDIUM-LOW confidence)
 *   Level 4 — Word count chunking (LOW confidence, always works)
 */

import JSZip from "jszip";
import type { BookStructure, Chapter, CollectionGroup, Section } from "@/types";
import { subdivideOversizedChapters } from "@/utils/chapterSubdivision";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpineItem {
  id: string;
  href: string;
  mediaType: string;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface NcxNavPoint {
  id: string;
  playOrder: number;
  label: string;
  src: string;
  children: NcxNavPoint[];
}

interface FlatNavPoint {
  id: string;
  label: string;
  src: string;
  playOrder: number;
  depth: number;
  parentLabels: string[];
  hasChildren: boolean;
}

interface NavChapterCandidate {
  id: string;
  title: string;
  wordCount: number;
  href: string;
  spineIndex: number;
  rawText: string;
  hasChildren: boolean;
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

export async function parseEpub(
  epubBytes: Uint8Array,
  onProgress?: (message: string) => void
): Promise<{ structure: BookStructure; rawTexts: Map<string, string>; zip: JSZip }> {
  onProgress?.("Unpacking EPUB archive…");
  const zip = await JSZip.loadAsync(epubBytes);

  // 1. Find OPF file
  onProgress?.("Reading EPUB package metadata…");
  const opfPath = await findOpfPath(zip);
  const opfContent = await zip.file(opfPath)?.async("text");
  if (!opfContent) throw new Error("Cannot read OPF file");

  const opfDoc = parseXml(opfContent);
  const opfBase = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  // 2. Extract metadata
  const title = getTextContent(opfDoc, "dc:title") || "Unknown Title";
  const author = getTextContent(opfDoc, "dc:creator") || "Unknown Author";
  const bookId = generateId(title + author);

  // 3. Build manifest
  const manifest = buildManifest(opfDoc, opfBase);
  const spine = buildSpine(opfDoc, manifest);

  // 4. Load all spine HTML content
  onProgress?.(`Loading ${spine.length} reading sections…`);
  const rawTexts = new Map<string, string>();
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const file = zip.file(item.href);
    if (file) {
      const text = await file.async("text");
      rawTexts.set(item.href, text);
    }
    if ((i + 1) % 25 === 0 || i === spine.length - 1) {
      onProgress?.(`Loading reading sections ${i + 1} of ${spine.length}…`);
      await yieldToUi();
    }
  }

  // 5. Try NCX/Nav for chapter structure
  const ncxId = getNcxId(opfDoc);
  const navId = getNavId(opfDoc);

  let chapters: Chapter[] = [];
  let confidence: BookStructure["parserConfidence"] = "low";

  // Level 1: NCX
  if (ncxId && manifest[ncxId]) {
    const ncxFile = zip.file(manifest[ncxId].href);
    if (ncxFile) {
      const ncxContent = await ncxFile.async("text");
      const navPoints = parseNcx(ncxContent);
      if (navPoints.length > 0) {
        chapters = await navPointsToChapters(navPoints, rawTexts, spine, opfBase, onProgress);
        confidence = "high";
      }
    }
  }

  // Level 1b: NAV (EPUB3)
  if (chapters.length === 0 && navId && manifest[navId]) {
    const navFile = zip.file(manifest[navId].href);
    if (navFile) {
      const navContent = await navFile.async("text");
      const navChapters = await parseNav(navContent, rawTexts, spine, opfBase, onProgress);
      if (navChapters.length > 0) {
        chapters = navChapters;
        confidence = "high";
      }
    }
  }

  // Level 2: Heading detection
  if (chapters.length === 0) {
    onProgress?.("Detecting chapters from headings…");
    chapters = detectByHeadings(rawTexts, spine);
    if (chapters.length > 0) confidence = "medium";
  }

  // Level 3: Scene break patterns
  if (chapters.length === 0) {
    onProgress?.("Detecting sections from scene breaks…");
    chapters = detectBySceneBreaks(rawTexts, spine);
    if (chapters.length > 0) confidence = "medium";
  }

  // Level 4: Word count chunking (always produces result)
  if (chapters.length === 0) {
    onProgress?.("Building reading chunks…");
    chapters = chunkByWordCount(rawTexts, spine);
    confidence = "low";
  }

  const beforeSplit = chapters.length;
  chapters = subdivideOversizedChapters(chapters);
  if (chapters.length > beforeSplit) {
    onProgress?.(`Split ${beforeSplit} reading sections into ${chapters.length} chapter-like units…`);
  }

  // Calculate totals
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  onProgress?.(`Found ${chapters.length} chapters and ${totalWords.toLocaleString()} words…`);
  const collectionGroups = deriveCollectionGroups(chapters);

  const structure: BookStructure = {
    bookId,
    title,
    author,
    totalWords,
    parserConfidence: confidence,
    chapters,
    collectionGroups: collectionGroups.length > 1 ? collectionGroups : undefined,
  };

  return { structure, rawTexts, zip };
}

// ─── OPF Utilities ────────────────────────────────────────────────────────────

async function findOpfPath(zip: JSZip): Promise<string> {
  // Check container.xml first
  const containerFile = zip.file("META-INF/container.xml");
  if (containerFile) {
    const containerText = await containerFile.async("text");
    const match = containerText.match(/full-path="([^"]+)"/);
    if (match?.[1]) return match[1];
  }

  // Fallback: find any .opf file
  const opfFile = Object.keys(zip.files).find((f) => f.endsWith(".opf"));
  if (opfFile) return opfFile;

  throw new Error("Cannot find OPF file in EPUB");
}

function buildManifest(opfDoc: Document, base: string): Record<string, ManifestItem> {
  const manifest: Record<string, ManifestItem> = {};
  const manifestEl = firstElementByTagName(opfDoc, "manifest");
  const items = manifestEl ? elementsByTagName(manifestEl, "item") : [];
  items.forEach((item) => {
    const id = item.getAttribute("id") || "";
    const href = normalizePath(base + (item.getAttribute("href") || ""));
    const mediaType = item.getAttribute("media-type") || "";
    manifest[id] = { id, href, mediaType };
  });
  return manifest;
}

function buildSpine(opfDoc: Document, manifest: Record<string, ManifestItem>): SpineItem[] {
  const spine: SpineItem[] = [];
  const spineEl = firstElementByTagName(opfDoc, "spine");
  const itemrefs = spineEl ? elementsByTagName(spineEl, "itemref") : [];
  itemrefs.forEach((ref) => {
    const idref = ref.getAttribute("idref") || "";
    if (manifest[idref]) spine.push(manifest[idref]);
  });
  return spine;
}

function getNcxId(opfDoc: Document): string | null {
  const spine = firstElementByTagName(opfDoc, "spine");
  return spine?.getAttribute("toc") || null;
}

function getNavId(opfDoc: Document): string | null {
  const manifest = firstElementByTagName(opfDoc, "manifest");
  const items = manifest ? elementsByTagName(manifest, "item") : [];
  const nav = items.find((item) => item.getAttribute("properties")?.includes("nav"));
  return nav?.getAttribute("id") || null;
}

// ─── NCX Parser ───────────────────────────────────────────────────────────────

function parseNcx(ncxContent: string): NcxNavPoint[] {
  const doc = parseXml(ncxContent);
  const navMap = firstElementByTagName(doc, "navMap");
  const navPoints = navMap ? childElementsByTagName(navMap, "navPoint") : [];
  return navPoints.map(parseNavPoint);
}

function parseNavPoint(el: Element): NcxNavPoint {
  const navLabel = firstElementByTagName(el, "navLabel");
  const label = firstElementByTagName(navLabel, "text")?.textContent?.trim() || "";
  const src = firstElementByTagName(el, "content")?.getAttribute("src") || "";
  const children = childElementsByTagName(el, "navPoint").map(parseNavPoint);

  return {
    id: el.getAttribute("id") || generateId(label),
    playOrder: parseInt(el.getAttribute("playOrder") || "0", 10),
    label,
    src,
    children,
  };
}

async function navPointsToChapters(
  navPoints: NcxNavPoint[],
  rawTexts: Map<string, string>,
  spine: SpineItem[],
  base: string,
  onProgress?: (message: string) => void
): Promise<Chapter[]> {
  const flatPoints = flattenNcxNavPoints(navPoints);
  const seenHrefs = new Set<string>();
  const candidates: NavChapterCandidate[] = [];

  const sortedPoints = flatPoints.sort((a, b) => a.playOrder - b.playOrder);
  onProgress?.(`Reading table of contents: ${sortedPoints.length} entries…`);

  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    const fullHref = resolveEpubHref(point.src, base, rawTexts, spine);
    if (fullHref && !seenHrefs.has(fullHref)) {
      seenHrefs.add(fullHref);

      const text = extractText(rawTexts.get(fullHref) || "");
      const wordCount = countWords(text);
      const spineIndex = spine.findIndex((s) => s.href === fullHref);
      candidates.push({
        id: point.id,
        title: buildHierarchicalTitle(point.label, point.parentLabels),
        wordCount,
        href: fullHref,
        spineIndex: spineIndex >= 0 ? spineIndex : 0,
        rawText: text,
        hasChildren: point.hasChildren,
      });
    }

    if ((i + 1) % 25 === 0 || i === sortedPoints.length - 1) {
      onProgress?.(`Reading table of contents ${i + 1} of ${sortedPoints.length}…`);
      await yieldToUi();
    }
  }

  const meaningful = candidates.filter((ch) => isMeaningfulNavChapter(ch.wordCount, ch.hasChildren));
  const usable = meaningful.length > 0 ? meaningful : candidates.filter((ch) => ch.wordCount > 0);

  return usable.map((chapter, index) => ({
    id: chapter.id,
    index,
    title: chapter.title,
    wordCount: chapter.wordCount,
    href: chapter.href,
    spineIndex: chapter.spineIndex >= 0 ? chapter.spineIndex : index,
    startCfi: "",
    endCfi: "",
    sections: buildSections(chapter.rawText || "", chapter.id, index),
    rawText: chapter.rawText,
  }));
}

function flattenNcxNavPoints(
  points: NcxNavPoint[],
  parentLabels: string[] = [],
  depth = 1
): FlatNavPoint[] {
  return points.flatMap((point, fallbackIndex) => {
    const cleanLabel = normalizeTitle(point.label);
    const flat: FlatNavPoint = {
      id: point.id || generateId(`${cleanLabel}${point.src}${depth}${fallbackIndex}`),
      label: cleanLabel || `Section ${fallbackIndex + 1}`,
      src: point.src,
      playOrder: point.playOrder || Number.MAX_SAFE_INTEGER,
      depth,
      parentLabels,
      hasChildren: point.children.length > 0,
    };

    const childParents = cleanLabel ? [...parentLabels, cleanLabel] : parentLabels;
    return [flat, ...flattenNcxNavPoints(point.children, childParents, depth + 1)];
  });
}

// ─── NAV Parser (EPUB3) ───────────────────────────────────────────────────────

async function parseNav(
  navContent: string,
  rawTexts: Map<string, string>,
  spine: SpineItem[],
  base: string,
  onProgress?: (message: string) => void
): Promise<Chapter[]> {
  const doc = parseXml(navContent);
  const tocNav = Array.from(doc.querySelectorAll("nav")).find(
    (n) => n.getAttribute("epub:type") === "toc" || n.id === "toc"
  );
  if (!tocNav) return [];

  const flatItems = flattenHtmlNav(tocNav);
  const seenHrefs = new Set<string>();
  const candidates: NavChapterCandidate[] = [];

  onProgress?.(`Reading table of contents: ${flatItems.length} entries…`);

  for (let itemIndex = 0; itemIndex < flatItems.length; itemIndex++) {
    const item = flatItems[itemIndex];
    const fullHref = resolveEpubHref(item.href, base, rawTexts, spine);
    if (fullHref && !seenHrefs.has(fullHref)) {
      seenHrefs.add(fullHref);
      const text = extractText(rawTexts.get(fullHref) || "");
      const wordCount = countWords(text);
      const spineIndex = spine.findIndex((s) => s.href === fullHref);

      candidates.push({
        id: generateId(`${item.label}${fullHref}${itemIndex}`),
        title: buildHierarchicalTitle(item.label, item.parentLabels),
        wordCount,
        href: fullHref,
        spineIndex: spineIndex >= 0 ? spineIndex : 0,
        rawText: text,
        hasChildren: item.hasChildren,
      });
    }

    if ((itemIndex + 1) % 25 === 0 || itemIndex === flatItems.length - 1) {
      onProgress?.(`Reading table of contents ${itemIndex + 1} of ${flatItems.length}…`);
      await yieldToUi();
    }
  }

  const meaningful = candidates.filter((ch) => isMeaningfulNavChapter(ch.wordCount, ch.hasChildren));
  const usable = meaningful.length > 0 ? meaningful : candidates.filter((ch) => ch.wordCount > 0);

  return usable.map((chapter, index) => ({
    id: chapter.id,
    index,
    title: chapter.title,
    wordCount: chapter.wordCount,
    href: chapter.href,
    spineIndex: chapter.spineIndex >= 0 ? chapter.spineIndex : index,
    startCfi: "",
    endCfi: "",
    sections: buildSections(chapter.rawText || "", chapter.id, index),
    rawText: chapter.rawText,
  }));
}

function flattenHtmlNav(
  root: Element,
  parentLabels: string[] = []
): { label: string; href: string; parentLabels: string[]; hasChildren: boolean }[] {
  const list = Array.from(root.children).find((el) => el.tagName.toLowerCase() === "ol");
  if (!list) return [];

  return Array.from(list.children)
    .filter((el) => el.tagName.toLowerCase() === "li")
    .flatMap((li) => {
      const link = Array.from(li.children).find((el) => {
        const tag = el.tagName.toLowerCase();
        return tag === "a" || tag === "span";
      });
      const childOl = Array.from(li.children).find((el) => el.tagName.toLowerCase() === "ol");
      const label = normalizeTitle(link?.textContent || "");
      const href = link?.tagName.toLowerCase() === "a" ? link.getAttribute("href") || "" : "";
      const item = href
        ? [{ label, href, parentLabels, hasChildren: Boolean(childOl) }]
        : [];
      const childParents = label ? [...parentLabels, label] : parentLabels;
      return [
        ...item,
        ...(childOl ? flattenHtmlNav(childOl, childParents) : []),
      ];
    });
}

function resolveEpubHref(
  rawHref: string,
  base: string,
  rawTexts: Map<string, string>,
  spine: SpineItem[]
): string {
  const hrefBase = rawHref.split("#")[0];
  if (!hrefBase) return "";

  const candidates = [
    normalizePath(hrefBase),
    normalizePath(base + hrefBase),
  ];

  const direct = candidates.find((href) => rawTexts.has(href));
  if (direct) return direct;

  const fileName = hrefBase.split("/").pop();
  if (!fileName) return normalizePath(base + hrefBase);

  const spineMatch = spine.find((item) => item.href === hrefBase || item.href.endsWith(`/${fileName}`));
  return spineMatch?.href ?? normalizePath(base + hrefBase);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/**
 * Strips bracket-wrapped metadata noise from EPUB nav labels.
 * e.g. "[Red Rising Saga 01] Red Rising" → "Red Rising"
 *      "Chapter One [Revised]"           → "Chapter One"
 */
function sanitizeRawLabel(label: string): string {
  return label
    .replace(/^\[[^\]]+\]\s*/g, "")   // leading bracket block
    .replace(/\s*\[[^\]]+\]$/g, "")   // trailing bracket block
    .replace(/\s+/g, " ")
    .trim();
}

function buildHierarchicalTitle(label: string, parentLabels: string[]): string {
  const cleanLabel = sanitizeRawLabel(normalizeTitle(label));

  const meaningfulParents = parentLabels
    .map((p) => sanitizeRawLabel(normalizeTitle(p)))
    .filter(Boolean)
    .filter((parent) => !areEquivalentTitleFragments(parent, cleanLabel))
    .filter((parent) => parent.length > 0);

  // Find the nearest group label (Book / Part / Volume / Act) that adds useful context
  const nearestGroup = meaningfulParents.find((parent) =>
    /\b(book|saga|volume|vol\.?|part|act)\b/i.test(parent)
  );

  // Only prepend a group label if the chapter title doesn't already contain it
  if (
    !nearestGroup ||
    cleanLabel.toLowerCase().includes(nearestGroup.toLowerCase()) ||
    areEquivalentTitleFragments(nearestGroup, cleanLabel)
  ) {
    return cleanLabel;
  }

  return `${nearestGroup} / ${cleanLabel}`;
}

function areEquivalentTitleFragments(a: string, b: string): boolean {
  const left = normalizeComparableTitle(a);
  const right = normalizeComparableTitle(b);
  return Boolean(left && right && left === right);
}

function normalizeComparableTitle(title: string): string {
  return sanitizeRawLabel(title)
    .toLowerCase()
    .replace(/\bchapter\s+chapter\b/g, "chapter")
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

function deriveCollectionGroups(chapters: Chapter[]): CollectionGroup[] {
  const prefixByChapter = chapters.map((chapter) => {
    const [prefix] = chapter.title.split(" / ");
    return chapter.title.includes(" / ") ? normalizeTitle(prefix) : "";
  });

  const distinctPrefixes = Array.from(new Set(prefixByChapter.filter(Boolean)));
  if (distinctPrefixes.length < 2) return [];

  const groups: CollectionGroup[] = [];
  let currentTitle = "";
  let startIndex = -1;
  let wordCount = 0;

  const flush = (endIndex: number) => {
    if (!currentTitle || startIndex < 0) return;
    groups.push({
      id: generateId(`${currentTitle}${startIndex}${endIndex}`),
      title: currentTitle,
      startChapterIndex: startIndex,
      endChapterIndex: endIndex,
      wordCount,
    });
  };

  chapters.forEach((chapter, index) => {
    const title = prefixByChapter[index];
    if (!title) {
      if (currentTitle) wordCount += chapter.wordCount;
      return;
    }

    if (title !== currentTitle) {
      flush(index - 1);
      currentTitle = title;
      startIndex = index;
      wordCount = 0;
    }

    wordCount += chapter.wordCount;
  });

  flush(chapters.length - 1);

  return groups.filter((group) => group.wordCount > 1000);
}

function isMeaningfulNavChapter(wordCount: number, hasChildren: boolean): boolean {
  if (wordCount <= 0) return false;
  if (!hasChildren) return wordCount >= 80;
  return wordCount >= 250;
}

// ─── Level 2: Heading Detection ───────────────────────────────────────────────

function detectByHeadings(rawTexts: Map<string, string>, spine: SpineItem[]): Chapter[] {
  const chapters: Chapter[] = [];
  let globalIndex = 0;

  for (const item of spine) {
    const html = rawTexts.get(item.href) || "";
    const doc = parseXml(html);
    const headings = doc.querySelectorAll("h1, h2");

    if (headings.length === 0) continue;

    for (const heading of Array.from(headings)) {
      const title = heading.textContent?.trim() || `Chapter ${globalIndex + 1}`;
      // Get text from this heading to the next
      let text = title + " ";
      let sibling = heading.nextElementSibling;
      while (sibling && !["H1", "H2"].includes(sibling.tagName)) {
        text += sibling.textContent + " ";
        sibling = sibling.nextElementSibling;
      }

      const wordCount = countWords(text);
      if (wordCount < 100) continue; // skip tiny sections

      const id = generateId(title + globalIndex);
      const spineIdx = spine.findIndex((s) => s.href === item.href);
      chapters.push({
        id,
        index: globalIndex,
        title,
        wordCount,
        href: item.href,
        spineIndex: spineIdx >= 0 ? spineIdx : globalIndex,
        startCfi: "",
        endCfi: "",
        sections: buildSections(text, id, globalIndex),
        rawText: text,
      });
      globalIndex++;
    }
  }

  return chapters;
}

// ─── Level 3: Scene Break Detection ──────────────────────────────────────────

const SCENE_BREAK_PATTERNS = [
  /\*\s*\*\s*\*/,
  /---+/,
  /\*\*\*+/,
  /§/,
  /◆/,
  /•\s*•\s*•/,
];

function detectBySceneBreaks(rawTexts: Map<string, string>, spine: SpineItem[]): Chapter[] {
  const chapters: Chapter[] = [];
  let globalIndex = 0;

  for (const item of spine) {
    const html = rawTexts.get(item.href) || "";
    const text = extractText(html);
    const paragraphs = text.split(/\n\n+/);

    let currentChunk: string[] = [];
    let chunkIndex = 0;

    for (const para of paragraphs) {
      const isBreak = SCENE_BREAK_PATTERNS.some((p) => p.test(para.trim()));
      if (isBreak && currentChunk.length > 0) {
        const chunkText = currentChunk.join("\n\n");
        const wordCount = countWords(chunkText);
        if (wordCount > 200) {
          const id = generateId(item.href + chunkIndex);
          const spineIdx = spine.findIndex((s) => s.href === item.href);
          chapters.push({
            id,
            index: globalIndex,
            title: `Section ${globalIndex + 1}`,
            wordCount,
            href: item.href,
            spineIndex: spineIdx >= 0 ? spineIdx : globalIndex,
            startCfi: "",
            endCfi: "",
            sections: buildSections(chunkText, id, globalIndex),
            rawText: chunkText,
          });
          globalIndex++;
          chunkIndex++;
        }
        currentChunk = [];
      } else {
        currentChunk.push(para);
      }
    }

    // Add remaining
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join("\n\n");
      const wordCount = countWords(chunkText);
      if (wordCount > 200) {
        const id = generateId(item.href + chunkIndex);
        const spineIdx = spine.findIndex((s) => s.href === item.href);
        chapters.push({
          id,
          index: globalIndex,
          title: `Section ${globalIndex + 1}`,
          wordCount,
          href: item.href,
          spineIndex: spineIdx >= 0 ? spineIdx : globalIndex,
          startCfi: "",
          endCfi: "",
          sections: buildSections(chunkText, id, globalIndex),
          rawText: chunkText,
        });
        globalIndex++;
      }
    }
  }

  return chapters;
}

// ─── Level 4: Word Count Chunking ─────────────────────────────────────────────

const CHUNK_TARGET_WORDS = 4000;

function chunkByWordCount(rawTexts: Map<string, string>, spine: SpineItem[]): Chapter[] {
  const chapters: Chapter[] = [];
  let globalIndex = 0;
  let currentWords: string[] = [];
  let currentHref = "";
  let currentSpineIdx = 0;

  const flushChunk = () => {
    if (currentWords.length === 0) return;
    const text = currentWords.join(" ");
    const wordCount = countWords(text);
    const id = generateId("chunk" + globalIndex);
    chapters.push({
      id,
      index: globalIndex,
      title: `Part ${globalIndex + 1}`,
      wordCount,
      href: currentHref,
      spineIndex: currentSpineIdx,
      startCfi: "",
      endCfi: "",
      sections: buildSections(text, id, globalIndex),
      rawText: text,
    });
    globalIndex++;
    currentWords = [];
  };

  for (let si = 0; si < spine.length; si++) {
    const item = spine[si];
    currentHref = item.href;
    currentSpineIdx = si;
    const html = rawTexts.get(item.href) || "";
    const text = extractText(html);
    const words = text.split(/\s+/).filter(Boolean);

    for (const word of words) {
      currentWords.push(word);
      if (currentWords.length >= CHUNK_TARGET_WORDS) {
        flushChunk();
      }
    }
  }

  flushChunk();
  return chapters;
}

// ─── Section Builder ──────────────────────────────────────────────────────────

function buildSections(text: string, chapterId: string, _chapterIndex: number): Section[] {
  const words = text.split(/\s+/).filter(Boolean);
  const sectionSize = 1500;
  const sections: Section[] = [];

  for (let i = 0; i < words.length; i += sectionSize) {
    const sectionWords = words.slice(i, i + sectionSize);
    const index = Math.floor(i / sectionSize);
    sections.push({
      id: `${chapterId}_s${index}`,
      chapterId,
      index,
      wordCount: sectionWords.length,
      startWordOffset: i,   // real word offset from chapter start
      rawText: sectionWords.join(" "),
    });
  }

  return sections;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseXml(content: string): Document {
  const parser = new DOMParser();
  // Try XML first, fall back to HTML
  let doc = parser.parseFromString(content, "application/xml");
  if (doc.querySelector("parsererror")) {
    doc = parser.parseFromString(content, "text/html");
  }
  return doc;
}

function extractText(html: string): string {
  const doc = parseXml(html);
  // Remove non-content elements
  doc.querySelectorAll("script, style").forEach((el) => el.remove());

  // Preserve explicit line breaks as newlines before we read text.
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));

  // Extract text per block-level element so paragraph boundaries survive.
  // These elements rarely nest one another, so textContent won't double-count.
  const blocks = Array.from(
    doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, li, pre")
  );

  let paragraphs: string[] = blocks
    .map((el) => collapseInlineWhitespace(el.textContent || ""))
    .filter(Boolean);

  // Fallback for chapters that use bare <div>s or raw text with no block tags:
  // split the body text on its own newlines and treat each line as a paragraph.
  if (paragraphs.length === 0) {
    const body = doc.body?.textContent || doc.documentElement?.textContent || "";
    paragraphs = body
      .split(/\n+/)
      .map((line) => collapseInlineWhitespace(line))
      .filter(Boolean);
  }

  return paragraphs.join("\n\n");
}

// Collapse runs of spaces/tabs/newlines inside a single paragraph to one space,
// without touching the paragraph-separating newlines we add between blocks.
function collapseInlineWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getTextContent(doc: Document, selector: string): string {
  return firstElementByTagName(doc, selector)?.textContent?.trim() || "";
}

function elementsByTagName(root: Document | Element | null | undefined, tagName: string): Element[] {
  if (!root) return [];
  const exact = Array.from(root.getElementsByTagName(tagName));
  if (exact.length > 0) return exact;
  const localName = tagName.includes(":") ? tagName.split(":").pop() || tagName : tagName;
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName === localName || element.tagName === localName
  );
}

function firstElementByTagName(
  root: Document | Element | null | undefined,
  tagName: string
): Element | undefined {
  return elementsByTagName(root, tagName)[0];
}

function childElementsByTagName(root: Element, tagName: string): Element[] {
  return Array.from(root.children).filter(
    (child) => child.localName === tagName || child.tagName === tagName
  );
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

async function yieldToUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function generateId(seed: string): string {
  // Simple deterministic ID from string
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ─── Cover Extraction ─────────────────────────────────────────────────────────

export async function extractCoverImage(zip: JSZip): Promise<string | undefined> {
  const MAX_COVER_BYTES = 2_500_000;
  const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  };

  const imageMimeType = (path: string, fallback = "image/jpeg") => {
    const ext = path.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "svg") return "image/svg+xml";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    return fallback;
  };

  const readImageAsDataUrl = async (path: string, fallbackMime = "image/jpeg") => {
    const file = zip.file(normalizePath(path));
    if (!file) return undefined;
    const estimatedSize = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (estimatedSize && estimatedSize > MAX_COVER_BYTES) return undefined;
    await yieldToUi();
    const bytes = await file.async("uint8array");
    if (bytes.length > MAX_COVER_BYTES) return undefined;
    return bytesToDataUrl(bytes, imageMimeType(path, fallbackMime));
  };

  // Try common cover locations
  const coverPaths = [
    "OEBPS/cover.jpg",
    "OEBPS/images/cover.jpg",
    "cover.jpg",
    "cover.png",
    "OEBPS/cover.png",
  ];

  for (const path of coverPaths) {
    const dataUrl = await readImageAsDataUrl(path);
    if (dataUrl) return dataUrl;
  }

  // Try to find cover in OPF
  const opfFile = Object.values(zip.files).find((f) => f.name.endsWith(".opf"));
  if (opfFile) {
    const content = await opfFile.async("text");
    const opfDoc = parseXml(content);
    const base = opfFile.name.includes("/")
      ? opfFile.name.substring(0, opfFile.name.lastIndexOf("/") + 1)
      : "";
    const manifestEl = firstElementByTagName(opfDoc, "manifest");
    const items = manifestEl ? elementsByTagName(manifestEl, "item") : [];
    const metadata = firstElementByTagName(opfDoc, "metadata");
    const metaEls = metadata ? elementsByTagName(metadata, "meta") : [];
    const coverId =
      metaEls.find((meta) => meta.getAttribute("name")?.toLowerCase() === "cover")
        ?.getAttribute("content") ?? "";

    const coverItem =
      items.find((item) => coverId && item.getAttribute("id") === coverId) ||
      items.find((item) => item.getAttribute("properties")?.split(/\s+/).includes("cover-image")) ||
      items.find((item) => /cover/i.test(item.getAttribute("id") || "")) ||
      items.find((item) => /cover/i.test(item.getAttribute("href") || ""));

    if (coverItem) {
      const href = coverItem.getAttribute("href") || "";
      const mediaType = coverItem.getAttribute("media-type") || imageMimeType(href);
      const dataUrl = await readImageAsDataUrl(base + href, mediaType);
      if (dataUrl) return dataUrl;
    }

    const firstLargeImage = items.find((item) => {
      const mediaType = item.getAttribute("media-type") || "";
      const href = item.getAttribute("href") || "";
      return mediaType.startsWith("image/") && !/logo|icon|glyph|ornament/i.test(href);
    });
    if (firstLargeImage) {
      const href = firstLargeImage.getAttribute("href") || "";
      const mediaType = firstLargeImage.getAttribute("media-type") || imageMimeType(href);
      const dataUrl = await readImageAsDataUrl(base + href, mediaType);
      if (dataUrl) return dataUrl;
    }
  }

  const anyCoverImage = Object.keys(zip.files).find((path) =>
    /cover/i.test(path) && /\.(jpe?g|png|webp|gif|svg)$/i.test(path)
  );
  if (anyCoverImage) {
    const dataUrl = await readImageAsDataUrl(anyCoverImage);
    if (dataUrl) return dataUrl;
  }

  const anyImage = Object.keys(zip.files).find((path) => {
    if (!/\.(jpe?g|png|webp)$/i.test(path)) return false;
    return !/logo|icon|glyph|ornament/i.test(path);
  });
  if (anyImage) {
    const dataUrl = await readImageAsDataUrl(anyImage);
    if (dataUrl) return dataUrl;
  }

  return undefined;
}
