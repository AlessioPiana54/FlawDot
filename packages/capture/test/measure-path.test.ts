import { describe, expect, it } from "vitest";
import { isPath, readRect } from "../src/measure-path.js";

// What `boxOf` is given, and what the page script answers, are checked as if a stranger had written them.
describe("isPath: the way to an element, as far as it can be one", () => {
  it.each([
    [["#a"]],
    [["iframe", "#a"]],
    [[["#host", "#a"]]],
    [["iframe", ["#host", "#a", "#b"]]],
    [Array.from({ length: 10 }, () => "#a")],
    [[Array.from({ length: 10 }, () => "#a")]],
  ])("accepts %j", (path) => {
    expect(isPath(path)).toBe(true);
  });

  it.each([
    ["nothing", undefined],
    ["a string", "#a"],
    ["no step", []],
    ["a step that is not text or a list", [5]],
    ["null", [null]],
    ["a step with no selector", [[]]],
    ["an empty selector", [""]],
    ["an empty selector in a list", [["#a", ""]]],
    ["a selector that is not text in a list", [["#a", 7]]],
    ["a list in a list in a list", [[["#a"]]]],
    ["11 steps", Array.from({ length: 11 }, () => "#a")],
    ["11 selectors in one step", [Array.from({ length: 11 }, () => "#a")]],
  ])("rejects %s", (_what, path) => {
    expect(isPath(path)).toBe(false);
  });
});

const rect = {
  left: 10,
  top: 20,
  width: 30,
  height: 40,
  borderLeft: 1,
  borderTop: 2,
  scrollX: 3,
  scrollY: 4,
};

describe("readRect: what the page script returns for an element", () => {
  it("reads a rectangle", () => {
    expect(readRect(rect)).toEqual(rect);
  });

  it("keeps only the fields it knows", () => {
    expect(readRect({ ...rect, extra: "<script>" })).toEqual(rect);
  });

  it("takes a box with no size, but not a negative one", () => {
    expect(readRect({ ...rect, width: 0, height: 0 })).toMatchObject({ width: 0, height: 0 });
    for (const field of ["width", "height"]) {
      expect(() => readRect({ ...rect, [field]: -1 })).toThrow(
        expect.objectContaining({ code: "INTERNAL" }),
      );
    }
  });

  const bad: Array<[string, unknown]> = [
    ["nothing", undefined],
    ["null", null],
    ["text", "box"],
    ["a list", [1, 2, 3]],
    ...Object.keys(rect).flatMap((field): Array<[string, unknown]> => [
      [`a missing ${field}`, { ...rect, [field]: undefined }],
      [`a ${field} that is text`, { ...rect, [field]: "1" }],
      [`a ${field} that is NaN`, { ...rect, [field]: Number.NaN }],
      [`a ${field} that is infinite`, { ...rect, [field]: Number.POSITIVE_INFINITY }],
    ]),
  ];

  it.each(bad)("throws INTERNAL, with a fixed message, for %s", (_what, value) => {
    expect(() => readRect(value)).toThrow(
      expect.objectContaining({
        code: "INTERNAL",
        message: "The page returned a box that could not be read.",
      }),
    );
  });
});
