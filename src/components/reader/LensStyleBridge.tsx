import { useEffect } from "react";
import { buildLensStyleSheet, useLensStore } from "@/store/lensStore";

export default function LensStyleBridge() {
  const lenses = useLensStore((s) => s.lenses);

  useEffect(() => {
    const id = "lumina-custom-lens-styles";
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = buildLensStyleSheet(lenses);
  }, [lenses]);

  return null;
}
