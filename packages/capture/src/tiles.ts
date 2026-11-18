import type { CaptureTruncation } from "@flawdot/core-model";

// Pure geometry: how tall the picture of a page may be, how it is cut into tiles for the AI, and what is recorded
// when something was left out. Nothing here touches a browser.

/**
 * The largest side, in pixels of the picture, that Chromium draws in one piece. A page that is taller at the pixel
 * ratio of the screen (2x makes it twice as tall) makes the screenshot fail, so the cut is worked out before.
 */
export const MAX_TEXTURE_PX = 16_384;

/** A tile starts at 90% of the screen below the one before it, so two tiles share 10% of the screen. */
export const TILE_STRIDE_RATIO = 0.9;

/** The tallest the picture may be, in CSS pixels: the limit of the user, or what the browser can draw. */
export function maxCutHeight(limits: { maxHeight: number }, deviceScaleFactor: number): number {
  return Math.floor(Math.min(limits.maxHeight, MAX_TEXTURE_PX / deviceScaleFactor));
}

/** The widest the picture may be, in CSS pixels. */
export function maxCutWidth(deviceScaleFactor: number): number {
  return Math.floor(MAX_TEXTURE_PX / deviceScaleFactor);
}

export interface TileRange {
  index: number;
  /** CSS pixels from the top of the page. */
  top: number;
  height: number;
}

/**
 * The tiles of a page, each as tall as the screen, from the top down. The last one ends exactly at the end of the
 * page: it is moved up and not made shorter, so no tile is a sliver, at the price of a bigger overlap with the one
 * before it. A page not taller than the screen is one tile as tall as the page.
 */
export function planTiles(pageHeight: number, screenHeight: number): TileRange[] {
  if (pageHeight <= screenHeight) return [{ index: 0, top: 0, height: pageHeight }];
  const stride = Math.max(1, Math.floor(screenHeight * TILE_STRIDE_RATIO));
  const tiles: TileRange[] = [];
  for (let top = 0; top + screenHeight < pageHeight; top += stride) {
    tiles.push({ index: tiles.length, top, height: screenHeight });
  }
  tiles.push({ index: tiles.length, top: pageHeight - screenHeight, height: screenHeight });
  return tiles;
}

/** What to record about what was left out; nothing, when nothing was. */
export function buildTruncation(counts: {
  found: number;
  kept: number;
  scanStopped: boolean;
  fullHeight: number;
  keptHeight: number;
}): CaptureTruncation | undefined {
  const height =
    counts.keptHeight < counts.fullHeight
      ? { fullHeight: counts.fullHeight, keptHeight: counts.keptHeight }
      : undefined;
  const elements =
    counts.kept < counts.found || counts.scanStopped
      ? { found: counts.found, kept: counts.kept, scanStopped: counts.scanStopped }
      : undefined;
  if (height === undefined && elements === undefined) return undefined;
  return {
    ...(height === undefined ? {} : { height }),
    ...(elements === undefined ? {} : { elements }),
  };
}
