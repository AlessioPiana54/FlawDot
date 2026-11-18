/// <reference lib="dom" />

// This function runs INSIDE the page: Playwright sends its source text to the browser. It must not use an import
// or a name from outside its own body. It reports a fact (how many password fields are on show); what that means is
// decided in Node, in `navigation.ts`.

/**
 * How many password fields the page shows. A field that nobody can see does not count: not one with
 * `display: none`, not one with `visibility: hidden`, not one inside a hidden parent.
 */
export function countPasswordFields(): number {
  // A page can replace methods of `document` and of its elements by naming an element after them, so they come
  // from the prototypes.
  const fields = Document.prototype.querySelectorAll.call(document, 'input[type="password" i]');
  let shown = 0;
  for (const field of Array.from(fields)) {
    if (Element.prototype.checkVisibility.call(field, { visibilityProperty: true })) shown += 1;
  }
  return shown;
}
