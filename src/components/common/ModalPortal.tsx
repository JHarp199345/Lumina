import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Render overlays on document.body so panel overflow/transform cannot clip them. */
export default function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
