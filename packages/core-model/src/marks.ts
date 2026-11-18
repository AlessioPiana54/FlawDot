import type { Box, Element } from "./domain.js";

/** Two boxes that differ by this much or less (CSS pixels, on any side) are the same box: layout rounds. */
export const BOX_TOLERANCE_PX = 1;

type Marked = Pick<Element, "mark" | "box">;

const isOnPage = (box: Box): boolean =>
  [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;

const sameBox = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) <= BOX_TOLERANCE_PX &&
  Math.abs(a.y - b.y) <= BOX_TOLERANCE_PX &&
  Math.abs(a.width - b.width) <= BOX_TOLERANCE_PX &&
  Math.abs(a.height - b.height) <= BOX_TOLERANCE_PX;

const contains = (outer: Box, inner: Box): boolean =>
  outer.x <= inner.x + BOX_TOLERANCE_PX &&
  outer.y <= inner.y + BOX_TOLERANCE_PX &&
  outer.x + outer.width >= inner.x + inner.width - BOX_TOLERANCE_PX &&
  outer.y + outer.height >= inner.y + inner.height - BOX_TOLERANCE_PX;

/** The best of `candidates` by `better`; a tie goes to the lowest mark number, so the answer does not depend on order. */
function pick<T extends Marked>(
  candidates: readonly T[],
  area: (box: Box) => number,
): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const smaller = area(candidate.box) < area(best.box);
    const tied = area(candidate.box) === area(best.box) && candidate.mark < best.mark;
    if (smaller || tied) best = candidate;
  }
  return best;
}

/**
 * The mark that a box of the page belongs to: the element whose box is the same (within 1 px), or else the smallest
 * element that contains it. A rule analyzer finds an element by its own selector and measures it, but an element
 * can have no mark of its own (a plain `div`, one below the cap or the cut), so the nearest mark that holds it is
 * used. Nothing is returned for a box that is not on the page (no size, or not finite): a hidden element would
 * otherwise "belong" to whatever mark is under its corner.
 *
 * It lives here and not in the analyzer because the numbers come from capture and the reading of them (the order
 * of ties, the tolerance) must be the same for every module that places a finding.
 */
export function markForBox<T extends Marked>(elements: readonly T[], box: Box): T | undefined {
  if (!isOnPage(box)) return undefined;
  const same = elements.filter((element) => sameBox(element.box, box));
  if (same.length > 0) return pick(same, () => 0);
  const holders = elements.filter((element) => contains(element.box, box));
  return pick(holders, (outer) => outer.width * outer.height);
}
