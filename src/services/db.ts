/**
 * SQLite Database Service
 *
 * All persistence goes through here. Uses @tauri-apps/plugin-sql.
 * Tables: books, reading_progress, highlights, notes,
 *         semantic_maps, image_cache, book_settings
 */

import Database from "@tauri-apps/plugin-sql";
import type {
  Book,
  BookStructure,
  ReadingProgress,
  Highlight,
  Note,
  SemanticMap,
  CachedImage,
  StyleSeedId,
} from "@/types";

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load("sqlite:lumina.db");
  await initSchema(_db);
  return _db;
}

// ─── Schema Init ──────────────────────────────────────────────────────────────

async function initSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      file_path TEXT NOT NULL,
      cover_image_path TEXT,
      total_words INTEGER NOT NULL DEFAULT 0,
      parser_confidence TEXT NOT NULL DEFAULT 'low',
      imported_at TEXT NOT NULL,
      last_opened TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id TEXT PRIMARY KEY,
      current_cfi TEXT NOT NULL DEFAULT '',
      current_chapter INTEGER NOT NULL DEFAULT 0,
      percent_complete REAL NOT NULL DEFAULT 0,
      last_read TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_structures (
      book_id TEXT PRIMARY KEY,
      structure_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      cfi_range TEXT NOT NULL,
      color TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      highlight_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS semantic_maps (
      book_id TEXT PRIMARY KEY,
      arc_shape TEXT NOT NULL,
      inflection_points TEXT NOT NULL,
      scenes TEXT NOT NULL,
      golden_number INTEGER NOT NULL,
      analyzed_at TEXT NOT NULL,
      storyboard TEXT,
      visual_lore TEXT,
      narrative_blueprint TEXT
    );
  `);
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN storyboard TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN visual_lore TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN narrative_blueprint TEXT`).catch(() => {});

  await db.execute(`
    CREATE TABLE IF NOT EXISTS image_cache (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      description_used TEXT NOT NULL,
      style_seed TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generation_api TEXT NOT NULL,
      emotional_themes TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_settings (
      book_id TEXT PRIMARY KEY,
      style_seed TEXT,
      panel_layout TEXT
    );
  `);
}

// ─── Books ────────────────────────────────────────────────────────────────────

export async function dbSaveBook(book: Book): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO books
     (id, title, author, file_path, cover_image_path, total_words, parser_confidence, imported_at, last_opened)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      book.id,
      book.title,
      book.author,
      book.filePath,
      book.coverImage ?? null,
      book.totalWords,
      book.parserConfidence,
      book.importedAt,
      book.lastOpened ?? null,
    ]
  );
}

export async function dbLoadAllBooks(): Promise<Book[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM books ORDER BY last_opened DESC`
  );
  return rows.map(rowToBook);
}

export async function dbUpdateLastOpened(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE books SET last_opened = $1 WHERE id = $2`, [
    new Date().toISOString(),
    bookId,
  ]);
}

export async function dbDeleteBook(bookId: string): Promise<void> {
  const db = await getDb();
  const segmentPrefix = `${bookId}::%`;
  await db.execute(`DELETE FROM books WHERE id = $1`, [bookId]);
  await db.execute(`DELETE FROM book_structures WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM reading_progress WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM highlights WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM notes WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM book_settings WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
}

export async function dbSaveBookStructure(structure: BookStructure): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO book_structures (book_id, structure_json, saved_at)
     VALUES ($1, $2, $3)`,
    [structure.bookId, JSON.stringify(structure), new Date().toISOString()]
  );
}

export async function dbLoadBookStructure(bookId: string): Promise<BookStructure | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT structure_json FROM book_structures WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].structure_json)) as BookStructure;
  } catch {
    return null;
  }
}

function rowToBook(row: Record<string, unknown>): Book {
  return {
    id: String(row.id),
    title: String(row.title),
    author: String(row.author),
    filePath: String(row.file_path),
    coverImage: row.cover_image_path ? String(row.cover_image_path) : undefined,
    totalWords: Number(row.total_words),
    parserConfidence: String(row.parser_confidence) as Book["parserConfidence"],
    importedAt: String(row.imported_at),
    lastOpened: row.last_opened ? String(row.last_opened) : undefined,
  };
}

// ─── Reading Progress ─────────────────────────────────────────────────────────

export async function dbSaveProgress(progress: ReadingProgress): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO reading_progress
     (book_id, current_cfi, current_chapter, percent_complete, last_read)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      progress.bookId,
      progress.currentCfi,
      progress.currentChapterIndex,
      progress.percentComplete,
      progress.lastRead,
    ]
  );
}

export async function dbLoadProgress(bookId: string): Promise<ReadingProgress | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM reading_progress WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    bookId: String(row.book_id),
    currentCfi: String(row.current_cfi),
    currentChapterIndex: Number(row.current_chapter),
    percentComplete: Number(row.percent_complete),
    lastRead: String(row.last_read),
  };
}

// ─── Highlights ───────────────────────────────────────────────────────────────

export async function dbSaveHighlight(highlight: Highlight): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO highlights (id, book_id, cfi_range, color, selected_text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      highlight.id,
      highlight.bookId,
      highlight.cfiRange,
      highlight.color,
      highlight.selectedText,
      highlight.createdAt,
    ]
  );
}

export async function dbLoadHighlights(bookId: string): Promise<Highlight[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM highlights WHERE book_id = $1 ORDER BY created_at ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    cfiRange: String(row.cfi_range),
    color: String(row.color) as Highlight["color"],
    selectedText: String(row.selected_text),
    createdAt: String(row.created_at),
  }));
}

export async function dbDeleteHighlight(highlightId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM highlights WHERE id = $1`, [highlightId]);
  await db.execute(`DELETE FROM notes WHERE highlight_id = $1`, [highlightId]);
}

export async function dbUpdateHighlightColor(highlightId: string, color: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE highlights SET color = $1 WHERE id = $2`, [color, highlightId]);
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function dbSaveNote(note: Note): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO notes (id, highlight_id, book_id, note_text, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      note.id,
      note.highlightId,
      note.bookId,
      note.noteText,
      note.createdAt,
      note.updatedAt,
    ]
  );
}

export async function dbLoadNotes(bookId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM notes WHERE book_id = $1 ORDER BY created_at ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    highlightId: String(row.highlight_id),
    bookId: String(row.book_id),
    noteText: String(row.note_text),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function dbUpdateNote(noteId: string, text: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE notes SET note_text = $1, updated_at = $2 WHERE id = $3`,
    [text, new Date().toISOString(), noteId]
  );
}

export async function dbDeleteNote(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM notes WHERE id = $1`, [noteId]);
}

// ─── Semantic Maps ────────────────────────────────────────────────────────────

export async function dbSaveSemanticMap(map: SemanticMap): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO semantic_maps
     (book_id, arc_shape, inflection_points, scenes, golden_number, analyzed_at, storyboard, visual_lore, narrative_blueprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      map.bookId,
      map.arcShape,
      JSON.stringify(map.inflectionPoints),
      JSON.stringify(map.scenes),
      map.goldenNumber,
      map.analyzedAt,
      JSON.stringify(map.storyboard ?? null),
      JSON.stringify(map.visualLore ?? null),
      JSON.stringify(map.narrativeBlueprint ?? null),
    ]
  );
}

export async function dbDeleteSemanticMap(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1`, [bookId]);
}

export async function dbLoadSemanticMap(bookId: string): Promise<SemanticMap | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM semantic_maps WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    bookId: String(row.book_id),
    arcShape: String(row.arc_shape) as SemanticMap["arcShape"],
    inflectionPoints: JSON.parse(String(row.inflection_points)),
    scenes: JSON.parse(String(row.scenes)),
    goldenNumber: Number(row.golden_number),
    analyzedAt: String(row.analyzed_at),
    storyboard:
      row.storyboard && String(row.storyboard) !== "null"
        ? JSON.parse(String(row.storyboard))
        : undefined,
    visualLore:
      row.visual_lore && String(row.visual_lore) !== "null"
        ? JSON.parse(String(row.visual_lore))
        : undefined,
    narrativeBlueprint:
      row.narrative_blueprint && String(row.narrative_blueprint) !== "null"
        ? JSON.parse(String(row.narrative_blueprint))
        : undefined,
  };
}

// ─── Image Cache ──────────────────────────────────────────────────────────────

export async function dbSaveImageCache(image: CachedImage): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO image_cache
     (id, book_id, scene_id, file_path, description_used, style_seed, generated_at, generation_api, emotional_themes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      image.id,
      image.bookId,
      image.sceneId,
      image.filePath,
      image.descriptionUsed,
      image.styleSeed,
      image.generatedAt,
      image.generationApi,
      JSON.stringify(image.emotionalThemes),
    ]
  );
}

export async function dbLoadImageCache(bookId: string): Promise<CachedImage[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM image_cache WHERE book_id = $1`,
    [bookId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    sceneId: String(row.scene_id),
    filePath: String(row.file_path),
    descriptionUsed: String(row.description_used),
    styleSeed: String(row.style_seed) as StyleSeedId,
    generatedAt: String(row.generated_at),
    generationApi: String(row.generation_api) as CachedImage["generationApi"],
    emotionalThemes: JSON.parse(String(row.emotional_themes)),
  }));
}

export async function dbLoadImageCacheForBookPrefix(bookId: string): Promise<CachedImage[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`,
    [bookId, `${bookId}::%`]
  );
  return rows.map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    sceneId: String(row.scene_id),
    filePath: String(row.file_path),
    descriptionUsed: String(row.description_used),
    styleSeed: String(row.style_seed) as StyleSeedId,
    generatedAt: String(row.generated_at),
    generationApi: String(row.generation_api) as CachedImage["generationApi"],
    emotionalThemes: JSON.parse(String(row.emotional_themes)),
  }));
}

export async function dbDeleteImageCache(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM image_cache WHERE book_id = $1`, [bookId]);
}

// ─── Book Settings ────────────────────────────────────────────────────────────

export async function dbSaveBookStyleSeed(bookId: string, seedId: StyleSeedId): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO book_settings (book_id, style_seed) VALUES ($1, $2)`,
    [bookId, seedId]
  );
}

export async function dbLoadBookStyleSeed(bookId: string): Promise<StyleSeedId | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT style_seed FROM book_settings WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0 || !rows[0].style_seed) return null;
  return String(rows[0].style_seed) as StyleSeedId;
}

// ─── Bulk delete ──────────────────────────────────────────────────────────────

/** Delete all data rows for a book across every table. File cleanup is the caller's responsibility. */
export async function dbDeleteAllBookData(bookId: string): Promise<void> {
  const db = await getDb();
  const queries = [
    [`DELETE FROM books WHERE id = $1`, [bookId]],
    [`DELETE FROM reading_progress WHERE book_id = $1`, [bookId]],
    [`DELETE FROM highlights WHERE book_id = $1`, [bookId]],
    [`DELETE FROM notes WHERE book_id = $1`, [bookId]],
    [`DELETE FROM semantic_maps WHERE book_id = $1`, [bookId]],
    [`DELETE FROM image_cache WHERE book_id = $1`, [bookId]],
    [`DELETE FROM book_settings WHERE book_id = $1`, [bookId]],
  ] as [string, unknown[]][];
  for (const [sql, params] of queries) {
    await db.execute(sql, params).catch(() => {});
  }
}
