export default function ManualImportInstructions({ compact }: { compact?: boolean }) {
  const text = compact ? "text-[10px]" : "text-[11px]";
  return (
    <div className={`space-y-1.5 leading-relaxed text-ink-faint ${text}`}>
      <p>
        <span className="text-ink-soft">Safari:</span> tap the ↓ icon in the address bar, then tap the file.
      </p>
      <p>
        <span className="text-ink-soft">Chrome:</span> tap ⋮ → Downloads, then tap the file.
      </p>
      <p>
        <span className="text-ink-soft">Files app:</span> Browse → iPhone → Downloads, or search the filename above.
      </p>
      <p className="text-ink-faint/70">
        Chrome on iOS sometimes opens the file in a tab instead of downloading — if that happened, use Safari to
        re-try.
      </p>
    </div>
  );
}
