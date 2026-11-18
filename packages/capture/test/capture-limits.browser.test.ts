import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORTS, type Viewport } from "@flawdot/core-model";
import { useBrowserHarness } from "./support/harness.js";

// What the capture leaves out, and how it says so: a page taller than the limit, more elements than the cap, an
// element that is not in the picture.
const harness = useBrowserHarness();

const mobile = DEFAULT_VIEWPORTS.mobile; // 390 wide, so the picture of a tall page stays small
const mobileSharp: Viewport = { ...mobile, deviceScaleFactor: 2 };
const selectorsOf = (capture: { elements: readonly { selector: string }[] }): string[] =>
  capture.elements.map((element) => element.selector);

describe("a page that is within the limits", () => {
  it("has no truncation", async () => {
    const capture = await harness.take("/landing.html");
    expect(capture.truncation).toBeUndefined();
    expect(capture.screenshot).toMatchObject({ width: 1440, height: 2400 });
  });
});

describe("a page taller than the limit", () => {
  it("is cut at the limit, says how tall it was and how tall it is, and leaves out what starts below the cut", async () => {
    const capture = await harness.take("/tall.html", { viewport: mobile, maxHeight: 1500 });
    expect(capture.screenshot.height).toBe(1500);
    expect(capture.truncation).toEqual({ height: { fullHeight: 9000, keptHeight: 1500 } });
    // #t2, #t3, #strad2 and #t4 start below 1500; #strad starts at 1480 and crosses the cut, so it stays.
    expect(selectorsOf(capture)).toEqual(["#t0", "#t1", "#strad"]);
    expect(capture.elements.map((element) => Number(element.mark))).toEqual([1, 2, 3]);
  });

  it("is not taller in the picture than the browser can draw: at twice the pixel ratio the cut is 8192, not 15000", async () => {
    const capture = await harness.take("/tall.html", { viewport: mobileSharp });
    expect(capture.screenshot).toMatchObject({ width: 780, height: 16_384 });
    expect(capture.truncation).toEqual({ height: { fullHeight: 9000, keptHeight: 8192 } });
    // #strad2 starts at 8100 and crosses the cut at 8192; #t4 starts at 8500, below it.
    expect(selectorsOf(capture)).toEqual(["#t0", "#t1", "#strad", "#t2", "#t3", "#strad2"]);
  });

  it("does not let an element below the cut take a number, or a place of the cap", async () => {
    const capture = await harness.take("/tall.html", {
      viewport: mobile,
      maxHeight: 1500,
      maxElements: 3,
    });
    expect(selectorsOf(capture)).toEqual(["#t0", "#t1", "#strad"]);
    expect(capture.truncation).toEqual({ height: { fullHeight: 9000, keptHeight: 1500 } });
  });
});

describe("more elements than the cap", () => {
  it("keeps the cap, and says how many there were and how many it kept", async () => {
    const capture = await harness.take("/priority.html", { maxElements: 100 });
    expect(capture.elements).toHaveLength(100);
    expect(capture.truncation).toEqual({ elements: { found: 160, kept: 100, scanStopped: false } });
  });

  it("is not a truncation when everything fits", async () => {
    const capture = await harness.take("/priority.html", { maxElements: 160 });
    expect(capture.truncation).toBeUndefined();
  });

  it("says the scan stopped early on a page with more elements than the script looks at", async () => {
    const capture = await harness.take("/many.html", { maxElements: 300 });
    expect(capture.elements).toHaveLength(300);
    // The script stops at 5000 elements: that is a minimum, and the capture says so.
    expect(capture.truncation).toEqual({ elements: { found: 5000, kept: 300, scanStopped: true } });
  });
});

describe("an element that is not in the picture", () => {
  it("is left out when it is beyond the right edge of the page, like a drawer that slides in", async () => {
    const capture = await harness.take("/drawer.html");
    expect(selectorsOf(capture)).toEqual(["#visible"]);
  });
});
