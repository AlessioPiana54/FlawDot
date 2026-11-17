import { describe, expect, it } from "vitest";
import { SELECTOR_MAX } from "@flawdot/core-model";
import { NAME_RAW_MAX, RAW_MAX, ROLE_MAX, TAG_MAX, TITLE_MAX, parseRawPage } from "../src/raw.js";
import { thrownBy } from "./support/fakes.js";

const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  domIndex: 0,
  kind: "interactive",
  selector: "#a",
  tag: "button",
  role: "button",
  name: "Buy",
  box: { x: 1, y: 2, width: 3, height: 4 },
  ...overrides,
});

// The page runs our script, but the page is not ours: it can replace built-in functions before the script
// runs, so whatever comes back is checked here as if a stranger had written it.
describe("parseRawPage", () => {
  it("accepts what the script returns", () => {
    expect(parseRawPage({ elements: [record()], title: "Home" })).toEqual({
      elements: [record()],
      title: "Home",
    });
  });

  it("keeps a tag, a role and a selector at the largest size allowed", () => {
    const largest = record({
      tag: "x".repeat(TAG_MAX),
      role: "r".repeat(ROLE_MAX),
      selector: "#" + "a".repeat(SELECTOR_MAX - 1),
    });
    expect(parseRawPage({ elements: [largest] }).elements).toEqual([largest]);
  });

  it("turns a role that is too long to be one into null, and cuts a very long name", () => {
    const [element] = parseRawPage({
      elements: [record({ role: "r".repeat(ROLE_MAX + 1), name: "n".repeat(NAME_RAW_MAX * 3) })],
    }).elements;
    expect(element?.role).toBeNull();
    expect(element?.name).toHaveLength(NAME_RAW_MAX);
  });

  it("trims a title, cuts a very long one, and turns a blank one into null", () => {
    expect(parseRawPage({ elements: [], title: "  Home  " }).title).toBe("Home");
    expect(parseRawPage({ elements: [], title: "t".repeat(TITLE_MAX * 4) }).title).toHaveLength(
      TITLE_MAX,
    );
    expect(parseRawPage({ elements: [], title: "   " }).title).toBeNull();
    expect(parseRawPage({ elements: [], title: "" }).title).toBeNull();
  });

  it("turns a title that is not text into null", () => {
    expect(parseRawPage({ elements: [], title: 12 }).title).toBeNull();
    expect(parseRawPage({ elements: [], title: null }).title).toBeNull();
    expect(parseRawPage({ elements: [] }).title).toBeNull();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "hello"],
    ["a list", []],
    ["an object without elements", { title: "x" }],
    ["elements that are not a list", { elements: "no" }],
  ])("refuses %s with INTERNAL, because the script did not do what it must", (_why, input) => {
    expect(thrownBy(() => parseRawPage(input))).toMatchObject({ code: "INTERNAL" });
  });

  it.each([
    ["a record that is not an object", 5],
    ["a null record", null],
    ["an unknown kind", record({ kind: "banner" })],
    ["a selector that is not text", record({ selector: 7 })],
    ["a tag that is not text", record({ tag: null })],
    ["a tag with no name", record({ tag: "" })],
    ["a tag longer than any real one", record({ tag: "x".repeat(TAG_MAX + 1) })],
    ["a selector longer than the limit", record({ selector: "#" + "a".repeat(SELECTOR_MAX) })],
    ["a role that is neither text nor null", record({ role: 3 })],
    ["a name that is neither text nor null", record({ name: {} })],
    ["a position that is not an integer", record({ domIndex: 1.5 })],
    ["a negative position", record({ domIndex: -1 })],
    ["a box that is missing", record({ box: undefined })],
    [
      "a box with a value that is not a number",
      record({ box: { x: "1", y: 2, width: 3, height: 4 } }),
    ],
    ["a box with NaN", record({ box: { x: Number.NaN, y: 2, width: 3, height: 4 } })],
  ])("drops %s and keeps the others", (_why, bad) => {
    const result = parseRawPage({ elements: [record({ selector: "#good" }), bad] });
    expect(result.elements.map((element) => element.selector)).toEqual(["#good"]);
  });

  it("drops the keys it did not ask for, so a page cannot slip data through", () => {
    const [element] = parseRawPage({
      elements: [record({ extra: "x", box: { x: 1, y: 2, width: 3, height: 4, z: 9 } })],
    }).elements;
    expect(element).toEqual(record());
    expect(Object.keys(element ?? {}).sort()).toEqual(Object.keys(record()).sort());
  });

  it("keeps at most RAW_MAX records, the first ones", () => {
    const many = Array.from({ length: RAW_MAX + 50 }, (_, index) =>
      record({ domIndex: index, selector: `#e${String(index)}` }),
    );
    const result = parseRawPage({ elements: many });
    expect(result.elements).toHaveLength(RAW_MAX);
    expect(result.elements.at(-1)?.selector).toBe(`#e${String(RAW_MAX - 1)}`);
  });
});
