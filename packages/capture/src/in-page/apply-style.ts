/// <reference lib="dom" />

// This function runs INSIDE the page: Playwright sends its source text to the browser. It must not use an import
// or a name from outside its own body.

/**
 * Applies a style to the page as a constructed style sheet. Unlike a style element, which a content security policy
 * can forbid, it is not blocked. Applying the same style twice does nothing. A page can cover the property of
 * `document` with an element that has that name, so the property is read and written through the prototype.
 */
export function applyStyle(style: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(style);
  const property = Object.getOwnPropertyDescriptor(Document.prototype, "adoptedStyleSheets");
  if (property?.get === undefined || property.set === undefined) return;
  const current = property.get.call(document) as CSSStyleSheet[];
  const rulesOf = (candidate: CSSStyleSheet): string =>
    Array.from(candidate.cssRules)
      .map((rule) => rule.cssText)
      .join("");
  const ours = rulesOf(sheet);
  if (!current.some((existing) => rulesOf(existing) === ours)) {
    property.set.call(document, [...current, sheet]);
  }
}
