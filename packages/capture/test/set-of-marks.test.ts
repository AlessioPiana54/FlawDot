import { describe, expect, it } from "vitest";
import { ELEMENT_NAME_MAX, SELECTOR_MAX } from "@flawdot/core-model";
import { ROW_BUCKET_PX, numberElements, type RawElement } from "../src/set-of-marks.js";

const raw = (overrides: Partial<RawElement> = {}): RawElement => ({
  domIndex: 0,
  kind: "interactive",
  selector: "#a",
  tag: "button",
  role: "button",
  name: "Buy",
  box: { x: 0, y: 0, width: 10, height: 10 },
  ...overrides,
});

/** A repeatable shuffle (a linear congruential generator), so a failure can be reproduced. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const selectors = (list: readonly { selector: string }[]): string[] =>
  list.map((entry) => entry.selector);

describe("numberElements: the numbers", () => {
  it("gives nothing for nothing", () => {
    expect(numberElements([], 300)).toEqual([]);
  });

  it("numbers the elements from 1 with no gap and keeps what the page said about each one", () => {
    const result = numberElements(
      [
        raw({ domIndex: 0, selector: "#a", box: { x: 5, y: 10, width: 20, height: 30 } }),
        raw({
          domIndex: 1,
          selector: "#b",
          tag: "a",
          role: "link",
          name: null,
          box: { x: 0, y: 100, width: 10, height: 10 },
        }),
        raw({
          domIndex: 2,
          selector: "#c",
          kind: "heading",
          tag: "h1",
          role: "heading",
          box: { x: 0, y: 200, width: 10, height: 10 },
        }),
      ],
      300,
    );
    expect(result.map((element) => Number(element.mark))).toEqual([1, 2, 3]);
    expect(result[0]).toEqual({
      mark: 1,
      selector: "#a",
      tag: "button",
      role: "button",
      name: "Buy",
      box: { x: 5, y: 10, width: 20, height: 30 },
    });
    expect(result.map((element) => element.name)).toEqual(["Buy", null, "Buy"]);
  });

  it("rounds a box to two decimals, so sub-pixel noise does not change a capture", () => {
    const [element] = numberElements(
      [raw({ box: { x: 1.23456, y: 9.99999, width: 100.006, height: 0.001 } })],
      300,
    );
    expect(element?.box).toEqual({ x: 1.23, y: 10, width: 100.01, height: 0 });
  });
});

describe("numberElements: reading order", () => {
  it("goes top to bottom, and left to right inside a row of the same height", () => {
    const result = numberElements(
      [
        raw({ domIndex: 0, selector: "#a", box: { x: 300, y: 102, width: 10, height: 10 } }),
        raw({ domIndex: 1, selector: "#b", box: { x: 20, y: 107, width: 10, height: 10 } }),
        raw({ domIndex: 2, selector: "#c", box: { x: 20, y: 140, width: 10, height: 10 } }),
      ],
      300,
    );
    // #a and #b are in the same 10 px row, so the leftmost comes first, whatever the DOM order.
    expect(selectors(result)).toEqual(["#b", "#a", "#c"]);
  });

  it("uses the order of the document when two elements are in the same place", () => {
    const result = numberElements(
      [raw({ domIndex: 7, selector: "#late" }), raw({ domIndex: 3, selector: "#early" })],
      300,
    );
    expect(selectors(result)).toEqual(["#early", "#late"]);
  });

  it("puts an element in the next row when its top crosses the row boundary", () => {
    const result = numberElements(
      [
        raw({
          domIndex: 0,
          selector: "#low",
          box: { x: 0, y: ROW_BUCKET_PX, width: 5, height: 5 },
        }),
        raw({
          domIndex: 1,
          selector: "#high",
          box: { x: 500, y: ROW_BUCKET_PX - 1, width: 5, height: 5 },
        }),
      ],
      300,
    );
    expect(selectors(result)).toEqual(["#high", "#low"]);
  });

  it("gives the same numbers for the same elements whatever the order they arrive in", () => {
    const input = Array.from({ length: 60 }, (_, index) =>
      raw({
        domIndex: index,
        selector: `#e${String(index)}`,
        kind: (["interactive", "heading", "image", "text"] as const)[index % 4] ?? "text",
        box: { x: (index * 37) % 500, y: Math.floor(index / 3) * 4, width: 10, height: 10 },
      }),
    );
    const expected = numberElements(input, 25);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(numberElements(shuffled(input, seed), 25)).toEqual(expected);
    }
  });
});

describe("numberElements: the cap", () => {
  const rows = (kinds: readonly RawElement["kind"][]): RawElement[] =>
    kinds.map((kind, index) =>
      raw({
        domIndex: index,
        selector: `#e${String(index)}`,
        kind,
        box: { x: 0, y: index * 50, width: 10, height: 10 },
      }),
    );

  it("keeps everything when there is room, and the cap changes nothing for such a page", () => {
    const input = rows(["text", "image", "heading", "interactive", "text"]);
    expect(numberElements(input, 5)).toEqual(numberElements(input, 300));
    expect(numberElements(input, 5)).toHaveLength(5);
  });

  it("keeps the interactive elements first, then headings, then images, then text", () => {
    const input = rows(["text", "image", "heading", "interactive", "text", "interactive"]);
    // Room for 3: the two interactive elements and the heading.
    expect(selectors(numberElements(input, 3))).toEqual(["#e2", "#e3", "#e5"]);
    // Room for 4: the image comes next.
    expect(selectors(numberElements(input, 4))).toEqual(["#e1", "#e2", "#e3", "#e5"]);
  });

  it("takes the elements that come first in the document among equals", () => {
    const input = rows(["text", "text", "text", "text"]);
    expect(selectors(numberElements(input, 2))).toEqual(["#e0", "#e1"]);
  });

  it("numbers what is kept from 1 to the cap, in reading order", () => {
    const input = rows(["text", "interactive", "text", "interactive", "heading"]);
    const result = numberElements(input, 3);
    expect(result.map((element) => Number(element.mark))).toEqual([1, 2, 3]);
    expect(selectors(result)).toEqual(["#e1", "#e3", "#e4"]);
  });

  it("gives nothing when the cap is zero", () => {
    expect(numberElements(rows(["interactive"]), 0)).toEqual([]);
  });

  it("does not let a bad record take a place of the cap", () => {
    const input = [
      raw({ domIndex: 0, selector: "" }),
      raw({ domIndex: 1, selector: "#ok", box: { x: 0, y: 10, width: 5, height: 5 } }),
    ];
    expect(selectors(numberElements(input, 1))).toEqual(["#ok"]);
  });
});

describe("numberElements: what is dropped", () => {
  it("drops an element without a selector, and one with a selector over the limit", () => {
    const input = [
      raw({ domIndex: 0, selector: "" }),
      raw({ domIndex: 1, selector: `#${"a".repeat(SELECTOR_MAX)}` }),
      raw({ domIndex: 2, selector: `#${"b".repeat(SELECTOR_MAX - 1)}` }),
    ];
    // The third is exactly SELECTOR_MAX long and stays; the second is one over.
    expect(numberElements(input, 300)).toHaveLength(1);
  });

  it.each([
    ["NaN", { x: Number.NaN, y: 0, width: 1, height: 1 }],
    ["Infinity", { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 }],
    ["a negative width", { x: 0, y: 0, width: -1, height: 1 }],
    ["a negative height", { x: 0, y: 0, width: 1, height: -1 }],
  ])("drops an element whose box has %s", (_why, box) => {
    expect(numberElements([raw({ box })], 300)).toEqual([]);
  });

  it("keeps only the first of two records with the same position in the document", () => {
    const result = numberElements(
      [raw({ domIndex: 4, selector: "#first" }), raw({ domIndex: 4, selector: "#second" })],
      300,
    );
    expect(selectors(result)).toEqual(["#first"]);
  });

  it("keeps only the first of two records with the same selector, because a selector names one element", () => {
    const result = numberElements(
      [raw({ domIndex: 1, selector: "#same" }), raw({ domIndex: 2, selector: "#same" })],
      300,
    );
    expect(result).toHaveLength(1);
  });
});

describe("numberElements: the name", () => {
  const nameOf = (name: string | null): string | null | undefined =>
    numberElements([raw({ name })], 300)[0]?.name;

  it("trims it, and turns a blank one into null", () => {
    expect(nameOf("  Buy now \n")).toBe("Buy now");
    expect(nameOf("   ")).toBeNull();
    expect(nameOf("")).toBeNull();
    expect(nameOf(null)).toBeNull();
  });

  it("cuts a long name to the limit of an element", () => {
    expect(nameOf("a".repeat(500))).toHaveLength(ELEMENT_NAME_MAX);
  });

  it("does not split an emoji at the cut", () => {
    const name = nameOf(`${"a".repeat(ELEMENT_NAME_MAX - 1)}😀tail`);
    expect(name).toBe("a".repeat(ELEMENT_NAME_MAX - 1));
  });

  it("keeps text that is not Latin", () => {
    expect(nameOf("日本語のボタン")).toBe("日本語のボタン");
  });
});
