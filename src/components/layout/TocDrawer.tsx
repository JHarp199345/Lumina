/**
 * TocDrawer — slides the TOC in from the left as a full-height overlay.
 * Used in tablet portrait mode. Tapping the backdrop dismisses it.
 * Chapter navigation also closes it via the onNavigate callback.
 */

import { motion, AnimatePresence } from "framer-motion";
import TocPanel from "./TocPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which edge the drawer slides in from. Default "left". */
  side?: "left" | "right";
}

export default function TocDrawer({ open, onClose, side = "left" }: Props) {
  const fromLeft = side === "left";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="toc-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute inset-0 bg-scrim z-30"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <motion.div
            key="toc-drawer"
            initial={{ x: fromLeft ? "-100%" : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: fromLeft ? "-100%" : "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className={`absolute top-0 bottom-0 w-72 z-40 flex flex-col shadow-2xl ${
              fromLeft ? "left-0" : "right-0"
            }`}
            aria-label="Table of Contents"
          >
            <TocPanel onNavigate={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
