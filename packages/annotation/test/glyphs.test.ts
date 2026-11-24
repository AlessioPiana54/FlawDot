import { describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { DIGIT_CELL, DIGIT_HEIGHT, GLYPHS, GLYPH_UNITS } from "../src/glyphs.generated.js";
import { layoutNumeral, layoutText } from "../src/glyphs.js";

describe("the glyphs taken from Atkinson Hyperlegible Bold", () => {
  it("has the ten digits and the letters of the legend, each with an outline and a width", () => {
    for (const character of "0123456789CriticalMediumLow") {
      const glyph = GLYPHS[character];
      expect(glyph?.d, character).toMatch(/^M[-\d.]/);
      expect(glyph?.advance, character).toBeGreaterThan(0);
    }
    expect(GLYPHS[" "]).toEqual({ d: "", advance: expect.any(Number) });
  });

  it("is made in a 1000-unit em, with digits about two thirds of it tall", () => {
    expect(GLYPH_UNITS).toBe(1000);
    expect(DIGIT_HEIGHT).toBeGreaterThan(600);
    expect(DIGIT_HEIGHT).toBeLessThan(800);
    expect(DIGIT_CELL).toBe(
      Math.max(..."0123456789".split("").map((d) => GLYPHS[d]?.advance ?? 0)),
    );
  });
});

describe("layoutText", () => {
  it("throws for a character that has no outline, so a mark never falls back to a system font", () => {
    expect(() => layoutText("é", 13)).toThrow(FlawDotError);
    expect(() => layoutText("x!", 13)).toThrow(FlawDotError);
  });

  it("puts each letter after the previous one, and reports the total width", () => {
    const placed = layoutText("Low", 20);
    expect(placed.scale).toBeCloseTo(0.02, 10);
    expect(placed.glyphs.map((glyph) => glyph.x)).toEqual([
      0,
      ((GLYPHS["L"]?.advance ?? 0) * 20) / 1000,
      (((GLYPHS["L"]?.advance ?? 0) + (GLYPHS["o"]?.advance ?? 0)) * 20) / 1000,
    ]);
    const advances = "Low".split("").map((letter) => GLYPHS[letter]?.advance ?? 0);
    expect(placed.width).toBeCloseTo((advances.reduce((a, b) => a + b, 0) * 20) / 1000, 6);
  });

  it("leaves no outline for a space, but moves the pen", () => {
    const placed = layoutText("L o", 10);
    expect(placed.glyphs).toHaveLength(2);
    const advances = "L o".split("").map((letter) => GLYPHS[letter]?.advance ?? 0);
    expect(placed.width).toBeCloseTo((advances.reduce((a, b) => a + b, 0) * 10) / 1000, 6);
  });
});

describe("layoutNumeral", () => {
  it("centers each digit in a cell of the same width, so numbers do not jump around", () => {
    const one = layoutNumeral(1, 16);
    const cell = (DIGIT_CELL * 16) / 1000;
    expect(one.width).toBeCloseTo(cell, 6);
    expect(one.glyphs).toHaveLength(1);
    // The 1 is narrow: it sits in the middle of its cell.
    const narrow = ((GLYPHS["1"]?.advance ?? 0) * 16) / 1000;
    expect(one.glyphs[0]?.x).toBeCloseTo((cell - narrow) / 2, 6);
  });

  it("has one cell for each digit", () => {
    expect(layoutNumeral(10, 16).width).toBeCloseTo(2 * ((DIGIT_CELL * 16) / 1000), 6);
    expect(layoutNumeral(123, 16).glyphs).toHaveLength(3);
  });

  it("shrinks a number that is wider than the room it has", () => {
    const free = layoutNumeral(100, 16);
    const tight = layoutNumeral(100, 16, 20);
    expect(free.width).toBeGreaterThan(20);
    expect(tight.width).toBeLessThanOrEqual(20 + 1e-9);
    expect(tight.scale).toBeLessThan(free.scale);
  });

  it("rejects a number that is not a positive whole number", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => layoutNumeral(bad, 16), String(bad)).toThrow(FlawDotError);
    }
  });
});
