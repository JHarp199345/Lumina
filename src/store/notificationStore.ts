/**
 * notificationStore — the per-book "what's new" ledger.
 *
 * Background work (audio overview / study guide / presentation generation,
 * re-ingest, and their failures) raises notifications here via `notify(...)`.
 * Each is persisted through the StorageAdapter so it survives reloads, and
 * surfaced at three levels:
 *   1. the rail badge        — total unread for the active book
 *   2. the drawer menu       — which feature is new (unreadByFeature)
 *   3. the feature view      — marked read on open ("what's new" cleared)
 *
 * The store mirrors only the active book's notifications in memory; a notify for
 * a different (or not-yet-open) book is still persisted and appears when that
 * book is opened via `loadForBook`. See PLANxi.md.
 */

import { create } from "zustand";
import { storage } from "@/storage";
import type { LuminaNotification, NotificationFeature, NotificationKind } from "@/types";

export interface NotifyInput {
  bookId: string;
  feature: NotificationFeature;
  kind?: NotificationKind; // defaults to "success"
  title: string;
  detail?: string;
  artifactId?: string;
}

interface NotificationStore {
  bookId: string | null;
  notifications: LuminaNotification[]; // active book only, newest first

  loadForBook: (bookId: string) => Promise<void>;
  notify: (input: NotifyInput) => Promise<void>;
  markFeatureRead: (feature: NotificationFeature) => Promise<void>;
  markAllRead: () => Promise<void>;
  clear: () => void;
}

export const useNotificationStore = create<NotificationStore>()((set, get) => ({
  bookId: null,
  notifications: [],

  loadForBook: async (bookId) => {
    const all = await storage.loadNotifications(bookId).catch(() => []);
    set({
      bookId,
      notifications: [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  },

  notify: async (input) => {
    const notification: LuminaNotification = {
      id: `nt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      bookId: input.bookId,
      feature: input.feature,
      kind: input.kind ?? "success",
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      read: false,
      createdAt: new Date().toISOString(),
    };
    await storage.saveNotification(notification).catch(() => {});
    // Mirror in memory only when it belongs to the book currently on screen.
    if (get().bookId === input.bookId) {
      set((s) => ({ notifications: [notification, ...s.notifications] }));
    }
  },

  markFeatureRead: async (feature) => {
    const ids = get()
      .notifications.filter((n) => n.feature === feature && !n.read)
      .map((n) => n.id);
    if (ids.length === 0) return;
    await storage.markNotificationsRead(ids).catch(() => {});
    set((s) => ({
      notifications: s.notifications.map((n) =>
        ids.includes(n.id) ? { ...n, read: true } : n
      ),
    }));
  },

  markAllRead: async () => {
    const ids = get().notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    await storage.markNotificationsRead(ids).catch(() => {});
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
  },

  clear: () => set({ bookId: null, notifications: [] }),
}));

// ─── Selectors (plain helpers over a notifications array) ────────────────────────

export function unreadCount(notifications: LuminaNotification[]): number {
  return notifications.reduce((sum, n) => sum + (n.read ? 0 : 1), 0);
}

/** Map of feature → count of unread notifications for that feature. */
export function unreadByFeature(
  notifications: LuminaNotification[]
): Partial<Record<NotificationFeature, number>> {
  const out: Partial<Record<NotificationFeature, number>> = {};
  for (const n of notifications) {
    if (n.read) continue;
    out[n.feature] = (out[n.feature] ?? 0) + 1;
  }
  return out;
}
