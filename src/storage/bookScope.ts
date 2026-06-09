/** Whether a stored row belongs to a library book or one of its collection segments. */
export function matchesBookScope(recordBookId: string, bookId: string): boolean {
  return recordBookId === bookId || recordBookId.startsWith(`${bookId}::`);
}
