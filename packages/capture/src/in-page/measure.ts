/// <reference lib="dom" />
import type { Box } from "@flawdot/core-model";

// This function runs INSIDE the page: Playwright sends its source text to the browser. It must not use an import
// (except of types, which disappear) or a name from outside its own body.

/** The box of the first element a selector matches, in CSS pixels of the whole page; null if nothing matches. */
export function measureBox(selector: string): Box | null {
  let element: Element | null;
  try {
    element = Document.prototype.querySelector.call(document, selector);
  } catch {
    return null; // not a valid selector, so it matches nothing
  }
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}
