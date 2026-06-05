import { useCallback, useState } from "react";
import { storage } from "@/storage";
import { useSettingsStore } from "@/store/settingsStore";

const GOOGLE_KEY_NAME = "lumina_google_ai_key";
const FAL_KEY_NAME = "lumina_fal_key";

export function useApiKeys() {
  const { setApiKeyConfigured } = useSettingsStore();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveGoogleKey = useCallback(
    async (key: string) => {
      setIsSaving(true);
      setError(null);
      try {
        const normalizedKey = key.trim();

        // Google has used more than one key shape over time. Avoid hard-coding a
        // prefix and let the API tell us whether the key can actually be used.
        if (normalizedKey.length < 20 || /\s/.test(normalizedKey)) {
          throw new Error("That key looks incomplete. Paste the full Google AI Studio key.");
        }

        // Test key with a minimal Gemini call
        const valid = await testGoogleKey(normalizedKey);
        if (!valid) {
          throw new Error("Key validation failed. Please check your Google AI Studio key.");
        }

        await storage.saveApiKey(GOOGLE_KEY_NAME, normalizedKey);
        setApiKeyConfigured(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save key");
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [setApiKeyConfigured]
  );

  const saveFalKey = useCallback(async (key: string) => {
    await storage.saveApiKey(FAL_KEY_NAME, key);
  }, []);

  const getGoogleKey = useCallback(async (): Promise<string | null> => {
    return storage.loadApiKey(GOOGLE_KEY_NAME);
  }, []);

  const getFalKey = useCallback(async (): Promise<string | null> => {
    return storage.loadApiKey(FAL_KEY_NAME);
  }, []);

  const removeGoogleKey = useCallback(async () => {
    await storage.deleteApiKey(GOOGLE_KEY_NAME);
    setApiKeyConfigured(false);
  }, [setApiKeyConfigured]);

  const removeFalKey = useCallback(async () => {
    await storage.deleteApiKey(FAL_KEY_NAME);
  }, []);

  return {
    saveGoogleKey,
    saveFalKey,
    getGoogleKey,
    getFalKey,
    removeGoogleKey,
    removeFalKey,
    isSaving,
    error,
  };
}

// ─── Key Validation ───────────────────────────────────────────────────────────

async function testGoogleKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { method: "GET" }
    );
    return response.ok;
  } catch {
    return false;
  }
}
