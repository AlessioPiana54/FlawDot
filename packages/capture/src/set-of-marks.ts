import {
  SELECTOR_MAX,
  markIdSchema,
  truncateElementName,
  type Box,
  type Element,
} from "@flawdot/core-model";

// The set-of-marks: which elements of a page get a number, and which number. This file is pure: the browser only
// reports what it found (`RawElement`), and every decision is taken here, where it can be tested without a browser.

export type RawKind = "interactive" | "heading" | "image" | "text";

/** What the page reported about one element, before any decision about it. */
export interface RawElement {
  /** Position in document order. It breaks every tie, so two captures of one page number it the same way. */
  domIndex: number;
  kind: RawKind;
  selector: string;
  tag: string;
  role: string | null;
  name: string | null;
  /** CSS pixels, coordinates of the whole page. */
  box: Box;
}

/** When there is no room for every element, a lower number is kept first. */
export const KIND_PRIORITY: Readonly<Record<RawKind, number>> = {
  interactive: 0,
  heading: 1,
  image: 2,
  text: 3,
};

/**
 * Elements whose tops are in the same band of this height count as one row and are numbered left to right. A band
 * absorbs the half-pixel jitter of a layout, which would otherwise swap two elements between two captures.
 */
export const ROW_BUCKET_PX = 10;

// This file does not rely on raw.ts having checked the numbers, so it stays correct on its own.
function hasUsableBox(box: Box): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function isUsable(element: RawElement): boolean {
  return (
    element.selector !== "" && element.selector.length <= SELECTOR_MAX && hasUsableBox(element.box)
  );
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const byDocument = (a: RawElement, b: RawElement): number =>
  a.domIndex - b.domIndex || (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0);

const byPriority = (a: RawElement, b: RawElement): number =>
  KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.domIndex - b.domIndex;

const byReadingOrder = (a: RawElement, b: RawElement): number =>
  Math.floor(a.box.y / ROW_BUCKET_PX) - Math.floor(b.box.y / ROW_BUCKET_PX) ||
  a.box.x - b.box.x ||
  a.domIndex - b.domIndex;

function cleanName(name: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" ? null : truncateElementName(trimmed);
}

/**
 * Turns what the page reported into the elements of a capture, in three steps that always run in this order:
 * choose (drop what cannot be used, and what does not fit in `maxElements`, least important first), order (reading
 * order) and number (1 to N with no gap). The cap is part of the sequence from the start, so a page under the cap
 * gets the same numbers whether the cap is on or off.
 *
 * Whatever order the records arrive in, the result is the same.
 */
export function numberElements(raw: readonly RawElement[], maxElements: number): Element[] {
  // Position in the document decides which of two records for the same place or the same selector survives.
  const seenIndexes = new Set<number>();
  const seenSelectors = new Set<string>();
  const usable: RawElement[] = [];
  for (const element of raw.filter(isUsable).sort(byDocument)) {
    if (seenIndexes.has(element.domIndex) || seenSelectors.has(element.selector)) continue;
    seenIndexes.add(element.domIndex);
    seenSelectors.add(element.selector);
    usable.push(element);
  }

  const kept = usable.length > maxElements ? usable.sort(byPriority).slice(0, maxElements) : usable;

  return kept.sort(byReadingOrder).map((element, index): Element => ({
    mark: markIdSchema.parse(index + 1),
    selector: element.selector,
    tag: element.tag,
    role: element.role,
    name: cleanName(element.name),
    box: {
      x: round2(element.box.x),
      y: round2(element.box.y),
      width: round2(element.box.width),
      height: round2(element.box.height),
    },
  }));
}
