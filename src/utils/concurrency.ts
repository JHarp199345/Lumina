/**
 * Bounded-concurrency map that preserves input order.
 *
 * Runs `fn` over `items` with at most `limit` calls in flight at once. Used to
 * parallelize independent per-item LLM calls on providers that tolerate
 * concurrency (Gemini — a frontier cloud model), while local/free providers keep
 * to a serial loop. Results come back in the same order as `items`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
