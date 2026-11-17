import type { Box } from "./domain.js";
import { FlawDotError } from "./errors.js";

/**
 * The elements that show in one tile of a capture: every element whose box crosses the band of the page that the
 * tile covers, even by one pixel. An element in the overlap of two tiles is in both, with the same mark: marks
 * are numbers of the whole page, not of a tile, so a finding on it can be told apart from a copy of the same one.
 * An element that only touches the top or the bottom edge is not in the picture and is left out.
 *
 * It lives here and not in the capture module because the analyzer that builds the requests cannot depend on
 * capture. The boxes are not changed: they stay in CSS pixels of the whole page, so a reader of the tile image
 * subtracts `tile.top` to find an element in it.
 */
export function elementsInTile<T extends { box: Box }>(
  elements: readonly T[],
  tile: { top: number; height: number },
): T[] {
  if (!(
    Number.isFinite(tile.top) &&
    tile.top >= 0 &&
    Number.isFinite(tile.height) &&
    tile.height > 0
  )) {
    throw new FlawDotError("INTERNAL", "A tile must start at 0 or below and have a height above 0");
  }
  const bottom = tile.top + tile.height;
  return elements.filter(({ box }) => box.y < bottom && box.y + box.height > tile.top);
}
