import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORTS, type Viewport } from "@flawdot/core-model";
import { pngSize } from "../src/png.js";
import { colorName, colorsAt } from "./support/pixels.js";
import { useBrowserHarness } from "./support/harness.js";

// The marked picture and the tiles are real pictures: numbers drawn on the page, at CSS size, and gone afterwards.
const harness = useBrowserHarness();
const sizeOf = (path: string) => pngSize(readFileSync(path));

describe("the marked picture", () => {
  it("has a black badge at the corner of an element, where the plain picture does not", async () => {
    const capture = await harness.take("/landing.html");
    const cta = capture.elements.find((element) => element.selector === "#cta");
    expect(cta).toBeDefined();
    const browser = await harness.provider.get();
    // A point inside the badge, a little way in from the corner of the element (18 px wide, 18 px tall).
    const point = { x: Math.round((cta?.box.x ?? 0) + 4), y: Math.round((cta?.box.y ?? 0) + 9) };
    const [marked] = await colorsAt(browser, capture.marked.path, [point]);
    const [plain] = await colorsAt(browser, capture.screenshot.path, [point]);
    expect(colorName(marked ?? "")).toBe("black");
    expect(colorName(plain ?? "")).not.toBe("black");
  });

  it("is as big as the page in CSS pixels, also at twice the pixel ratio, where the plain picture is twice as big", async () => {
    const sharp: Viewport = { ...DEFAULT_VIEWPORTS.mobile, deviceScaleFactor: 2 };
    const capture = await harness.take("/tall.html", { viewport: sharp, maxHeight: 3000 });
    expect(sizeOf(capture.screenshot.path)).toEqual({ width: 780, height: 6000 });
    expect(sizeOf(capture.marked.path)).toEqual({ width: 390, height: 3000 });
  });
});

describe("the tiles", () => {
  it("cover the picture from the top to the bottom, each as tall as the screen, with files that exist", async () => {
    const capture = await harness.take("/tall.html", {
      viewport: DEFAULT_VIEWPORTS.mobile,
      maxHeight: 3000,
    });
    const tiles = capture.tiles ?? [];
    expect(tiles.map((tile) => tile.top)).toEqual([0, 759, 1518, 2156]);
    for (const tile of tiles) {
      expect(tile.height).toBe(844);
      expect(existsSync(tile.image.path)).toBe(true);
      expect(sizeOf(tile.image.path)).toEqual({ width: 390, height: 844 });
    }
    expect(tiles.at(-1)).toMatchObject({ top: 2156, height: 844 }); // ends at 3000
  });

  it("are one tile as tall as the picture for a page that is not taller than the screen", async () => {
    const capture = await harness.take("/drawer.html");
    expect(capture.tiles).toHaveLength(1);
    expect(capture.tiles?.[0]).toMatchObject({ top: 0, height: 900 });
  });
});

describe("what is left on the page", () => {
  it("is no number: the layer is gone when the analyzers get the page, and the boxes have not moved", async () => {
    const { capture, result } = await harness.inspect("/landing.html", (page) =>
      page.evaluate(() => ({
        layers: document.querySelectorAll("[data-flawdot-overlay]").length,
        scrollY: window.scrollY,
        height: document.documentElement.scrollHeight,
      })),
    );
    expect(result).toEqual({ layers: 0, scrollY: 0, height: 2400 });
    expect(capture.screenshot.height).toBe(2400);
  });
});
