import { describe, expect, it } from "vitest";
import { SELECTOR_MAX } from "@flawdot/core-model";
import {
  dropOutsideCut,
  numberElements,
  usableElements,
  type RawElement,
} from "../src/set-of-marks.js";

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
const at = (id: string, x: number, y: number) =>
  raw({
    domIndex: Number(id.replace(/\D/g, "")),
    selector: `#${id}`,
    box: { x, y, width: 10, height: 10 },
  });
const selectors = (list: readonly { selector: string }[]): string[] => list.map((e) => e.selector);

describe("dropOutsideCut", () => {
  const cut = { width: 1440, height: 1000 };

  it("keeps what is inside the picture", () => {
    expect(selectors(dropOutsideCut([at("e1", 0, 0), at("e2", 1000, 990)], cut))).toEqual([
      "#e1",
      "#e2",
    ]);
  });

  it("leaves out an element that starts at the cut or below it, and keeps one that starts a pixel above", () => {
    const found = dropOutsideCut([at("e1", 0, 999), at("e2", 0, 1000), at("e3", 0, 5000)], cut);
    expect(selectors(found)).toEqual(["#e1"]);
  });

  it("keeps an element that crosses the cut: part of it is in the picture", () => {
    const crossing = raw({ selector: "#hero", box: { x: 0, y: 900, width: 100, height: 500 } });
    expect(dropOutsideCut([crossing], cut)).toEqual([crossing]);
  });

  it("leaves out an element that starts at the right edge of the picture or beyond it", () => {
    const found = dropOutsideCut([at("e1", 1439, 0), at("e2", 1440, 0), at("e3", 3000, 0)], cut);
    expect(selectors(found)).toEqual(["#e1"]);
  });

  it("does not change the list it is given, and keeps the order", () => {
    const list = [at("e2", 0, 50), at("e1", 0, 0)];
    expect(selectors(dropOutsideCut(list, cut))).toEqual(["#e2", "#e1"]);
    expect(selectors(list)).toEqual(["#e2", "#e1"]);
  });

  it("is done before the cap, so an element outside the picture takes neither a number nor a place", () => {
    const list = [
      at("e1", 0, 5000), // below the cut
      at("e2", 0, 10),
      at("e3", 0, 20),
    ];
    const elements = numberElements(dropOutsideCut(list, cut), 2);
    expect(selectors(elements)).toEqual(["#e2", "#e3"]);
    expect(elements.map((element) => Number(element.mark))).toEqual([1, 2]);
  });
});

describe("usableElements", () => {
  it("drops what cannot become an element, and keeps one record per place and per selector", () => {
    const found = usableElements([
      raw({ domIndex: 1, selector: "#a" }),
      raw({ domIndex: 1, selector: "#b" }), // same place
      raw({ domIndex: 2, selector: "#a" }), // same selector
      raw({ domIndex: 3, selector: "" }), // no selector
      raw({ domIndex: 4, selector: `#${"x".repeat(SELECTOR_MAX)}` }), // selector over the limit
      raw({ domIndex: 5, selector: "#ok", box: { x: Number.NaN, y: 0, width: 1, height: 1 } }),
      raw({ domIndex: 6, selector: "#fine" }),
    ]);
    expect(selectors(found)).toEqual(["#a", "#fine"]);
  });

  it("gives the same records whatever order they come in, in the order of the document", () => {
    const list = [at("e3", 0, 0), at("e1", 0, 0), at("e2", 0, 0)];
    expect(selectors(usableElements(list))).toEqual(["#e1", "#e2", "#e3"]);
    expect(selectors(usableElements([...list].reverse()))).toEqual(["#e1", "#e2", "#e3"]);
  });

  it("is how many elements the page has: the number that numberElements works from", () => {
    const list = [at("e1", 0, 0), raw({ domIndex: 9, selector: "" }), at("e2", 0, 0)];
    expect(usableElements(list)).toHaveLength(2);
    expect(numberElements(list, 300)).toHaveLength(2);
  });
});
