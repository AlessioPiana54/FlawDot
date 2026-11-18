/// <reference lib="dom" />

// This function runs INSIDE the page: Playwright sends its source text to the browser. It must not use an import
// (except of types, which disappear) or a name from outside its own body. The decisions are in banner-rules.ts,
// which is checked and passed in; this only applies them. It never clicks anything.

export interface HideBannersArgument {
  /** The same containers, to know whether one is on the page. */
  selectors: string[];
  consentPhrases: string[];
  buttonWords: string[];
}

/**
 * Hides the consent banners of the page and, if there was one, lets the page scroll again (a banner often locks
 * the scroll of the page behind it). It can be called again: a banner that is hidden is not hidden twice.
 */
export function hideConsentBanners(argument: HideBannersArgument): void {
  const MAX_CANDIDATES = 500;
  const MAX_TEXT = 2000;
  // A page can replace methods of \`document\` by naming an element after them, so they come from the prototype.
  const queryAll = (selector: string): NodeListOf<Element> =>
    Document.prototype.querySelectorAll.call(document, selector);

  const textOf = (element: Element): string =>
    (element.textContent ?? "").slice(0, MAX_TEXT + 1).toLowerCase();

  let hidden = 0;

  // 1. The containers of known tools are hidden by the style that was applied before (it also covers a banner the
  // page adds later); here they are only counted.
  try {
    hidden += queryAll(argument.selectors.join(",")).length;
  } catch {
    // a selector the browser does not accept matches nothing
  }

  // 2. Any other banner: a fixed or sticky box near the top of the page whose text asks for cookies and that has a
  // button that accepts or rejects. Anything less than all of that is left alone: what is hidden by mistake is not
  // seen by anyone.
  const hasConsentButton = (box: Element): boolean =>
    Array.from(
      box.querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]"),
    ).some((control) => {
      const label = (
        textOf(control) +
        " " +
        ((control as HTMLInputElement).value ?? "")
      ).toLowerCase();
      return argument.buttonWords.some((word) => label.includes(word));
    });

  const isConsentBanner = (box: Element): boolean => {
    const style = getComputedStyle(box);
    if (style.display === "none") return false;
    if (style.position !== "fixed" && style.position !== "sticky") return false;
    const text = textOf(box);
    if (text.length > MAX_TEXT) return false;
    if (!argument.consentPhrases.some((phrase) => text.includes(phrase))) return false;
    if (box.querySelector("main, h1, [role=main]") !== null) return false; // the page itself, not a banner on it
    // The navigation of the page is not a banner, even when it links to the cookie settings.
    if (box.matches("header, nav, [role=banner], [role=navigation]")) return false;
    if (box.querySelector("nav, [role=navigation]") !== null) return false;
    return hasConsentButton(box);
  };

  for (const box of Array.from(queryAll("body > *, body > * > *")).slice(0, MAX_CANDIDATES)) {
    try {
      if (isConsentBanner(box)) {
        (box as HTMLElement).style.setProperty("display", "none", "important");
        hidden += 1;
      }
    } catch {
      // an element the page has broken is left as it is
    }
  }

  // 3. A banner that locked the scroll of the page leaves it locked when it is hidden.
  if (hidden > 0) {
    const unlock = (element: Element | undefined, alsoPosition: boolean): void => {
      if (element === undefined) return;
      const style = getComputedStyle(element);
      const locks = (value: string): boolean => value === "hidden" || value === "clip";
      if (locks(style.overflow) || locks(style.overflowY)) {
        (element as HTMLElement).style.setProperty("overflow", "visible", "important");
      }
      if (alsoPosition && style.position === "fixed") {
        (element as HTMLElement).style.setProperty("position", "static", "important");
      }
    };
    unlock(queryAll(":root")[0], false);
    unlock(queryAll("body")[0], true);
  }
}
