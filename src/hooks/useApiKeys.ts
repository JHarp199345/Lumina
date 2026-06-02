import { useCallback, useState } from "react";
import { storeApiKey, getApiKey, deleteApiKey } from "@/utils/tauriBridge";
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
        // Validate key format
        if (!key.startsWith("AIza") || key.length < 30) {
          throw new Error("Invalid Google AI Studio key format. Keys start with 'AIza'.");
        }

        // Test key with a minimal Gemini call
        const valid = await testGoogleKey(key);
        if (!valid) {
          throw new Error("Key validation failed. Please check your Google AI Studio key.");
        }

        await storeApiKey(GOOGLE_KEY_NAME, key);
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
    await storeApiKey(FAL_KEY_NAME, key);
  }, []);

  const getGoogleKey = useCallback(async (): Promise<string | null> => {
    return getApiKey(GOOGLE_KEY_NAME);
  }, []);

  const getFalKey = useCallback(async (): Promise<string | null> => {
    return getApiKey(FAL_KEY_NAME);
  }, []);

  const removeGoogleKey = useCallback(async () => {
    await deleteApiKey(GOOGLE_KEY_NAME);
    setApiKeyConfigured(false);
  }, [setApiKeyConfigured]);

  const removeFalKey = useCallback(async () => {
    await deleteApiKey(FAL_KEY_NAME);
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
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { method: "GET" }
    );
    return response.ok;
  } catch {
    return false;
  }
}
