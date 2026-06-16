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
  BookProfile,
  SourceIntelligenceProfile,
  CachedImage,
  StyleSeedId,
  StudyGuide,
  StudyQuiz,
  StudyQuizAttempt,
  StudyBadgeAward,
  StudyFlashcard,
  AudioArtifact,
  PresentationDeck,
  ArchiveBook,
  LuminaNotification,
  BlackboardNote,
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
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      artifact_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
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
      narrative_blueprint TEXT,
      book_profile TEXT
    );
  `);
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN storyboard TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN visual_lore TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN narrative_blueprint TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE semantic_maps ADD COLUMN book_profile TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE image_cache ADD COLUMN word_position INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE image_cache ADD COLUMN visual_slot_key TEXT`).catch(() => {});

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_profiles (
      book_id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      built_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS source_profiles (
      book_id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS blackboard_notes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      note_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_guides (
      book_id TEXT PRIMARY KEY,
      guide_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_quizzes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      quiz_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_quiz_attempts (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      attempt_json TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_badges (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      badge_json TEXT NOT NULL,
      awarded_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_flashcards (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      card_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS image_cache (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      visual_slot_key TEXT,
      word_position INTEGER,
      file_path TEXT NOT NULL,
      description_used TEXT NOT NULL,
      style_seed TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generation_api TEXT NOT NULL,
      emotional_themes TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS audio_cache (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      audio_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      deck_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_settings (
      book_id TEXT PRIMARY KEY,
      style_seed TEXT,
      panel_layout TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS archive_books (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      audio_count INTEGER NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0,
      note_count INTEGER NOT NULL DEFAULT 0,
      presentation_count INTEGER NOT NULL DEFAULT 0,
      highlight_count INTEGER NOT NULL DEFAULT 0,
      badge_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  await db.execute(`ALTER TABLE archive_books ADD COLUMN badge_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE notes ADD COLUMN source_excerpt TEXT`).catch(() => {});

  await db.execute(`
    CREATE TABLE IF NOT EXISTS download_ledger (
      gutenberg_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      anchor TEXT,
      filename TEXT,
      download_url TEXT,
      downloaded_at TEXT,
      download_confirmed_at TEXT,
      download_status TEXT,
      imported_at TEXT
    );
  `);
  await db.execute(`ALTER TABLE download_ledger ADD COLUMN anchor TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE download_ledger ADD COLUMN download_confirmed_at TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE download_ledger ADD COLUMN download_status TEXT`).catch(() => {});
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
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM blackboard_notes WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM source_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_guides WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_quizzes WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_quiz_attempts WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_flashcards WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM audio_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM presentations WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
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
    `INSERT OR REPLACE INTO notes (id, highlight_id, book_id, note_text, source_excerpt, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      note.id,
      note.highlightId,
      note.bookId,
      note.noteText,
      note.sourceExcerpt ?? null,
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
    ...(row.source_excerpt ? { sourceExcerpt: String(row.source_excerpt) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function dbLoadNoteById(noteId: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(`SELECT * FROM notes WHERE id = $1`, [noteId]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: String(row.id),
    highlightId: String(row.highlight_id),
    bookId: String(row.book_id),
    noteText: String(row.note_text),
    ...(row.source_excerpt ? { sourceExcerpt: String(row.source_excerpt) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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

// ─── Notifications ──────────────────────────────────────────────────────────────

export async function dbSaveNotification(n: LuminaNotification): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO notifications
     (id, book_id, feature, kind, title, detail, artifact_id, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [n.id, n.bookId, n.feature, n.kind, n.title, n.detail ?? null, n.artifactId ?? null, n.read ? 1 : 0, n.createdAt]
  );
}

export async function dbLoadNotifications(bookId: string): Promise<LuminaNotification[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM notifications WHERE book_id = $1 ORDER BY created_at ASC`,
    [bookId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    bookId: String(row.book_id),
    feature: String(row.feature) as LuminaNotification["feature"],
    kind: String(row.kind) as LuminaNotification["kind"],
    title: String(row.title),
    ...(row.detail ? { detail: String(row.detail) } : {}),
    ...(row.artifact_id ? { artifactId: String(row.artifact_id) } : {}),
    read: Number(row.read) === 1,
    createdAt: String(row.created_at),
  }));
}

export async function dbMarkNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders})`, ids);
}

export async function dbDeleteNotification(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM notifications WHERE id = $1`, [id]);
}

export async function dbClearNotifications(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM notifications WHERE book_id = $1`, [bookId]);
}

// ─── Semantic Maps ────────────────────────────────────────────────────────────

export async function dbSaveSemanticMap(map: SemanticMap): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO semantic_maps
     (book_id, arc_shape, inflection_points, scenes, golden_number, analyzed_at, storyboard, visual_lore, narrative_blueprint, book_profile)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      JSON.stringify(map.bookProfile ?? null),
    ]
  );
  if (map.bookProfile) await dbSaveBookProfile(map.bookProfile);
}

export async function dbDeleteSemanticMap(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM book_profiles WHERE book_id = $1`, [bookId]);
}

export async function dbDeleteSemanticMapsForBookPrefix(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1 OR book_id LIKE $2`, [bookId, `${bookId}::%`]);
  await db.execute(`DELETE FROM book_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, `${bookId}::%`]);
}

export async function dbSaveBookProfile(profile: BookProfile): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO book_profiles (book_id, profile_json, built_at, updated_at)
     VALUES ($1, $2, $3, $4)`,
    [
      profile.bookId,
      JSON.stringify(profile),
      profile.builtAt,
      profile.updatedAt ?? profile.builtAt,
    ]
  );
}

export async function dbLoadBookProfile(bookId: string): Promise<BookProfile | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT profile_json FROM book_profiles WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length > 0) {
    try {
      return JSON.parse(String(rows[0].profile_json)) as BookProfile;
    } catch {
      return null;
    }
  }
  const map = await dbLoadSemanticMap(bookId);
  return map?.bookProfile ?? null;
}

export async function dbDeleteBookProfile(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM book_profiles WHERE book_id = $1`, [bookId]);
}

export async function dbDeleteBookProfilesForBookPrefix(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM book_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, `${bookId}::%`]);
}

// ─── Indexed Blackboard Artifacts ─────────────────────────────────────────────

export async function dbSaveBlackboardNotes(notes: BlackboardNote[]): Promise<void> {
  const db = await getDb();
  await Promise.all(
    notes.map((note) =>
      db.execute(
        `INSERT OR REPLACE INTO blackboard_notes (id, book_id, note_json, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [note.id, note.bookId, JSON.stringify(note), note.updatedAt]
      )
    )
  );
}

export async function dbLoadBlackboardNotes(bookId: string): Promise<BlackboardNote[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT note_json FROM blackboard_notes WHERE book_id = $1 ORDER BY updated_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.note_json)) as BlackboardNote];
    } catch {
      return [];
    }
  }).sort(
    (a, b) =>
      (a.startWord ?? 0) - (b.startWord ?? 0) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id)
  );
}

export async function dbDeleteBlackboardNotes(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM blackboard_notes WHERE book_id = $1`, [bookId]);
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
    bookProfile:
      row.book_profile && String(row.book_profile) !== "null"
        ? JSON.parse(String(row.book_profile))
        : undefined,
  };
}

// ─── Study Guide ────────────────────────────────────────────────────────────────

export async function dbSaveStudyGuide(guide: StudyGuide): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO study_guides (book_id, guide_json, generated_at)
     VALUES ($1, $2, $3)`,
    [guide.bookId, JSON.stringify(guide), guide.generatedAt]
  );
}

export async function dbLoadStudyGuide(bookId: string): Promise<StudyGuide | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT guide_json FROM study_guides WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].guide_json)) as StudyGuide;
  } catch {
    return null;
  }
}

export async function dbDeleteStudyGuide(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM study_guides WHERE book_id = $1`, [bookId]);
}

// ─── Source Intelligence Profile ────────────────────────────────────────────────

export async function dbSaveSourceProfile(profile: SourceIntelligenceProfile): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO source_profiles (book_id, profile_json, built_at)
     VALUES ($1, $2, $3)`,
    [profile.bookId, JSON.stringify(profile), profile.builtAt]
  );
}

export async function dbLoadSourceProfile(bookId: string): Promise<SourceIntelligenceProfile | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT profile_json FROM source_profiles WHERE book_id = $1`,
    [bookId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].profile_json)) as SourceIntelligenceProfile;
  } catch {
    return null;
  }
}

export async function dbDeleteSourceProfile(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM source_profiles WHERE book_id = $1`, [bookId]);
}

export async function dbDeleteSourceProfilesForBookPrefix(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM source_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, `${bookId}::%`]);
}

export async function dbSaveStudyQuiz(quiz: StudyQuiz): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO study_quizzes (id, book_id, quiz_json, generated_at)
     VALUES ($1, $2, $3, $4)`,
    [quiz.id, quiz.bookId, JSON.stringify(quiz), quiz.generatedAt]
  );
}

export async function dbLoadStudyQuizzes(bookId: string): Promise<StudyQuiz[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT quiz_json FROM study_quizzes WHERE book_id = $1 ORDER BY generated_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.quiz_json)) as StudyQuiz];
    } catch {
      return [];
    }
  });
}

export async function dbSaveStudyQuizAttempt(attempt: StudyQuizAttempt): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO study_quiz_attempts (id, quiz_id, book_id, attempt_json, completed_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [attempt.id, attempt.quizId, attempt.bookId, JSON.stringify(attempt), attempt.completedAt]
  );
}

export async function dbLoadStudyQuizAttempts(bookId: string): Promise<StudyQuizAttempt[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT attempt_json FROM study_quiz_attempts WHERE book_id = $1 ORDER BY completed_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.attempt_json)) as StudyQuizAttempt];
    } catch {
      return [];
    }
  });
}

export async function dbSaveStudyBadgeAward(award: StudyBadgeAward): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO study_badges (id, book_id, badge_json, awarded_at)
     VALUES ($1, $2, $3, $4)`,
    [award.id, award.bookId, JSON.stringify(award), award.awardedAt]
  );
}

export async function dbLoadStudyBadgeAwards(bookId: string): Promise<StudyBadgeAward[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT badge_json FROM study_badges WHERE book_id = $1 ORDER BY awarded_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.badge_json)) as StudyBadgeAward];
    } catch {
      return [];
    }
  });
}

export async function dbSaveStudyFlashcards(cards: StudyFlashcard[]): Promise<void> {
  const db = await getDb();
  for (const card of cards) {
    await db.execute(
      `INSERT OR REPLACE INTO study_flashcards (id, book_id, card_json, created_at)
       VALUES ($1, $2, $3, $4)`,
      [card.id, card.bookId, JSON.stringify(card), card.createdAt]
    );
  }
}

export async function dbLoadStudyFlashcards(bookId: string): Promise<StudyFlashcard[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT card_json FROM study_flashcards WHERE book_id = $1 ORDER BY created_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.card_json)) as StudyFlashcard];
    } catch {
      return [];
    }
  });
}

// ─── Image Cache ──────────────────────────────────────────────────────────────

export async function dbSaveImageCache(image: CachedImage): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO image_cache
     (id, book_id, scene_id, visual_slot_key, word_position, file_path, description_used, style_seed, generated_at, generation_api, emotional_themes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      image.id,
      image.bookId,
      image.sceneId,
      image.visualSlotKey ?? null,
      typeof image.wordPosition === "number" ? image.wordPosition : null,
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
  return rows.map(rowToCachedImage);
}

export async function dbLoadImageCacheForBookPrefix(bookId: string): Promise<CachedImage[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`,
    [bookId, `${bookId}::%`]
  );
  return rows.map(rowToCachedImage);
}

function rowToCachedImage(row: Record<string, unknown>): CachedImage {
  const wordPositionRaw = row.word_position;
  const wordPosition =
    typeof wordPositionRaw === "number"
      ? wordPositionRaw
      : wordPositionRaw != null && wordPositionRaw !== ""
        ? Number(wordPositionRaw)
        : undefined;

  return {
    id: String(row.id),
    bookId: String(row.book_id),
    sceneId: String(row.scene_id),
    ...(typeof wordPosition === "number" && !Number.isNaN(wordPosition) ? { wordPosition } : {}),
    ...(row.visual_slot_key ? { visualSlotKey: String(row.visual_slot_key) } : {}),
    filePath: String(row.file_path),
    descriptionUsed: String(row.description_used),
    styleSeed: String(row.style_seed) as StyleSeedId,
    generatedAt: String(row.generated_at),
    generationApi: String(row.generation_api) as CachedImage["generationApi"],
    emotionalThemes: JSON.parse(String(row.emotional_themes)),
  };
}

export async function dbDeleteImageCache(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, `${bookId}::%`]);
}

// ─── Audio Cache ──────────────────────────────────────────────────────────────

export async function dbSaveAudioArtifact(artifact: AudioArtifact): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO audio_cache (id, book_id, audio_json, generated_at)
     VALUES ($1, $2, $3, $4)`,
    [artifact.id, artifact.bookId, JSON.stringify(artifact), artifact.generatedAt]
  );
}

export async function dbLoadAudioArtifacts(bookId: string): Promise<AudioArtifact[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT audio_json FROM audio_cache WHERE book_id = $1 ORDER BY generated_at ASC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.audio_json)) as AudioArtifact];
    } catch {
      return [];
    }
  });
}

export async function dbDeleteAudioArtifacts(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM audio_cache WHERE book_id = $1`, [bookId]);
}

// ─── Presentations ────────────────────────────────────────────────────────────

export async function dbSavePresentation(deck: PresentationDeck): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO presentations (id, book_id, deck_json, generated_at)
     VALUES ($1, $2, $3, $4)`,
    [deck.id, deck.bookId, JSON.stringify(deck), deck.generatedAt]
  );
}

export async function dbLoadPresentations(bookId: string): Promise<PresentationDeck[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT deck_json FROM presentations WHERE book_id = $1 ORDER BY generated_at DESC`,
    [bookId]
  );
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.deck_json)) as PresentationDeck];
    } catch {
      return [];
    }
  });
}

export async function dbDeletePresentations(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM presentations WHERE book_id = $1`, [bookId]);
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

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function dbSaveArchiveBook(entry: ArchiveBook): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO archive_books
     (book_id, title, author, archived_at, audio_count, image_count, note_count, presentation_count, badge_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.bookId,
      entry.title,
      entry.author,
      entry.archivedAt,
      entry.audioCount,
      entry.imageCount,
      entry.noteCount,
      entry.presentationCount,
      entry.badgeCount,
    ]
  );
}

export async function dbLoadArchiveBooks(): Promise<ArchiveBook[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM archive_books ORDER BY archived_at DESC`
  );
  return rows.map((row) => ({
    bookId: String(row.book_id),
    title: String(row.title),
    author: String(row.author),
    archivedAt: String(row.archived_at),
    audioCount: Number(row.audio_count ?? 0),
    imageCount: Number(row.image_count ?? 0),
    noteCount: Number(row.note_count ?? 0),
    presentationCount: Number(row.presentation_count ?? 0),
    badgeCount: Number(row.badge_count ?? 0),
  }));
}

export async function dbDeleteArchiveBook(bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM archive_books WHERE book_id = $1`, [bookId]);
}

/** Remove reading/analysis data but keep archived artifacts (audio, images, notes, presentations, badges). */
export async function dbArchiveAndRemoveBook(bookId: string): Promise<void> {
  const db = await getDb();
  const segmentPrefix = `${bookId}::%`;
  await db.execute(`DELETE FROM books WHERE id = $1`, [bookId]);
  await db.execute(`DELETE FROM book_structures WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM reading_progress WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM highlights WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM semantic_maps WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM book_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM source_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_guides WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_quizzes WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_quiz_attempts WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_flashcards WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM book_settings WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
}

/** Permanently delete every artifact row for a book (archive purge). */
export async function dbPurgeArchivedArtifacts(bookId: string): Promise<void> {
  const db = await getDb();
  const segmentPrefix = `${bookId}::%`;
  await db.execute(`DELETE FROM highlights WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM notes WHERE book_id = $1`, [bookId]);
  await db.execute(`DELETE FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM audio_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM presentations WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM study_badges WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]);
  await db.execute(`DELETE FROM archive_books WHERE book_id = $1`, [bookId]);
}

export async function dbLoadStudyBadgeAwardById(badgeId: string): Promise<StudyBadgeAward | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT badge_json FROM study_badges WHERE id = $1`,
    [badgeId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].badge_json)) as StudyBadgeAward;
  } catch {
    return null;
  }
}

export async function dbDeleteStudyBadgeAward(badgeId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM study_badges WHERE id = $1`, [badgeId]);
}

export async function dbLoadPresentationDeckById(deckId: string): Promise<PresentationDeck | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT deck_json FROM presentations WHERE id = $1`,
    [deckId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].deck_json)) as PresentationDeck;
  } catch {
    return null;
  }
}

export async function dbDeletePresentationDeck(deckId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM presentations WHERE id = $1`, [deckId]);
}

export async function dbLoadAudioArtifactById(audioId: string): Promise<AudioArtifact | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT audio_json FROM audio_cache WHERE id = $1`,
    [audioId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(String(rows[0].audio_json)) as AudioArtifact;
  } catch {
    return null;
  }
}

export async function dbDeleteAudioArtifact(audioId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM audio_cache WHERE id = $1`, [audioId]);
}

export async function dbLoadCachedImageById(imageId: string): Promise<CachedImage | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM image_cache WHERE id = $1`,
    [imageId]
  );
  if (rows.length === 0) return null;
  return rowToCachedImage(rows[0]);
}

export async function dbDeleteCachedImage(imageId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM image_cache WHERE id = $1`, [imageId]);
}

// ─── Bulk delete ──────────────────────────────────────────────────────────────

/** Delete all data rows for a book across every table. File cleanup is the caller's responsibility. */
export async function dbDeleteAllBookData(bookId: string): Promise<void> {
  const db = await getDb();
  const segmentPrefix = `${bookId}::%`;
  const queries = [
    [`DELETE FROM books WHERE id = $1`, [bookId]],
    [`DELETE FROM reading_progress WHERE book_id = $1`, [bookId]],
    [`DELETE FROM highlights WHERE book_id = $1`, [bookId]],
    [`DELETE FROM semantic_maps WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM book_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM blackboard_notes WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM source_profiles WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM study_guides WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM study_quizzes WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM study_quiz_attempts WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM study_flashcards WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM image_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM audio_cache WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM presentations WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
    [`DELETE FROM book_settings WHERE book_id = $1 OR book_id LIKE $2`, [bookId, segmentPrefix]],
  ] as [string, unknown[]][];
  for (const [sql, params] of queries) {
    await db.execute(sql, params).catch(() => {});
  }
}

// ─── Open Shelf download ledger ───────────────────────────────────────────────

export interface DbDownloadLedgerEntry {
  gutenbergId: number;
  title: string;
  author: string;
  anchor?: string;
  filename?: string;
  downloadUrl?: string;
  downloadedAt?: string;
  downloadConfirmedAt?: string;
  downloadStatus?: string;
  importedAt?: string;
}

export async function dbLoadDownloadLedger(): Promise<DbDownloadLedgerEntry[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM download_ledger ORDER BY COALESCE(downloaded_at, imported_at) DESC`
  );

  return rows.map((row) => ({
    gutenbergId: Number(row.gutenberg_id),
    title: String(row.title),
    author: String(row.author),
    anchor: row.anchor ? String(row.anchor) : undefined,
    filename: row.filename ? String(row.filename) : undefined,
    downloadUrl: row.download_url ? String(row.download_url) : undefined,
    downloadedAt: row.downloaded_at ? String(row.downloaded_at) : undefined,
    downloadConfirmedAt: row.download_confirmed_at ? String(row.download_confirmed_at) : undefined,
    downloadStatus: row.download_status ? String(row.download_status) : undefined,
    importedAt: row.imported_at ? String(row.imported_at) : undefined,
  }));
}

export async function dbSaveDownloadLedger(entries: DbDownloadLedgerEntry[]): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM download_ledger`);
  for (const entry of entries) {
    await db.execute(
      `INSERT OR REPLACE INTO download_ledger
       (gutenberg_id, title, author, anchor, filename, download_url, downloaded_at, download_confirmed_at, download_status, imported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.gutenbergId,
        entry.title,
        entry.author,
        entry.anchor ?? null,
        entry.filename ?? null,
        entry.downloadUrl ?? null,
        entry.downloadedAt ?? null,
        entry.downloadConfirmedAt ?? null,
        entry.downloadStatus ?? null,
        entry.importedAt ?? null,
      ]
    );
  }
}

export async function dbClearDownloadLedger(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM download_ledger`);
}
