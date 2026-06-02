#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

const execFileAsync = promisify(execFile);

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/import-epub-to-lumina.mjs /path/to/book.epub");
  process.exit(1);
}

const appDataDir =
  process.env.LUMINA_APP_DATA ||
  path.join(process.env.HOME || "", "Library/Application Support/com.lumina.reader");
const dbPath = path.join(appDataDir, "lumina.db");

function textContent(doc, tagName) {
  const item = doc.getElementsByTagName(tagName)[0];
  return item?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function attr(el, name) {
  return el?.getAttribute?.(name) || "";
}

function normalizePath(input) {
  const parts = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function generateId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const bytes = await fs.readFile(sourcePath);
const zip = await JSZip.loadAsync(bytes);
const container = await zip.file("META-INF/container.xml")?.async("text");
const opfPath =
  container?.match(/full-path="([^"]+)"/)?.[1] ||
  Object.keys(zip.files).find((file) => file.endsWith(".opf"));

if (!opfPath) throw new Error("Cannot find OPF file in EPUB");

const opfText = await zip.file(opfPath)?.async("text");
if (!opfText) throw new Error("Cannot read OPF file");

const opfDoc = new DOMParser().parseFromString(opfText, "application/xml");
const opfBase = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
const title = textContent(opfDoc, "dc:title") || "Unknown Title";
const author = textContent(opfDoc, "dc:creator") || "Unknown Author";
const bookId = generateId(title + author);

const manifest = new Map();
for (const item of Array.from(opfDoc.getElementsByTagName("item"))) {
  const id = attr(item, "id");
  const href = normalizePath(opfBase + attr(item, "href"));
  const mediaType = attr(item, "media-type");
  if (id) manifest.set(id, { href, mediaType });
}

const spine = [];
for (const itemref of Array.from(opfDoc.getElementsByTagName("itemref"))) {
  const idref = attr(itemref, "idref");
  const item = manifest.get(idref);
  if (item) spine.push(item);
}

let totalWords = 0;
let loadedSections = 0;
for (const item of spine) {
  const file = zip.file(item.href);
  if (!file) continue;
  const html = await file.async("text");
  const words = countWords(extractText(html));
  if (words > 0) loadedSections++;
  totalWords += words;
}

const destinationDir = path.join(appDataDir, "books", bookId);
const destinationPath = path.join(destinationDir, path.basename(sourcePath));
await fs.mkdir(destinationDir, { recursive: true });
await fs.copyFile(sourcePath, destinationPath);

const now = new Date().toISOString();
await execFileAsync("sqlite3", [
  dbPath,
  `INSERT OR REPLACE INTO books
   (id, title, author, file_path, cover_image_path, total_words, parser_confidence, imported_at, last_opened)
   VALUES (${sqlQuote(bookId)}, ${sqlQuote(title)}, ${sqlQuote(author)}, ${sqlQuote(destinationPath)}, NULL, ${totalWords}, 'high', ${sqlQuote(now)}, ${sqlQuote(now)});`,
]);

console.log(
  JSON.stringify(
    {
      bookId,
      title,
      author,
      totalWords,
      loadedSections,
      destinationPath,
      dbPath,
    },
    null,
    2
  )
);
