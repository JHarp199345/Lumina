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
import type { BookStructure, Chapter, Section } from "@/types";

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

// ─── Main Parser ──────────────────────────────────────────────────────────────

export async function parseEpub(
  epubBytes: Uint8Array
): Promise<{ structure: BookStructure; rawTexts: Map<string, string>; zip: JSZip }> {
  const zip = await JSZip.loadAsync(epubBytes);

  // 1. Find OPF file
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
  const rawTexts = new Map<string, string>();
  for (const item of spine) {
    const file = zip.file(item.href);
    if (file) {
      const text = await file.async("text");
      rawTexts.set(item.href, text);
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
        chapters = navPointsToChapters(navPoints, rawTexts, spine, opfBase);
        confidence = "high";
      }
    }
  }

  // Level 1b: NAV (EPUB3)
  if (chapters.length === 0 && navId && manifest[navId]) {
    const navFile = zip.file(manifest[navId].href);
    if (navFile) {
      const navContent = await navFile.async("text");
      const navChapters = parseNav(navContent, rawTexts, spine, opfBase);
      if (navChapters.length > 0) {
        chapters = navChapters;
        confidence = "high";
      }
    }
  }

  // Level 2: Heading detection
  if (chapters.length === 0) {
    chapters = detectByHeadings(rawTexts, spine);
    if (chapters.length > 0) confidence = "medium";
  }

  // Level 3: Scene break patterns
  if (chapters.length === 0) {
    chapters = detectBySceneBreaks(rawTexts, spine);
    if (chapters.length > 0) confidence = "medium";
  }

  // Level 4: Word count chunking (always produces result)
  if (chapters.length === 0) {
    chapters = chunkByWordCount(rawTexts, spine);
    confidence = "low";
  }

  // Calculate totals
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  const structure: BookStructure = {
    bookId,
    title,
    author,
    totalWords,
    parserConfidence: confidence,
    chapters,
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
  const items = opfDoc.querySelectorAll("manifest item");
  items.forEach((item) => {
    const id = item.getAttribute("id") || "";
    const href = base + (item.getAttribute("href") || "");
    const mediaType = item.getAttribute("media-type") || "";
    manifest[id] = { id, href, mediaType };
  });
  return manifest;
}

function buildSpine(opfDoc: Document, manifest: Record<string, ManifestItem>): SpineItem[] {
  const spine: SpineItem[] = [];
  const itemrefs = opfDoc.querySelectorAll("spine itemref");
  itemrefs.forEach((ref) => {
    const idref = ref.getAttribute("idref") || "";
    if (manifest[idref]) spine.push(manifest[idref]);
  });
  return spine;
}

function getNcxId(opfDoc: Document): string | null {
  const spine = opfDoc.querySelector("spine");
  return spine?.getAttribute("toc") || null;
}

function getNavId(opfDoc: Document): string | null {
  const nav = opfDoc.querySelector('manifest item[properties*="nav"]');
  return nav?.getAttribute("id") || null;
}

// ─── NCX Parser ───────────────────────────────────────────────────────────────

function parseNcx(ncxContent: string): NcxNavPoint[] {
  const doc = parseXml(ncxContent);
  const navPoints = doc.querySelectorAll("navMap > navPoint");
  return Array.from(navPoints).map(parseNavPoint);
}

function parseNavPoint(el: Element): NcxNavPoint {
  const label =
    el.querySelector("navLabel text")?.textContent?.trim() || "";
  const src = el.querySelector("content")?.getAttribute("src") || "";
  const children = Array.from(el.querySelectorAll(":scope > navPoint")).map(parseNavPoint);

  return {
    id: el.getAttribute("id") || generateId(label),
    playOrder: parseInt(el.getAttribute("playOrder") || "0", 10),
    label,
    src,
    children,
  };
}

function navPointsToChapters(
  navPoints: NcxNavPoint[],
  rawTexts: Map<string, string>,
  spine: SpineItem[],
  base: string
): Chapter[] {
  return navPoints
    .sort((a, b) => a.playOrder - b.playOrder)
    .map((point, index) => {
      const hrefBase = point.src.split("#")[0];
      const fullHref = base + hrefBase;
      const text = extractText(rawTexts.get(fullHref) || "");
      const wordCount = countWords(text);
      const spineIndex = spine.findIndex((s) => s.href === fullHref);
      // Store the actual href EPUB.js will use for display()
      const displayHref = fullHref || hrefBase;

      const chapter: Chapter = {
        id: point.id,
        index,
        title: point.label,
        wordCount,
        href: displayHref,
        spineIndex: spineIndex >= 0 ? spineIndex : index,
        startCfi: "",
        endCfi: "",
        sections: buildSections(text, point.id, index),
        rawText: text,
      };

      return chapter;
    })
    .filter((ch) => ch.wordCount > 0);
}

// ─── NAV Parser (EPUB3) ───────────────────────────────────────────────────────

function parseNav(
  navContent: string,
  rawTexts: Map<string, string>,
  spine: SpineItem[],
  base: string
): Chapter[] {
  const doc = parseXml(navContent);
  const tocNav = Array.from(doc.querySelectorAll("nav")).find(
    (n) => n.getAttribute("epub:type") === "toc" || n.id === "toc"
  );
  if (!tocNav) return [];

  const items = tocNav.querySelectorAll("ol > li > a");
  return Array.from(items)
    .map((a, index) => {
      const label = a.textContent?.trim() || `Chapter ${index + 1}`;
      const rawHref = a.getAttribute("href") || "";
      const hrefBase = rawHref.split("#")[0];
      const fullHref = base + hrefBase;
      const text = extractText(rawTexts.get(fullHref) || "");
      const wordCount = countWords(text);
      const id = generateId(label + index);
      const spineIndex = spine.findIndex((s) => s.href === fullHref);

      return {
        id,
        index,
        title: label,
        wordCount,
        href: fullHref,
        spineIndex: spineIndex >= 0 ? spineIndex : index,
        startCfi: "",
        endCfi: "",
        sections: buildSections(text, id, index),
        rawText: text,
      } as Chapter;
    })
    .filter((ch) => ch.wordCount > 0);
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
  // Remove script and style elements
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return (doc.body?.textContent || doc.documentElement?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTextContent(doc: Document, selector: string): string {
  return doc.querySelector(selector)?.textContent?.trim() || "";
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
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
  // Try common cover locations
  const coverPaths = [
    "OEBPS/cover.jpg",
    "OEBPS/images/cover.jpg",
    "cover.jpg",
    "cover.png",
    "OEBPS/cover.png",
  ];

  for (const path of coverPaths) {
    const file = zip.file(path);
    if (file) {
      const bytes = await file.async("uint8array");
      const blob = new Blob([bytes], { type: "image/jpeg" });
      return URL.createObjectURL(blob);
    }
  }

  // Try to find cover in OPF
  const opfFile = Object.values(zip.files).find((f) => f.name.endsWith(".opf"));
  if (opfFile) {
    const content = await opfFile.async("text");
    const coverMatch = content.match(/id="cover[^"]*"\s+href="([^"]+)"/i);
    if (coverMatch?.[1]) {
      const base = opfFile.name.includes("/")
        ? opfFile.name.substring(0, opfFile.name.lastIndexOf("/") + 1)
        : "";
      const file = zip.file(base + coverMatch[1]);
      if (file) {
        const bytes = await file.async("uint8array");
        const ext = coverMatch[1].split(".").pop() || "jpeg";
        const blob = new Blob([bytes], { type: `image/${ext}` });
        return URL.createObjectURL(blob);
      }
    }
  }

  return undefined;
}
