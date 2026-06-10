import { FolderOpen } from "lucide-react";

export default function ManualImportInstructions({
  compact,
  iconsOnly,
}: {
  compact?: boolean;
  /** Symbol-first rows without spelling out browser names. */
  iconsOnly?: boolean;
}) {
  const text = compact || iconsOnly ? "text-[10px]" : "text-[11px]";

  if (iconsOnly) {
    return (
      <div className={`space-y-2 leading-relaxed text-ink-faint ${text}`}>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-hair bg-ink/[0.06] text-sm text-ink-soft"
            title="Safari"
            aria-hidden
          >
            ↓
          </span>
          <p>Tap the download arrow in the address bar, then open the file.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-hair bg-ink/[0.06] text-base leading-none text-ink-soft"
            title="Chrome"
            aria-hidden
          >
            ⋮
          </span>
          <p>Menu → Downloads, then tap the file.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-hair bg-ink/[0.06] text-ink-soft"
            title="Files"
            aria-hidden
          >
            <FolderOpen size={13} strokeWidth={1.75} />
          </span>
          <p>Browse → Downloads, or search the filename above.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 leading-relaxed text-ink-faint ${text}`}>
      <p>
        <span className="text-ink-soft">↓</span> Address bar download, then tap the file.
      </p>
      <p>
        <span className="text-ink-soft">⋮</span> Menu → Downloads, then tap the file.
      </p>
      <p className="flex items-center gap-1">
        <FolderOpen size={11} className="text-ink-soft" />
        Browse → Downloads, or search the filename above.
      </p>
    </div>
  );
}
