import { describe, expect, it } from "vitest";
import { FlawDotError, elementsInTile } from "../src/index.js";

const at = (id: string, y: number, height: number) => ({ id, box: { x: 0, y, width: 10, height } });
const ids = (list: readonly { id: string }[]): string[] => list.map((entry) => entry.id);
// A tile is a band of the page: from `top` down for `height` pixels.
const tile = { top: 900, height: 900 }; // covers 900 to 1800

describe("elementsInTile", () => {
  it("keeps an element that is inside the tile, and leaves out the ones above and below", () => {
    const found = elementsInTile(
      [at("above", 100, 50), at("inside", 1000, 50), at("below", 2000, 50)],
      tile,
    );
    expect(ids(found)).toEqual(["inside"]);
  });

  it("keeps an element that crosses the top edge or the bottom edge, because part of it is in the picture", () => {
    const found = elementsInTile([at("top", 850, 100), at("bottom", 1750, 100)], tile);
    expect(ids(found)).toEqual(["top", "bottom"]);
  });

  it("keeps an element that is taller than the tile and covers it all", () => {
    expect(ids(elementsInTile([at("hero", 0, 5000)], tile))).toEqual(["hero"]);
  });

  it("does not take an element that only touches an edge", () => {
    expect(
      ids(elementsInTile([at("ends-at-top", 800, 100), at("starts-at-bottom", 1800, 50)], tile)),
    ).toEqual([]);
  });

  it("puts an element of the overlap in both tiles, with the same record", () => {
    const first = { top: 0, height: 900 };
    const second = { top: 810, height: 900 };
    const overlap = at("overlap", 820, 40);
    expect(elementsInTile([overlap], first)).toEqual([overlap]);
    expect(elementsInTile([overlap], second)).toEqual([overlap]);
  });

  it("keeps the order of the elements it is given, and does not change the list", () => {
    const list = [at("b", 1100, 10), at("a", 1000, 10)];
    expect(ids(elementsInTile(list, tile))).toEqual(["b", "a"]);
    expect(ids(list)).toEqual(["b", "a"]);
  });

  it("gives an empty list for no elements", () => {
    expect(elementsInTile([], tile)).toEqual([]);
  });

  it.each([
    ["a height of zero", { top: 0, height: 0 }],
    ["a negative top", { top: -1, height: 10 }],
    ["a top that is not a number", { top: Number.NaN, height: 10 }],
  ])("refuses a tile with %s as an internal error", (_why, bad) => {
    expect(() => elementsInTile([at("a", 0, 5)], bad)).toThrow(FlawDotError);
  });
});
