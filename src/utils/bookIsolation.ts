/**
 * bookIsolation.ts
 *
 * Hard walls between books. Every book's semantic data (scenes, visual lore)
 * must stay in its own container — one book's lore must never reach another
 * book's image prompts. This is the governance layer that prevents cross-book
 * contamination (e.g. Red Rising lore surfacing inside The Great Gatsby).
 *
 * The visual-lore dossier is the proven contamination carrier: it is stamped
 * with the bookId it was built for, so any dossier whose bookId disagrees with
 * its host map is foreign and is stripped. Scenes are NOT filtered here — scene
 * ids are not uniformly book-stamped (some are keyed by inflection point), so
 * dropping by id would risk removing valid scenes. Scene-level contamination is
 * healed by re-ingesting the affected book.
 */

import { diagnosticWarn } from "@/utils/diagnostics";
import type { SemanticMap, VisualLoreDossier } from "@/types";

/** A visual-lore dossier may be used only with the book it was built for. */
export function loreBelongsToBook(
  lore: VisualLoreDossier | undefined,
  bookId: string
): lore is VisualLoreDossier {
  return !!lore && lore.bookId === bookId;
}

/**
 * Return the dossier only if it belongs to `bookId`, otherwise undefined.
 * Use this anywhere lore feeds an image prompt so a foreign dossier can never
 * contaminate generation.
 */
export function loreForBook(
  lore: VisualLoreDossier | undefined,
  bookId: string
): VisualLoreDossier | undefined {
  return loreBelongsToBook(lore, bookId) ? lore : undefined;
}

/**
 * Return a semantic map guaranteed to carry only data belonging to `bookId`.
 * Strips a foreign visual-lore dossier and normalizes the map's own bookId to
 * the storage key (the source of truth). Logs whenever it removes/corrects
 * something so a leak is never silent. Returns the same reference when clean.
 */
export function sanitizeMapForBook(map: SemanticMap, bookId: string): SemanticMap {
  let next = map;
  if (map.visualLore && map.visualLore.bookId !== bookId) {
    diagnosticWarn("isolation.foreign_lore_stripped", "Removed foreign visual lore from a book's semantic map", {
      mapBookId: map.bookId,
      expectedBookId: bookId,
      foreignLoreBookId: map.visualLore.bookId,
      entities: map.visualLore.entities.length,
    });
    next = { ...next, visualLore: undefined };
  }
  if (next.bookId !== bookId) {
    diagnosticWarn("isolation.map_bookid_corrected", "Semantic map bookId did not match its storage key", {
      mapBookId: map.bookId,
      expectedBookId: bookId,
    });
    next = { ...next, bookId };
  }
  return next;
}
