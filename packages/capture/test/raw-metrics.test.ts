import { describe, expect, it } from "vitest";
import { cutText, parsePageMetrics } from "../src/raw.js";
import { thrownBy } from "./support/fakes.js";

describe("parsePageMetrics", () => {
  it("reads the size of the page, rounded up to a whole pixel, and whether the scan stopped", () => {
    expect(parsePageMetrics({ pageWidth: 1440, pageHeight: 2400.2, reachedMax: false })).toEqual({
      width: 1440,
      height: 2401,
      scanStopped: false,
    });
    expect(parsePageMetrics({ pageWidth: 10, pageHeight: 10, reachedMax: true }).scanStopped).toBe(
      true,
    );
  });

  it("takes a scan as complete unless it says true: a page cannot make it stop by sending anything else", () => {
    for (const reachedMax of [undefined, 1, "true", null, {}]) {
      expect(parsePageMetrics({ pageWidth: 10, pageHeight: 10, reachedMax }).scanStopped).toBe(
        false,
      );
    }
  });

  it("does not take a page bigger than any real page, whatever it claims", () => {
    const huge = parsePageMetrics({ pageWidth: 1e12, pageHeight: Number.MAX_SAFE_INTEGER });
    expect(huge.width).toBe(10_000_000);
    expect(huge.height).toBe(10_000_000);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "big"],
    ["no width", { pageHeight: 10 }],
    ["no height", { pageWidth: 10 }],
    ["a width that is text", { pageWidth: "10", pageHeight: 10 }],
    ["a width of NaN", { pageWidth: Number.NaN, pageHeight: 10 }],
    ["a height of Infinity", { pageWidth: 10, pageHeight: Number.POSITIVE_INFINITY }],
    ["a width under one pixel", { pageWidth: 0.5, pageHeight: 10 }],
    ["a negative height", { pageWidth: 10, pageHeight: -4 }],
  ])("refuses %s with INTERNAL, because the script did not do what it must", (_why, input) => {
    expect(thrownBy(() => parsePageMetrics(input))).toMatchObject({ code: "INTERNAL" });
  });
});

describe("cutText", () => {
  it("leaves text that fits as it is, and cuts text that does not", () => {
    expect(cutText("abc", 3)).toBe("abc");
    expect(cutText("abcd", 3)).toBe("abc");
    expect(cutText("", 3)).toBe("");
  });

  it("does not leave half of an emoji at the end", () => {
    expect(cutText("ab😀cd", 3)).toBe("ab"); // the cut would fall between the two halves
    expect(cutText("ab😀cd", 4)).toBe("ab😀");
  });
});
