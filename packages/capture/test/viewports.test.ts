import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORTS } from "@flawdot/core-model";
import { contextOptionsFor } from "../src/viewports.js";

describe("contextOptionsFor", () => {
  it.each(Object.values(DEFAULT_VIEWPORTS))(
    "gives the $name viewport its size and pixel ratio",
    (viewport) => {
      expect(contextOptionsFor(viewport)).toMatchObject({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
      });
    },
  );

  it("emulates a phone, with touch, only for the mobile viewport", () => {
    expect(contextOptionsFor(DEFAULT_VIEWPORTS.mobile)).toMatchObject({
      isMobile: true,
      hasTouch: true,
    });
  });

  it.each([DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.tablet])(
    "does not emulate a phone for the $name viewport",
    (viewport) => {
      expect(contextOptionsFor(viewport)).toMatchObject({ isMobile: false, hasTouch: false });
    },
  );

  it("keeps a custom pixel ratio", () => {
    const retina = { ...DEFAULT_VIEWPORTS.mobile, deviceScaleFactor: 2 };
    expect(contextOptionsFor(retina)).toMatchObject({ deviceScaleFactor: 2, isMobile: true });
  });
});
