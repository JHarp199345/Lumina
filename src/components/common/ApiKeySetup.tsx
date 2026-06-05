import { useState } from "react";
import { motion } from "framer-motion";
import { Key, ExternalLink, CheckCircle, AlertCircle, Loader, Trash2 } from "lucide-react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useSettingsStore } from "@/store/settingsStore";

interface ApiKeySetupProps {
  onComplete: () => void;
  isOnboarding?: boolean;
}

export default function ApiKeySetup({ onComplete, isOnboarding = false }: ApiKeySetupProps) {
  const [googleKey, setGoogleKey] = useState("");
  const [falKey, setFalKey] = useState("");
  const [success, setSuccess] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const { saveGoogleKey, saveFalKey, removeGoogleKey, removeFalKey, isSaving, error } = useApiKeys();
  const { apiKeyConfigured } = useSettingsStore();

  const handleSave = async () => {
    if (!googleKey.trim()) return;
    try {
      await saveGoogleKey(googleKey.trim());
      if (falKey.trim()) {
        await saveFalKey(falKey.trim());
      }
      setSuccess(true);
      setTimeout(onComplete, 1200);
    } catch {
      // error shown via hook
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {isOnboarding && (
        <div className="space-y-1">
          <h2 className="text-ink/80 font-medium text-sm">Connect your API key</h2>
          <p className="text-ink-faint text-xs leading-relaxed">
            Lumina uses Google AI Studio to analyze books and generate imagery. Your key is stored
            locally and never shared.
          </p>
        </div>
      )}

      {/* Google AI Key */}
      <div className="space-y-2">
        <label className="text-xs text-ink-soft flex items-center gap-2">
          <Key size={11} />
          Google AI Studio Key
          <span className="text-red-400/60">required</span>
        </label>
        <input
          type="password"
          value={googleKey}
          onChange={(e) => setGoogleKey(e.target.value)}
          placeholder="AIzaSy••••••••••••••••••••••••••••"
          className="w-full bg-black/30 border border-hair rounded-lg px-3 py-2.5 text-sm text-ink-soft placeholder:text-ink-faint focus:outline-none focus:border-lumina-gold/50 transition-colors font-mono"
        />
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-lumina-gold/60 hover:text-lumina-gold transition-colors"
        >
          Get a free key at Google AI Studio
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Fal.ai Key (optional) */}
      <div className="space-y-2">
        <label className="text-xs text-ink-faint flex items-center gap-2">
          <Key size={11} />
          fal.ai Key
          <span className="text-ink-faint">optional — fallback image generation</span>
        </label>
        <input
          type="password"
          value={falKey}
          onChange={(e) => setFalKey(e.target.value)}
          placeholder="••••••••••••••••••••••••"
          className="w-full bg-black/20 border border-hair rounded-lg px-3 py-2.5 text-sm text-ink-faint placeholder:text-ink-faint focus:outline-none focus:border-hair transition-colors font-mono"
        />
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg"
        >
          <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">{error}</p>
        </motion.div>
      )}

      {/* Success */}
      {success && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg"
        >
          <CheckCircle size={13} className="text-green-400 flex-shrink-0" />
          <p className="text-xs text-green-400">Key validated and saved.</p>
        </motion.div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!googleKey.trim() || isSaving || success}
        className="w-full py-2.5 rounded-lg bg-lumina-gold/20 text-lumina-gold text-sm font-medium hover:bg-lumina-gold/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isSaving ? (
          <>
            <Loader size={13} className="animate-spin" />
            Validating…
          </>
        ) : success ? (
          <>
            <CheckCircle size={13} />
            Saved
          </>
        ) : (
          "Save & Validate Key"
        )}
      </button>

      {/* Remove key — only shown when a key is already configured */}
      {apiKeyConfigured && !isOnboarding && (
        <button
          onClick={async () => {
            setIsRemoving(true);
            try {
              await removeGoogleKey();
              await removeFalKey().catch(() => {});
              setGoogleKey("");
              setFalKey("");
            } finally {
              setIsRemoving(false);
            }
          }}
          disabled={isRemoving}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/8 transition-colors disabled:opacity-40"
        >
          {isRemoving ? <Loader size={11} className="animate-spin" /> : <Trash2 size={11} />}
          Remove stored key
        </button>
      )}

      <p className="text-xs text-ink-faint leading-relaxed">
        Your key is stored locally on this device in Lumina's private data directory. It is never
        transmitted except directly to Google's API.
      </p>
    </motion.div>
  );
}
