/**
 * useLongPress — fires a callback after the user holds a touch for `delay` ms.
 * Moving a finger cancels the press, preventing accidental triggers during scroll.
 *
 * Usage:
 *   const longPress = useLongPress(() => setMenuOpen(true));
 *   <div {...longPress}>...</div>
 */

import { useCallback, useRef } from "react";

interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
}

export function useLongPress(callback: () => void, delay = 600): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      callback();
    }, delay);
  }, [callback, delay, cancel]);

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
  };
}
