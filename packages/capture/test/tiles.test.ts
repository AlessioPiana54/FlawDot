import { describe, expect, it } from "vitest";
import {
  MAX_TEXTURE_PX,
  buildTruncation,
  maxCutHeight,
  maxCutWidth,
  planTiles,
} from "../src/tiles.js";

describe("maxCutHeight", () => {
  it("is the limit of the user while the picture is small enough for the browser", () => {
    expect(maxCutHeight({ maxHeight: 15_000 }, 1)).toBe(15_000);
    expect(maxCutHeight({ maxHeight: 3000 }, 4)).toBe(3000);
  });

  it("is what the browser can draw when the limit of the user is more than that: 16384 pixels of the picture", () => {
    expect(MAX_TEXTURE_PX).toBe(16_384);
    expect(maxCutHeight({ maxHeight: 50_000 }, 1)).toBe(16_384);
    expect(maxCutHeight({ maxHeight: 15_000 }, 2)).toBe(8192);
    expect(maxCutHeight({ maxHeight: 15_000 }, 4)).toBe(4096);
  });

  it("rounds down, because the picture must not be a pixel over the limit", () => {
    expect(maxCutHeight({ maxHeight: 15_000 }, 1.5)).toBe(10_922);
    expect(10_922 * 1.5).toBeLessThanOrEqual(MAX_TEXTURE_PX);
  });
});

describe("maxCutWidth", () => {
  it("is what the browser can draw across, at the pixel ratio of the screen", () => {
    expect(maxCutWidth(1)).toBe(16_384);
    expect(maxCutWidth(2)).toBe(8192);
  });
});

describe("planTiles", () => {
  const range = (tops: number[], height: number) =>
    tops.map((top, index) => ({ index, top, height }));

  it("makes one tile for a page as tall as the screen or less, as tall as the page", () => {
    expect(planTiles(900, 900)).toEqual([{ index: 0, top: 0, height: 900 }]);
    expect(planTiles(500, 900)).toEqual([{ index: 0, top: 0, height: 500 }]);
  });

  it("steps down by 90% of the screen, so the tiles overlap by 10%, and ends the last tile at the end of the page", () => {
    expect(planTiles(2400, 900)).toEqual(range([0, 810, 1500], 900));
    expect(planTiles(1500, 900)).toEqual(range([0, 600], 900));
    expect(planTiles(4000, 900)).toEqual(range([0, 810, 1620, 2430, 3100], 900));
  });

  it("gives a second tile for a page one pixel taller than the screen: no tile is ever shorter than the screen", () => {
    expect(planTiles(901, 900)).toEqual(range([0, 1], 900));
  });

  it.each([900, 844, 1024])(
    "covers every page height from 1 to 6000 with no gap, for a screen of %i",
    (screen) => {
      for (let page = 1; page <= 6000; page += 7) {
        const tiles = planTiles(page, screen);
        const first = tiles[0];
        const last = tiles[tiles.length - 1];
        expect(first?.top, `first top of ${String(page)}`).toBe(0);
        expect(last ? last.top + last.height : -1, `end of ${String(page)}`).toBe(page);
        tiles.forEach((tile, index) => {
          expect(tile.index).toBe(index);
          expect(tile.height).toBeLessThanOrEqual(screen);
          const before = tiles[index - 1];
          if (before) {
            expect(tile.top, `tops of ${String(page)}`).toBeGreaterThan(before.top);
            expect(tile.top, `gap in ${String(page)}`).toBeLessThanOrEqual(
              before.top + before.height,
            );
          }
        });
      }
    },
  );
});

describe("buildTruncation", () => {
  const whole = { found: 10, kept: 10, scanStopped: false, fullHeight: 2400, keptHeight: 2400 };

  it("is nothing when nothing was left out", () => {
    expect(buildTruncation(whole)).toBeUndefined();
  });

  it("records a page that was cut", () => {
    expect(buildTruncation({ ...whole, fullHeight: 9000, keptHeight: 8192 })).toEqual({
      height: { fullHeight: 9000, keptHeight: 8192 },
    });
  });

  it("records elements left out by the cap", () => {
    expect(buildTruncation({ ...whole, found: 160, kept: 100 })).toEqual({
      elements: { found: 160, kept: 100, scanStopped: false },
    });
  });

  it("records a scan that stopped early even when every element it found was kept", () => {
    expect(
      buildTruncation({ ...whole, found: 5000, kept: 300, scanStopped: true })?.elements,
    ).toEqual({
      found: 5000,
      kept: 300,
      scanStopped: true,
    });
    expect(buildTruncation({ ...whole, scanStopped: true })?.elements).toEqual({
      found: 10,
      kept: 10,
      scanStopped: true,
    });
  });

  it("records both when both happened", () => {
    expect(
      buildTruncation({
        found: 50,
        kept: 20,
        scanStopped: false,
        fullHeight: 9000,
        keptHeight: 4000,
      }),
    ).toEqual({
      height: { fullHeight: 9000, keptHeight: 4000 },
      elements: { found: 50, kept: 20, scanStopped: false },
    });
  });
});

describe("planTiles on a screen so small that 90% of it is less than one pixel", () => {
  it("still steps down by a whole pixel, so it ends", () => {
    expect(planTiles(4, 1).map((tile) => tile.top)).toEqual([0, 1, 2, 3]);
  });
});
