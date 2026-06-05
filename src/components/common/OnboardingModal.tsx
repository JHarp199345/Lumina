import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, BookOpen, Image, ArrowRight, X } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import ApiKeySetup from "./ApiKeySetup";

interface OnboardingModalProps {
  onComplete: () => void;
}

type OnboardingStep = "welcome" | "api-key" | "ready";

export default function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const { setHasCompletedOnboarding, apiKeyConfigured } = useSettingsStore();

  const handleComplete = () => {
    setHasCompletedOnboarding(true);
    onComplete();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-8"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.1, type: "spring", damping: 25 }}
        className="relative w-full max-w-md bg-surface-dark border border-hair rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Dismiss — skip onboarding entirely. An API key is only needed for image
            generation and can be added later in Settings. */}
        <button
          onClick={handleComplete}
          aria-label="Skip setup"
          title="Skip — add an API key later in Settings"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-ink/[0.08] hover:text-ink-soft"
        >
          <X size={16} />
        </button>

        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <WelcomeStep key="welcome" onNext={() => setStep("api-key")} />
          )}
          {step === "api-key" && (
            <ApiKeyStep
              key="api-key"
              onNext={() => setStep("ready")}
              onSkip={() => setStep("ready")}
            />
          )}
          {step === "ready" && (
            <ReadyStep key="ready" onComplete={handleComplete} />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-8 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full border border-lumina-gold/30 flex items-center justify-center">
          <Sparkles size={18} className="text-lumina-gold" />
        </div>
        <div>
          <h1 className="text-ink/85 font-semibold text-lg">Welcome to Lumina</h1>
          <p className="text-ink-faint text-xs">Symbolic reading, amplified</p>
        </div>
      </div>

      <div className="space-y-3">
        {[
          {
            icon: BookOpen,
            title: "Text first, always",
            desc: "Import any EPUB. Read the way you like.",
          },
          {
            icon: Sparkles,
            title: "Imagery that earns its place",
            desc: "Symbolic visuals appear only at key emotional moments — never constantly.",
          },
          {
            icon: Image,
            title: "Your imagination stays active",
            desc: "Atmospheric and symbolic, not literal. Your mind does the real work.",
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex gap-3 p-3 rounded-xl bg-ink/[0.04]">
            <Icon size={15} className="text-lumina-gold/60 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-ink-soft font-medium">{title}</p>
              <p className="text-xs text-ink-faint leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full py-3 rounded-xl bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30 text-sm font-medium hover:bg-lumina-gold/30 transition-colors flex items-center justify-center gap-2"
      >
        Get Started
        <ArrowRight size={14} />
      </button>
    </motion.div>
  );
}

function ApiKeyStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-8 space-y-4"
    >
      <ApiKeySetup onComplete={onNext} isOnboarding />
      <button
        onClick={onSkip}
        className="w-full py-2 text-xs text-ink-faint hover:text-ink-faint transition-colors"
      >
        Skip for now — I'll add my key in settings
      </button>
    </motion.div>
  );
}

function ReadyStep({ onComplete }: { onComplete: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-8 text-center space-y-6"
    >
      <div className="flex justify-center">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="w-14 h-14 rounded-full border border-lumina-gold/30 flex items-center justify-center"
        >
          <Sparkles size={22} className="text-lumina-gold" />
        </motion.div>
      </div>

      <div className="space-y-2">
        <h2 className="text-ink/80 font-serif text-xl">You're ready</h2>
        <p className="text-ink-faint text-sm leading-relaxed">
          Open a book with the button in the top bar. Choose your visual style and begin.
        </p>
      </div>

      <button
        onClick={onComplete}
        className="w-full py-3 rounded-xl bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30 text-sm font-medium hover:bg-lumina-gold/30 transition-colors"
      >
        Open Lumina
      </button>

      <p className="text-xs text-ink-faint">
        Personal use. Process only books you own. Text is analyzed via your API key — never stored
        by Lumina.
      </p>
    </motion.div>
  );
}
