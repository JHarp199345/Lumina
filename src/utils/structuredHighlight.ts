/**
 * structuredHighlight — character-offset position anchoring for the structured
 * (web) reader, which renders plain text in the top document (no EPUB CFIs).
 *
 * A highlight is anchored by [start, end] character offsets into the page
 * container's textContent. Because a given chapter+page always renders identical
 * text, these offsets are deterministic across reloads. Re-application walks the
 * text nodes and wraps each intersecting segment in a <mark>.
 */

const HL_ATTR = "data-lumina-hl";

export interface SelectionOffsets {
  start: number;
  end: number;
  text: string;
}

/** Compute [start,end] char offsets of the current selection within `container`. */
export function selectionOffsetsWithin(
  container: HTMLElement,
  selection: Selection
): SelectionOffsets | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const start = offsetOf(container, range.startContainer, range.startOffset);
  const end = offsetOf(container, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  const text = selection.toString().trim();
  if (text.length < 2) return null;
  return { start: Math.min(start, end), end: Math.max(start, end), text };
}

/** Character offset of (node, nodeOffset) measured from the start of container text. */
function offsetOf(container: HTMLElement, node: Node, nodeOffset: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n === node) return total + nodeOffset;
    total += (n.textContent ?? "").length;
    n = walker.nextNode();
  }
  // If the node is an element (e.g. range ends at element boundary), approximate.
  if (node.nodeType === Node.ELEMENT_NODE) {
    return total;
  }
  return null;
}

/** Wrap [start,end] within container in <mark> segments carrying id + className. */
export function applyOffsetHighlight(
  container: HTMLElement,
  start: number,
  end: number,
  className: string,
  id: string
): boolean {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  let n = walker.nextNode() as Text | null;
  while (n) {
    const len = n.textContent?.length ?? 0;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    if (nodeEnd > start && nodeStart < end) {
      segments.push({
        node: n,
        from: Math.max(0, start - nodeStart),
        to: Math.min(len, end - nodeStart),
      });
    }
    pos = nodeEnd;
    if (nodeStart >= end) break;
    n = walker.nextNode() as Text | null;
  }
  if (segments.length === 0) return false;

  // Wrap from last to first so earlier offsets stay valid as we mutate.
  for (let i = segments.length - 1; i >= 0; i--) {
    const { node, from, to } = segments[i];
    try {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const mark = document.createElement("mark");
      mark.className = className;
      mark.setAttribute(HL_ATTR, id);
      mark.style.cursor = "pointer";
      range.surroundContents(mark);
    } catch { /* skip a segment that can't be wrapped */ }
  }
  return true;
}

/** Remove all <mark> wrappers for a highlight id, restoring the text. */
export function removeOffsetHighlight(container: HTMLElement, id: string): void {
  const marks = container.querySelectorAll(`mark[${HL_ATTR}="${cssEscape(id)}"]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/** Recolour all <mark> wrappers for a highlight id. */
export function recolorOffsetHighlight(
  container: HTMLElement,
  id: string,
  className: string
): void {
  container
    .querySelectorAll(`mark[${HL_ATTR}="${cssEscape(id)}"]`)
    .forEach((mark) => {
      (mark as HTMLElement).className = className;
    });
}

function cssEscape(value: string): string {
  // Our ids are alphanumeric/underscore; this is a light guard.
  return value.replace(/["\\]/g, "\\$&");
}

export const HIGHLIGHT_LENS_CLASS: Record<string, string> = {
  yellow: "highlight-yellow",
  blue: "highlight-blue",
  green: "highlight-green",
  red: "highlight-red",
};
