/**
 * Brief window after Download is tapped. Safari's download sheet typically pulls focus
 * away within a second or two; blurs after this window are ignored as unrelated.
 */
export const DOWNLOAD_HANDOFF_WINDOW_MS = 3000;

/**
 * Watch for the reader leaving Lumina only in the seconds right after a download starts.
 * Listeners are removed after the window expires or on cleanup — no background work.
 */
export function watchAppHandoff(
  onHandoff: () => void,
  windowMs: number = DOWNLOAD_HANDOFF_WINDOW_MS
): () => void {
  let fired = false;
  const startedAt = Date.now();

  const cleanup = () => {
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearTimeout(timer);
  };

  const fire = () => {
    if (fired) return;
    if (Date.now() - startedAt > windowMs) return;
    fired = true;
    onHandoff();
    cleanup();
  };

  const onBlur = () => fire();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") fire();
  };

  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  const timer = window.setTimeout(cleanup, windowMs);

  return cleanup;
}
