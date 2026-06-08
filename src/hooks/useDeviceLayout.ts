/**
 * useDeviceLayout — detects desktop vs. tablet/phone, and portrait vs. landscape.
 *
 * Tablet = touch-primary device (pointer: coarse) whose shorter screen
 * dimension is >= 550px (rules out phones, which are typically 360-430px wide).
 *
 * Returns:
 *   mode: "desktop" | "tablet-landscape" | "tablet-portrait" | "phone"
 *   isTablet: boolean
 *   isPhone: boolean
 *   isPortrait: boolean
 */

import { useState, useEffect } from "react";

export type LayoutMode = "desktop" | "tablet-landscape" | "tablet-portrait" | "phone";

export interface DeviceLayout {
  mode: LayoutMode;
  isTablet: boolean;
  isPhone: boolean;
  isPortrait: boolean;
}

function detectLayout(): DeviceLayout {
  const isTouchPrimary = window.matchMedia("(pointer: coarse)").matches;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isPortrait = height > width;
  const shortestDim = Math.min(width, height);

  // Tablets have a coarse pointer and a shortest dimension >= 550px.
  const isTablet = isTouchPrimary && shortestDim >= 550;
  const isPhone = isTouchPrimary && shortestDim < 550;

  if (isPhone) {
    return { mode: "phone", isTablet: false, isPhone: true, isPortrait };
  }

  if (!isTablet) {
    return { mode: "desktop", isTablet: false, isPhone: false, isPortrait };
  }

  return {
    mode: isPortrait ? "tablet-portrait" : "tablet-landscape",
    isTablet: true,
    isPhone: false,
    isPortrait,
  };
}

export function useDeviceLayout(): DeviceLayout {
  const [layout, setLayout] = useState<DeviceLayout>(detectLayout);

  useEffect(() => {
    const update = () => setLayout(detectLayout());

    window.addEventListener("resize", update);
    // orientationchange fires before resize on most mobile browsers
    window.addEventListener("orientationchange", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return layout;
}
