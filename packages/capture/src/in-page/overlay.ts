/// <reference lib="dom" />

// These functions run INSIDE the page: Playwright sends their source text to the browser. They must not use an
// import (except of types) or a name from outside their own body.

export interface MarkOverlayArgument {
  /** The number and the top-left corner of each element, in CSS pixels of the whole page. */
  marks: { mark: number; x: number; y: number }[];
  pageWidth: number;
}

/**
 * Draws a small numbered badge at the top-left corner of each element, on a layer above the page that does not
 * catch the mouse and does not move the page. The layer has a marker attribute so that it can be found and removed.
 */
export function addMarkOverlay(argument: MarkOverlayArgument): void {
  // A page can cover the methods of `document` with an element of that name, so they come from the prototype.
  const create = (tag: string): HTMLElement =>
    Document.prototype.createElement.call(document, tag) as HTMLElement;
  const layer = create("div");
  layer.setAttribute("data-flawdot-overlay", "");
  layer.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    `width:${String(argument.pageWidth)}px`,
    "height:0",
    "overflow:visible",
    "pointer-events:none",
    "z-index:2147483647",
    "margin:0",
    "padding:0",
    "border:0",
  ].join(";");
  for (const mark of argument.marks) {
    const badge = create("span");
    badge.textContent = String(mark.mark);
    badge.style.cssText = [
      "position:absolute",
      `left:${String(Math.max(0, mark.x))}px`,
      `top:${String(Math.max(0, mark.y))}px`,
      "min-width:18px",
      "height:18px",
      "padding:0 3px",
      "box-sizing:border-box",
      "border-radius:9px",
      "background:#000",
      "color:#fff",
      "font:700 12px/18px sans-serif",
      "text-align:center",
      "pointer-events:none",
    ].join(";");
    layer.appendChild(badge);
  }
  // The root element, reached through the prototype so a page cannot replace it.
  const root = Document.prototype.querySelectorAll.call(document, ":root")[0];
  (root ?? document.documentElement).appendChild(layer);
}

/** Takes the layer off the page. Returns how many layers are still there, which must be 0. */
export function removeMarkOverlay(): number {
  const layers = Document.prototype.querySelectorAll.call(document, "[data-flawdot-overlay]");
  for (const layer of Array.from(layers)) layer.remove();
  return Document.prototype.querySelectorAll.call(document, "[data-flawdot-overlay]").length;
}
