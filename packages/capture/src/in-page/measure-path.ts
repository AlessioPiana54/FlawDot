/// <reference lib="dom" />

// These functions run INSIDE the page: Playwright sends their source text to the browser. They must not use an import
// (except of types, which disappear) or a name from outside their own body. They only report facts; the walk from one
// iframe to the next, and the sum of the offsets, are done in Node, in `measure-path.ts`.
// A page can replace the methods of its document and of its elements (an element named `querySelector` does), and it
// can put its own `shadowRoot` on an element, so everything is taken from the prototypes.

/**
 * The element at the end of a walk through shadow roots in one document: the first selector is looked up in the
 * document, each next one in the open shadow root of the element found before. Null when a step finds nothing, a
 * selector is not valid, or a shadow root is closed (a page does not give those away, and neither does axe).
 */
export function findElement(selectors: readonly string[]): Element | null {
  let found: Element | null = null;
  try {
    for (const [index, selector] of selectors.entries()) {
      if (index === 0) {
        found = Document.prototype.querySelector.call(document, selector);
      } else {
        const root: ShadowRoot | null | undefined =
          found === null
            ? null
            : (Object.getOwnPropertyDescriptor(Element.prototype, "shadowRoot")?.get?.call(
                found,
              ) as ShadowRoot | null | undefined);
        found =
          root === null || root === undefined
            ? null
            : ShadowRoot.prototype.querySelector.call(root, selector);
      }
      if (found === null) return null;
    }
  } catch {
    return null; // not a valid selector, so it matches nothing
  }
  return found;
}

export interface ElementRect {
  /** In CSS pixels from the top-left of the window of the document that holds the element. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The border of the element (an iframe's content starts inside it), and how far the window is scrolled. */
  borderLeft: number;
  borderTop: number;
  scrollX: number;
  scrollY: number;
}

export function rectOf(element: Element): ElementRect {
  const rect = Element.prototype.getBoundingClientRect.call(element);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderLeft: Number(
      Object.getOwnPropertyDescriptor(Element.prototype, "clientLeft")?.get?.call(element) ?? 0,
    ),
    borderTop: Number(
      Object.getOwnPropertyDescriptor(Element.prototype, "clientTop")?.get?.call(element) ?? 0,
    ),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}
