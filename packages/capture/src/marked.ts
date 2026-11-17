import type { Page } from "playwright-core";
import { FlawDotError, type Element, type Tile } from "@flawdot/core-model";
import type { Guard } from "./guard.js";
import { addMarkOverlay, removeMarkOverlay } from "./in-page/overlay.js";
import { pngSize } from "./png.js";
import { planTiles } from "./tiles.js";

export interface MarkedInput {
  elements: readonly Element[];
  /** CSS pixels: the width and height of the picture. */
  width: number;
  keptHeight: number;
  screenHeight: number;
  markedPath: string;
  tilePathFor: (index: number) => string;
  guard: Guard;
}

/**
 * Draws the numbers on the page, photographs the whole marked picture and then each tile cut from it, and takes the
 * numbers off again, whatever happens: they must not be left for the analyzers that run later (axe would find them).
 * The marked picture and the tiles are at CSS size, which is what the AI needs, not at the pixel ratio of the screen.
 */
export async function shootMarked(
  page: Page,
  input: MarkedInput,
): Promise<{ marked: { path: string }; tiles: Tile[] }> {
  const { guard } = input;
  const shoot = async (path: string, top: number, height: number) =>
    pngSize(
      await guard(
        page.screenshot({
          path,
          fullPage: true,
          clip: { x: 0, y: top, width: input.width, height },
          animations: "disabled",
          scale: "css",
        }),
      ),
    );

  const marks = input.elements.map((element) => ({
    mark: Number(element.mark),
    x: element.box.x,
    y: element.box.y,
  }));
  let result: { marked: { path: string }; tiles: Tile[] };
  let left: number | undefined;
  try {
    await guard(page.evaluate(addMarkOverlay, { marks, pageWidth: input.width }));
    await shoot(input.markedPath, 0, input.keptHeight);
    const tiles: Tile[] = [];
    for (const range of planTiles(input.keptHeight, input.screenHeight)) {
      const path = input.tilePathFor(range.index);
      const size = await shoot(path, range.top, range.height);
      tiles.push({
        index: range.index,
        top: range.top,
        height: range.height,
        image: { path, ...size },
      });
    }
    result = { marked: { path: input.markedPath }, tiles };
  } finally {
    // Runs also when a screenshot failed. An error here must not hide the first one, so it is only looked at when
    // everything else went well.
    left = await guard(page.evaluate(removeMarkOverlay)).catch(() => undefined);
  }
  if (left !== 0) {
    throw new FlawDotError("INTERNAL", "The numbers could not be taken off the page.");
  }
  return result;
}
