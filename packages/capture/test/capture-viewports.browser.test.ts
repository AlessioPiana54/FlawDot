import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORTS, type Capture, type Viewport } from "@flawdot/core-model";
import { useBrowserHarness } from "./support/harness.js";
import { colorName, colorsAt } from "./support/pixels.js";

// Each of the three viewports: the picture is as wide as the window, the boxes follow the layout of that window,
// and the box of an element is where the element is in the picture.
const harness = useBrowserHarness();

const sizeOf = (path: string): { width: number; height: number } => {
  const header = readFileSync(path).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
};
const boxOf = (capture: Capture, selector: string) =>
  capture.elements.find((element) => element.selector === selector)?.box;

describe.each(Object.values(DEFAULT_VIEWPORTS))("the $name viewport", (viewport) => {
  it("gives a picture, a marked picture and tiles as wide as the window", async () => {
    const capture = await harness.take("/responsive.html", { viewport });
    expect(capture.screenshot).toMatchObject({ width: viewport.width, height: 1200 });
    expect(sizeOf(capture.marked.path).width).toBe(viewport.width);
    for (const tile of capture.tiles ?? []) {
      expect(tile.image.width).toBe(viewport.width);
    }
  });

  it("measures a fluid element against the width of this window, and keeps every box inside it", async () => {
    const capture = await harness.take("/responsive.html", { viewport });
    const cta = boxOf(capture, "#cta");
    expect(cta?.x).toBeCloseTo(20, 0);
    expect(cta?.width).toBeCloseTo(viewport.width - 40, 0);
    for (const element of capture.elements) {
      expect(element.box.x + element.box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  it("shows the element where its box says: inside the box it is red, 10 pixels past it it is not", async () => {
    const capture = await harness.take("/responsive.html", { viewport });
    const cta = boxOf(capture, "#cta");
    expect(cta).toBeDefined();
    if (cta === undefined) return;
    const browser = await harness.provider.get();
    const [inside, justPast] = await colorsAt(browser, capture.screenshot.path, [
      // 5 pixels in from the left edge, where the label of the button is not.
      { x: Math.round(cta.x + 5), y: Math.round(cta.y + cta.height / 2) },
      { x: Math.round(cta.x + cta.width + 10), y: Math.round(cta.y + cta.height / 2) },
    ]);
    expect(colorName(inside ?? "")).toBe("red");
    expect(colorName(justPast ?? "")).toBe("white");
  });
});

describe("what changes with the window", () => {
  it("shows the menu on desktop and tablet and the burger only on the phone", async () => {
    const shows = async (viewport: Viewport) => {
      const capture = await harness.take("/responsive.html", { viewport });
      return capture.elements.map((element) => element.selector);
    };
    expect(await shows(DEFAULT_VIEWPORTS.desktop)).toEqual(["#cta", "#nav"]);
    expect(await shows(DEFAULT_VIEWPORTS.tablet)).toEqual(["#cta", "#nav"]);
    expect(await shows(DEFAULT_VIEWPORTS.mobile)).toEqual(["#cta", "#burger"]);
  });

  it("makes the page a phone, with touch, only for the mobile viewport", async () => {
    const touch = async (viewport: Viewport) =>
      (
        await harness.inspect(
          "/responsive.html",
          (page) =>
            page.evaluate(() => ({
              coarse: matchMedia("(pointer: coarse)").matches,
              points: navigator.maxTouchPoints,
            })),
          { viewport },
        )
      ).result;
    expect((await touch(DEFAULT_VIEWPORTS.desktop)).coarse).toBe(false);
    expect((await touch(DEFAULT_VIEWPORTS.tablet)).coarse).toBe(false);
    const phone = await touch(DEFAULT_VIEWPORTS.mobile);
    expect(phone.coarse).toBe(true);
    expect(phone.points).toBeGreaterThan(0);
  });

  it("draws a page without a meta viewport 980 pixels wide on the phone, and its boxes still fit the picture", async () => {
    // This is how a real phone shows an old page, so the capture does the same: the picture is 980 wide, not 390.
    // Nothing on the page is wider than 400, so only the phone emulation can make the picture 980 wide.
    const onPhone = await harness.take("/old-page.html", { viewport: DEFAULT_VIEWPORTS.mobile });
    expect(onPhone.screenshot.width).toBe(980);
    expect(sizeOf(onPhone.marked.path).width).toBe(980);
    expect(boxOf(onPhone, "#hello")).toMatchObject({ x: 10, y: 10, width: 100, height: 30 });

    const onDesktop = await harness.take("/old-page.html", { viewport: DEFAULT_VIEWPORTS.desktop });
    expect(onDesktop.screenshot.width).toBe(DEFAULT_VIEWPORTS.desktop.width);
  });
});
