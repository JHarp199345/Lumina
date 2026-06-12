/**
 * Lightweight localStorage utilities for per-style-seed generated thumbnails.
 * Kept separate from imageGenerator so SettingsPanel doesn't pull in the
 * full image generation pipeline (llmClient, storage, visualDirector, etc.).
 */

const THUMBS_MAX = 5;

export interface StyleThumbStore {
  thumbs: string[];      // JPEG data URLs, newest first
  pinned: string | null; // if set, always used in the picker
}

export const STYLE_THUMBS_KEY = (id: string) => `lumina:style_thumbs:${id}`;

export function loadStyleThumbs(id: string): StyleThumbStore {
  try {
    const raw = localStorage.getItem(STYLE_THUMBS_KEY(id));
    if (raw) return JSON.parse(raw) as StyleThumbStore;
  } catch { /* ignore */ }
  return { thumbs: [], pinned: null };
}

export function saveStyleThumbStore(id: string, store: StyleThumbStore): void {
  try {
    localStorage.setItem(STYLE_THUMBS_KEY(id), JSON.stringify(store));
  } catch { /* ignore quota errors */ }
}

/** Toggle pin on a thumbnail. Tap same thumb again to unpin. */
export function pinStyleThumb(id: string, thumb: string): void {
  const store = loadStyleThumbs(id);
  store.pinned = store.pinned === thumb ? null : thumb;
  saveStyleThumbStore(id, store);
  window.dispatchEvent(new CustomEvent("lumina:thumbs_updated"));
}

/** Return pinned thumb if valid, else a random one, else null. */
export function getDisplayThumb(id: string): string | null {
  const { thumbs, pinned } = loadStyleThumbs(id);
  if (pinned && thumbs.includes(pinned)) return pinned;
  if (thumbs.length === 0) return null;
  return thumbs[Math.floor(Math.random() * thumbs.length)];
}

/** Prepend a new thumb to the stored array (capped at THUMBS_MAX). */
export function appendStyleThumb(id: string, thumbDataUrl: string): void {
  const store = loadStyleThumbs(id);
  store.thumbs = [thumbDataUrl, ...store.thumbs.filter((t) => t !== thumbDataUrl)].slice(0, THUMBS_MAX);
  if (store.pinned && !store.thumbs.includes(store.pinned)) store.pinned = null;
  saveStyleThumbStore(id, store);
  window.dispatchEvent(new CustomEvent("lumina:thumbs_updated"));
}
