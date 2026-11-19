import { describe, expect, it } from "vitest";
import { measureLegend } from "../src/legend.js";
import { DEFAULT_THEME } from "../src/theme.js";

describe("measureLegend: the key of the three sizes, bottom right", () => {
  const legend = measureLegend({ width: 800, height: 600, scale: 1 }, DEFAULT_THEME);

  it("sits in the bottom right corner, inside the image, at the margin", () => {
    expect(legend).not.toBeNull();
    const { plate } = legend!;
    expect(plate.x + plate.width).toBeCloseTo(800 - DEFAULT_THEME.legend.margin, 6);
    expect(plate.y + plate.height).toBeCloseTo(600 - DEFAULT_THEME.legend.margin, 6);
    expect(plate.x).toBeGreaterThan(0);
    expect(plate.y).toBeGreaterThan(0);
  });

  it("has the three severities in order, with the discs of the legend and a label each", () => {
    const items = legend!.items;
    expect(items.map((item) => item.severity)).toEqual(["critical", "medium", "low"]);
    expect(items.map((item) => item.disc.r * 2)).toEqual([17, 14, 11]);
    expect(items.map((item) => item.label.width > 0)).toEqual([true, true, true]);
  });

  it("lays the items out from left to right, inside the plate, on one line", () => {
    const { plate, items } = legend!;
    const lefts = items.map((item) => item.disc.cx - item.disc.r);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    for (const item of items) {
      expect(item.disc.cx - item.disc.r).toBeGreaterThanOrEqual(plate.x);
      expect(item.labelX + item.label.width).toBeLessThanOrEqual(plate.x + plate.width + 1e-6);
      expect(item.disc.cy).toBeCloseTo(plate.y + plate.height / 2, 6);
    }
  });

  it("doubles with the scale of the image", () => {
    const big = measureLegend({ width: 1600, height: 1200, scale: 2 }, DEFAULT_THEME)!;
    expect(big.plate.width).toBeCloseTo(legend!.plate.width * 2, 6);
    expect(big.plate.height).toBeCloseTo(legend!.plate.height * 2, 6);
    expect(big.items[0]?.disc.r).toBeCloseTo((legend!.items[0]?.disc.r ?? 0) * 2, 6);
  });

  it("is left out when the image is too small to hold it with its margins", () => {
    expect(measureLegend({ width: 120, height: 600, scale: 1 }, DEFAULT_THEME)).toBeNull();
    expect(measureLegend({ width: 800, height: 40, scale: 1 }, DEFAULT_THEME)).toBeNull();
  });
});
