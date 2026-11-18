import { describe, expect, it } from "vitest";
import { BOX_TOLERANCE_PX, markForBox, markIdSchema } from "../src/index.js";

// A mark here is just a number and a box: markForBox reads nothing else.
const at = (mark: number, x: number, y: number, width: number, height: number) => ({
  mark: markIdSchema.parse(mark),
  box: { x, y, width, height },
});
const marksOf = (found: { mark: number } | undefined): number | undefined => found?.mark;

describe("markForBox: the mark that an element of the page belongs to", () => {
  it("finds the mark whose box is the box", () => {
    const list = [at(1, 0, 0, 100, 40), at(2, 0, 50, 200, 30)];
    expect(marksOf(markForBox(list, { x: 0, y: 50, width: 200, height: 30 }))).toBe(2);
  });

  it("accepts a difference of 1 px on any side, and not more", () => {
    const list = [at(1, 10, 10, 100, 40)];
    const off = (by: number) => ({ x: 10 + by, y: 10, width: 100, height: 40 });
    expect(BOX_TOLERANCE_PX).toBe(1);
    expect(marksOf(markForBox(list, off(1)))).toBe(1);
    expect(markForBox(list, off(1.5))).toBeUndefined();
    expect(marksOf(markForBox(list, { x: 10, y: 10, width: 101, height: 41 }))).toBe(1);
    expect(markForBox(list, { x: 10, y: 10, width: 102, height: 40 })).toBeUndefined();
    expect(markForBox(list, { x: 10, y: 10, width: 100, height: 42 })).toBeUndefined();
    expect(markForBox(list, { x: 10, y: 12, width: 100, height: 40 })).toBeUndefined();
  });

  it("prefers a mark with the same box to a bigger one that contains it", () => {
    const list = [at(1, 0, 0, 500, 500), at(2, 100, 100, 50, 20)];
    expect(marksOf(markForBox(list, { x: 100, y: 100, width: 50, height: 20 }))).toBe(2);
  });

  it("takes, among the marks that have the same box, the lowest one, even if another is a hair smaller", () => {
    const list = [at(2, 10.5, 10.5, 99, 99), at(1, 10, 10, 100, 100)];
    expect(marksOf(markForBox(list, { x: 10, y: 10, width: 100, height: 100 }))).toBe(1);
  });

  it("takes the smallest mark that contains the box when none has the same box", () => {
    const list = [at(1, 0, 0, 500, 500), at(2, 90, 90, 100, 100), at(3, 80, 80, 300, 300)];
    expect(marksOf(markForBox(list, { x: 100, y: 100, width: 20, height: 20 }))).toBe(2);
  });

  it("lets a mark that contains the box be off by 1 px, but not by more", () => {
    const list = [at(1, 100, 100, 50, 50)];
    expect(marksOf(markForBox(list, { x: 99.5, y: 100, width: 51, height: 50 }))).toBe(1);
    expect(markForBox(list, { x: 98, y: 100, width: 52, height: 50 })).toBeUndefined();
  });

  it("gives a tie to the lowest mark number, whatever the order of the list", () => {
    const same = [at(7, 0, 0, 100, 100), at(3, 0, 0, 100, 100), at(5, 0, 0, 100, 100)];
    expect(marksOf(markForBox(same, { x: 0, y: 0, width: 100, height: 100 }))).toBe(3);
    const bigger = [at(9, 0, 0, 100, 100), at(4, 0, 0, 100, 100)];
    expect(marksOf(markForBox(bigger, { x: 10, y: 10, width: 20, height: 20 }))).toBe(4);
  });

  it("finds nothing when no mark contains the box, or the list is empty", () => {
    expect(
      markForBox([at(1, 0, 0, 50, 50)], { x: 40, y: 40, width: 30, height: 30 }),
    ).toBeUndefined();
    expect(markForBox([], { x: 0, y: 0, width: 10, height: 10 })).toBeUndefined();
  });

  it.each([
    ["no width", { x: 10, y: 10, width: 0, height: 20 }],
    ["no height", { x: 10, y: 10, width: 20, height: 0 }],
    ["a negative size", { x: 10, y: 10, width: -5, height: 20 }],
    ["a number that is not finite", { x: Number.NaN, y: 10, width: 20, height: 20 }],
    ["an infinite size", { x: 10, y: 10, width: Number.POSITIVE_INFINITY, height: 20 }],
  ])(
    "finds nothing for a box with %s: it is not on the page, whatever is under its corner",
    (_what, box) => {
      expect(markForBox([at(1, 0, 0, 1000, 1000)], box)).toBeUndefined();
    },
  );
});
