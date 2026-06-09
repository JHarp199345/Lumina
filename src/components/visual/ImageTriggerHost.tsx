import { memo } from "react";
import { useReadPosition } from "@/hooks/useReadPosition";
import { useImageTrigger } from "@/hooks/useImageTrigger";

/** Isolates read-position + image triggering from App's analysis/import re-renders. */
const ImageTriggerHost = memo(function ImageTriggerHost() {
  useReadPosition();
  useImageTrigger();
  return null;
});

export default ImageTriggerHost;
