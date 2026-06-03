/**
 * storage — the singleton StorageAdapter for the current runtime.
 *
 * Import this everywhere instead of calling Tauri IPC or IndexedDB directly:
 *
 *   import { storage } from "@/storage";
 *   await storage.saveBook(book);
 *   const key = await storage.loadApiKey("lumina_google_ai_key");
 *
 * The correct adapter is selected at startup based on runtime detection.
 * All other code is runtime-agnostic.
 */

import { isTauri } from "@/utils/runtime";
import type { StorageAdapter } from "./StorageAdapter";
import { TauriStorageAdapter } from "./TauriStorageAdapter";
import { WebStorageAdapter } from "./WebStorageAdapter";

export const storage: StorageAdapter = isTauri
  ? new TauriStorageAdapter()
  : new WebStorageAdapter();

export type { StorageAdapter };
