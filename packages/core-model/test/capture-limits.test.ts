import { describe, expect, it } from "vitest";
import {
  ARIA_SNAPSHOT_MAX,
  captureSchema,
  captureTruncationSchema,
  tileSchema,
  type Capture,
} from "../src/index.js";
import { capture } from "./fixtures.js";

// The fixture capture is 6000 px tall at a pixel ratio of 1, so a tile that ends at 6000 ends the page.
const tile = (index: number, top: number, height: number) => ({
  index,
  top,
  height,
  image: { path: `shots/tile-${String(index)}.png`, width: 1440, height },
});
const GOOD_TILES = [tile(0, 0, 3000), tile(1, 2700, 3300)];

const parse = (extra: Record<string, unknown>) => captureSchema.safeParse({ ...capture, ...extra });
const messages = (result: ReturnType<typeof parse>): string =>
  result.success ? "" : result.error.issues.map((issue) => issue.message).join(" | ");

describe("a capture that has no tiles, no truncation and no accessibility tree", () => {
  it("is still valid: the new fields are optional", () => {
    expect(captureSchema.safeParse(capture).success).toBe(true);
  });
});

describe("tiles", () => {
  it("accepts tiles that start at the top, overlap or touch, and end at the bottom of the screenshot", () => {
    expect(parse({ tiles: GOOD_TILES }).success).toBe(true);
    expect(parse({ tiles: [tile(0, 0, 3000), tile(1, 3000, 3000)] }).success).toBe(true); // touching
    expect(parse({ tiles: [tile(0, 0, 6000)] }).success).toBe(true); // one tile
  });

  it.each([
    ["an empty list", [], /at least 1/i],
    ["an index that does not follow the order", [tile(1, 0, 3000), tile(2, 2700, 3300)], /index/i],
    [
      "a first tile that does not start at the top",
      [tile(0, 100, 2900), tile(1, 2700, 3300)],
      /start at 0/i,
    ],
    [
      "a tile that does not start below the one before",
      [tile(0, 0, 3000), tile(1, 0, 6000)],
      /increasing/i,
    ],
    ["a gap between two tiles", [tile(0, 0, 3000), tile(1, 3500, 2500)], /gap/i],
    [
      "a last tile that stops short of the screenshot",
      [tile(0, 0, 3000), tile(1, 2700, 2300)],
      /end where the screenshot ends/i,
    ],
    [
      "a last tile that goes past the screenshot",
      [tile(0, 0, 3000), tile(1, 2700, 3400)],
      /end where the screenshot ends/i,
    ],
  ])("rejects %s", (_why, tiles, message) => {
    const result = parse({ tiles });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(message);
  });

  it("measures the end of the page in CSS pixels, so a sharper screen is checked against its pixel ratio", () => {
    const sharp = {
      viewport: { ...capture.viewport, deviceScaleFactor: 2 },
      screenshot: { ...capture.screenshot, height: 12_000 },
    };
    expect(parse({ ...sharp, tiles: GOOD_TILES }).success).toBe(true);
    expect(parse({ ...sharp, tiles: [tile(0, 0, 3000), tile(1, 2700, 2300)] }).success).toBe(false);
  });

  it.each([
    ["a height of zero", { ...tile(0, 0, 100), height: 0 }],
    ["a top with decimals", { ...tile(0, 0.5, 100) }],
    ["a negative top", { ...tile(0, -1, 100) }],
    [
      "an image path that is empty",
      { ...tile(0, 0, 100), image: { path: "", width: 1, height: 1 } },
    ],
    ["an image of no width", { ...tile(0, 0, 100), image: { path: "a.png", width: 0, height: 1 } }],
  ])("rejects a tile with %s", (_why, bad) => {
    expect(tileSchema.safeParse(bad).success).toBe(false);
  });
});

describe("truncation", () => {
  const kept = capture.elements.length;

  it("accepts a page cut at the height of the screenshot", () => {
    expect(parse({ truncation: { height: { fullHeight: 9000, keptHeight: 6000 } } }).success).toBe(
      true,
    );
  });

  it("rejects a cut that cuts nothing, or that does not match the screenshot", () => {
    expect(parse({ truncation: { height: { fullHeight: 6000, keptHeight: 6000 } } }).success).toBe(
      false,
    );
    expect(parse({ truncation: { height: { fullHeight: 9000, keptHeight: 5000 } } }).success).toBe(
      false,
    );
    expect(
      messages(parse({ truncation: { height: { fullHeight: 9000, keptHeight: 5000 } } })),
    ).toMatch(/height of the screenshot/i);
  });

  it("accepts elements dropped by the cap, or a scan that stopped early", () => {
    const base = { found: kept + 5, kept, scanStopped: false };
    expect(parse({ truncation: { elements: base } }).success).toBe(true);
    expect(
      parse({ truncation: { elements: { ...base, found: kept, scanStopped: true } } }).success,
    ).toBe(true);
  });

  it.each([
    ["more kept than found", { found: 1, kept: 2, scanStopped: false }],
    ["nothing cut and the scan complete", { found: 3, kept: 3, scanStopped: false }],
  ])("rejects an element count with %s", (_why, elements) => {
    expect(captureTruncationSchema.safeParse({ elements }).success).toBe(false);
  });

  it("rejects a count of kept elements that is not the number of elements of the capture", () => {
    const result = parse({
      truncation: { elements: { found: kept + 9, kept: kept + 1, scanStopped: false } },
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/elements of the capture/i);
  });

  it("rejects a truncation that says nothing", () => {
    expect(captureTruncationSchema.safeParse({}).success).toBe(false);
  });
});

describe("the accessibility tree", () => {
  it("accepts text up to the limit and rejects one character more", () => {
    expect(parse({ ariaSnapshot: "x".repeat(ARIA_SNAPSHOT_MAX) }).success).toBe(true);
    expect(parse({ ariaSnapshot: "x".repeat(ARIA_SNAPSHOT_MAX + 1) }).success).toBe(false);
  });

  it("keeps what it is given, and the type has the new fields", () => {
    const result = parse({ ariaSnapshot: "- heading", tiles: GOOD_TILES });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: Capture = result.data;
      expect(data.ariaSnapshot).toBe("- heading");
      expect(data.tiles).toHaveLength(2);
    }
  });
});
