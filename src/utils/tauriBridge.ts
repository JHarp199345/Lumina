/**
 * Tauri Bridge — typed wrappers around all Rust invoke calls.
 * All backend communication goes through this file.
 */

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function ensureTauriRuntime(action: string): void {
  if (isTauriRuntime()) return;
  throw new Error(
    `${action} needs the Lumina desktop shell. The localhost browser view can show the interface, but it cannot open, copy, or save EPUB files. Start Lumina with "npm run tauri dev" and use the desktop window.`
  );
}

// ─── Asset URL Conversion ─────────────────────────────────────────────────────

/**
 * Converts a local filesystem path (or existing file:// URL) to a URL the
 * WebView can load safely on all platforms.
 *
 * On desktop: returns an asset:// URL served by the Tauri asset protocol.
 * On Android: returns an https://asset.localhost URL that works in the Android
 *             WebView, bypassing the file:// restriction on Android 10+.
 *
 * Always use this when rendering locally-cached image files in <img> tags.
 */
export function toAssetUrl(filePath: string): string {
  // Strip a legacy file:// prefix so convertFileSrc always receives a raw path.
  const rawPath = filePath.startsWith("file://")
    ? filePath.slice("file://".length)
    : filePath;
  return convertFileSrc(rawPath);
}

// ─── File System ──────────────────────────────────────────────────────────────

export async function readFileBytes(path: string): Promise<Uint8Array> {
  ensureTauriRuntime("Reading an EPUB file");
  const bytes = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(bytes);
}

export async function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  ensureTauriRuntime("Writing a file");
  await invoke("write_file_bytes", { path, data: Array.from(data) });
}

export async function fileExists(path: string): Promise<boolean> {
  ensureTauriRuntime("Checking a file");
  return invoke<boolean>("file_exists", { path });
}

export async function deleteFile(path: string): Promise<void> {
  ensureTauriRuntime("Deleting a file");
  await invoke("delete_file", { path });
}

export async function deleteDirectory(path: string): Promise<void> {
  ensureTauriRuntime("Deleting a directory");
  await invoke("delete_directory", { path });
}

export async function getAppDataDir(): Promise<string> {
  ensureTauriRuntime("Opening Lumina storage");
  return invoke<string>("get_app_data_dir");
}

export async function copyFileToAppData(
  sourcePath: string,
  relativeDest: string
): Promise<string> {
  ensureTauriRuntime("Copying a book into Lumina");
  return invoke<string>("copy_file_to_app_data", {
    sourcePath,
    relativeDest,
  });
}

// ─── API Key Store ────────────────────────────────────────────────────────────

export async function storeApiKey(keyName: string, keyValue: string): Promise<void> {
  ensureTauriRuntime("Saving an API key");
  await invoke("store_api_key", { keyName, keyValue });
}

export async function getApiKey(keyName: string): Promise<string | null> {
  ensureTauriRuntime("Reading an API key");
  return invoke<string | null>("get_api_key", { keyName });
}

export async function deleteApiKey(keyName: string): Promise<void> {
  ensureTauriRuntime("Deleting an API key");
  await invoke("delete_api_key", { keyName });
}

// ─── File Dialog ──────────────────────────────────────────────────────────────

export async function openEpubDialog(): Promise<string | null> {
  ensureTauriRuntime("Opening the EPUB picker");
  const result = await open({
    multiple: false,
    filters: [{ name: "EPUB Books", extensions: ["epub"] }],
    title: "Open EPUB Book",
  });

  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result[0] ?? null;
  return null;
}
