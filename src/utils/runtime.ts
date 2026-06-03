/**
 * Runtime detector — "tauri" when running inside the Tauri shell,
 * "web" when running as a browser app or installed PWA.
 *
 * Tauri injects `window.__TAURI_INTERNALS__` at startup.
 * Absence means we are in a normal browser / PWA context.
 */

export type Runtime = "tauri" | "web";

export const runtime: Runtime =
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
  "undefined"
    ? "tauri"
    : "web";

export const isTauri = runtime === "tauri";
export const isWeb = runtime === "web";
