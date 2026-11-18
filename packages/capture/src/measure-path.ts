import type { Frame, Page } from "playwright-core";
import { FlawDotError, type Box, type ElementPath } from "@flawdot/core-model";
import type { Guard } from "./guard.js";
import { findElement, rectOf, type ElementRect } from "./in-page/measure-path.js";

// The box of an element that a selector of the page cannot reach: one in an iframe, or in a shadow root. The way to
// it is a list of steps (see `ElementPath`). A step that is not the last one names an iframe: the walk goes into its
// document, and the position of the iframe is added, so that the box is in CSS pixels of the whole top page, like
// every other box of the capture.

const PATH_STEPS_MAX = 10;

const isSelector = (value: unknown): value is string => typeof value === "string" && value !== "";

/** A path of 1 to 10 steps, each a selector or a list of 1 to 10 selectors. Anything else names nothing. */
export function isPath(value: unknown): value is ElementPath {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= PATH_STEPS_MAX &&
    value.every(
      (step: unknown) =>
        isSelector(step) ||
        (Array.isArray(step) &&
          step.length >= 1 &&
          step.length <= PATH_STEPS_MAX &&
          step.every(isSelector)),
    )
  );
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** What the script of the page returned, checked as if a stranger had written it. */
export function readRect(value: unknown): ElementRect {
  const rect = value as Partial<Record<keyof ElementRect, unknown>> | null;
  if (
    typeof rect !== "object" ||
    rect === null ||
    !isNumber(rect.left) ||
    !isNumber(rect.top) ||
    !isNumber(rect.width) ||
    rect.width < 0 ||
    !isNumber(rect.height) ||
    rect.height < 0 ||
    !isNumber(rect.borderLeft) ||
    !isNumber(rect.borderTop) ||
    !isNumber(rect.scrollX) ||
    !isNumber(rect.scrollY)
  ) {
    throw new FlawDotError("INTERNAL", "The page returned a box that could not be read.");
  }
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderLeft: rect.borderLeft,
    borderTop: rect.borderTop,
    scrollX: rect.scrollX,
    scrollY: rect.scrollY,
  };
}

/**
 * The box of the element at the end of `path`, or null if nothing is there: a step that finds nothing, a selector
 * that is not valid, a closed shadow root, a step before the last one that is not an iframe, an iframe that is gone.
 * Every wait on the page has a deadline (`guard`).
 */
export async function boxOfPath(page: Page, path: ElementPath, guard: Guard): Promise<Box | null> {
  if (!isPath(path)) return null;

  let frame: Frame = page.mainFrame();
  // Where the document of `frame` starts, from the top-left of the window of the top page.
  let originX = 0;
  let originY = 0;
  // How far the top page is scrolled: the box is of the whole page, not of the window.
  let scrollX = 0;
  let scrollY = 0;

  for (const [index, step] of path.entries()) {
    const handle = await guard(
      frame.evaluateHandle(findElement, typeof step === "string" ? [step] : step),
    );
    try {
      const element = handle.asElement();
      if (element === null) return null;
      const rect = readRect(await guard(element.evaluate(rectOf)));
      if (index === 0) {
        scrollX = rect.scrollX;
        scrollY = rect.scrollY;
      }
      if (index === path.length - 1) {
        return {
          x: originX + rect.left + scrollX,
          y: originY + rect.top + scrollY,
          width: rect.width,
          height: rect.height,
        };
      }
      const inner = await guard(element.contentFrame());
      if (inner === null) return null;
      originX += rect.left + rect.borderLeft;
      originY += rect.top + rect.borderTop;
      frame = inner;
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  }
  return null;
}
