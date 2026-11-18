import type { Viewport } from "@flawdot/core-model";

/** The part of the browser context that depends on the viewport. */
export interface ViewportContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

/**
 * The context options of a viewport. The mobile viewport is a phone: the browser then lays a page out the way a
 * phone does (a page without a `<meta name="viewport">` is drawn 980 pixels wide) and the page can ask for touch.
 * Desktop and tablet are plain windows.
 */
export function contextOptionsFor(viewport: Viewport): ViewportContextOptions {
  const phone = viewport.name === "mobile";
  return {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: phone,
    hasTouch: phone,
  };
}
