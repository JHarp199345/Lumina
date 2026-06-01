/**
 * Tauri Bridge — typed wrappers around all Rust invoke calls.
 * All backend communication goes through this file.
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ─── File System ──────────────────────────────────────────────────────────────

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(bytes);
}

export async function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  await invoke("write_file_bytes", { path, data: Array.from(data) });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

export async function deleteFile(path: string): Promise<void> {
  await invoke("delete_file", { path });
}

export async function deleteDirectory(path: string): Promise<void> {
  await invoke("delete_directory", { path });
}

export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}

export async function copyFileToAppData(
  sourcePath: string,
  relativeDest: string
): Promise<string> {
  return invoke<string>("copy_file_to_app_data", {
    sourcePath,
    relativeDest,
  });
}

// ─── API Key Store ────────────────────────────────────────────────────────────

export async function storeApiKey(keyName: string, keyValue: string): Promise<void> {
  await invoke("store_api_key", { keyName, keyValue });
}

export async function getApiKey(keyName: string): Promise<string | null> {
  return invoke<string | null>("get_api_key", { keyName });
}

export async function deleteApiKey(keyName: string): Promise<void> {
  await invoke("delete_api_key", { keyName });
}

// ─── File Dialog ──────────────────────────────────────────────────────────────

export async function openEpubDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [{ name: "EPUB Books", extensions: ["epub"] }],
    title: "Open EPUB Book",
  });

  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result[0] ?? null;
  return null;
}
