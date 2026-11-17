/// <reference lib="dom" />
import type { RawElement, RawKind } from "../set-of-marks.js";

// This function runs INSIDE the page: Playwright sends its source text to the browser. So it must not use an import
// (except of types, which disappear), a name from outside its body, or a syntax that the compiler rewrites into a
// helper. Everything it needs is declared inside it. It only reports facts: which elements are on the page and
// where. Every decision about them (what is kept, in what order, with what number) is taken on the Node side, in
// set-of-marks.ts, where it can be tested without a browser.

export interface CollectArgument {
  /** Stop after this many elements. */
  max: number;
  /** A selector longer than this is of no use; the Node side drops it, so there is no point in finishing it. */
  selectorMax: number;
}

export interface CollectResult {
  elements: RawElement[];
  title: string;
}

export function collectCandidates(argument: CollectArgument): CollectResult {
  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=switch]",
    "[role=textbox]",
    "[role=combobox]",
    '[tabindex]:not([tabindex^="-"])',
    '[contenteditable=""]',
    '[contenteditable="true"]',
  ].join(",");
  const HEADING = "h1,h2,h3,h4,h5,h6,[role=heading]";
  const IMAGE = "img,canvas,video,[role=img]";
  const TEXT = "p,li,blockquote,figcaption,label,dt,dd,td,th";
  const NOT_CONTENT = "script,style,noscript,template,meta,link,head,title";
  // Nothing a page says about an element is read past this length, so a page cannot make the capture carry
  // megabytes of text for one name. The Node side cuts the name further.
  const NAME_SOURCE_MAX = 500;
  const MAX_REFERENCES = 10; // ids of aria-labelledby, and labels, that are read for one name
  // A class is a stable name when it reads like one: not a hash, not a counter that a build tool made up.
  const STABLE_CLASS = /^[a-z][a-z0-9_-]{1,30}$/i;
  const GENERATED_CLASS = /\d{3,}|[-_][0-9a-f]{6,}$/i;

  // A page can replace methods of `document` by naming an element after them (`<img name="querySelectorAll">`), so
  // the methods are taken from the prototype, which an element name cannot reach.
  const queryAll = (selector: string): NodeListOf<Element> =>
    Document.prototype.querySelectorAll.call(document, selector);
  const byId = (id: string): HTMLElement | null =>
    Document.prototype.getElementById.call(document, id);

  const collapse = (text: string | null | undefined): string =>
    (text ?? "").slice(0, NAME_SOURCE_MAX).replace(/\s+/g, " ").trim();

  const hasOwnText = (element: Element): boolean =>
    Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && collapse(node.textContent) !== "",
    );

  const kindOf = (element: Element): RawKind | null => {
    if (element.matches(INTERACTIVE)) return "interactive";
    if (element.matches(HEADING)) return "heading";
    if (element.matches(IMAGE)) return "image";
    if (element.matches(TEXT) && hasOwnText(element)) return "text";
    return null;
  };

  // The part of a control (an image in a link, a label in a button) is not an element of its own.
  const isPartOfAnother = (element: Element, kind: RawKind): boolean =>
    (kind === "image" || kind === "text") && element.parentElement?.closest(INTERACTIVE) != null;

  const inputRole = (input: HTMLInputElement): string => {
    switch (input.type) {
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "button":
      case "submit":
      case "reset":
      case "image":
        return "button";
      case "range":
        return "slider";
      case "number":
        return "spinbutton";
      case "search":
        return "searchbox";
      default:
        return "textbox";
    }
  };

  // An approximation of the computed role: what the page says, else what the tag means. Axe does the exact work.
  const roleOf = (element: Element): string | null => {
    const explicit = collapse(element.getAttribute("role")).split(" ")[0];
    if (explicit !== undefined && explicit !== "") return explicit;
    const tag = element.localName;
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return element.getAttribute("alt") === "" ? "presentation" : "img";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (element instanceof HTMLInputElement) return inputRole(element);
    return null;
  };

  // An approximation of the accessible name, not the full algorithm: the first of these that says something.
  const nameOf = (element: Element): string | null => {
    const label = collapse(element.getAttribute("aria-label"));
    if (label !== "") return label;
    const referenced = (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .slice(0, MAX_REFERENCES)
      .map((id) => collapse(id === "" ? "" : byId(id)?.textContent));
    const labelled = collapse(referenced.join(" "));
    if (labelled !== "") return labelled;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const fromLabels = collapse(
        Array.from(element.labels ?? [])
          .slice(0, MAX_REFERENCES)
          .map((each) => collapse(each.textContent))
          .join(" "),
      );
      if (fromLabels !== "") return fromLabels;
    }
    const alt = collapse(element.getAttribute("alt"));
    if (alt !== "") return alt;
    if (element instanceof HTMLInputElement && /^(button|submit|reset)$/.test(element.type)) {
      const value = collapse(element.value);
      if (value !== "") return value;
    }
    const title = collapse(element.getAttribute("title"));
    if (title !== "") return title;
    const placeholder = collapse(element.getAttribute("placeholder"));
    if (placeholder !== "") return placeholder;
    const content = collapse(element.textContent);
    if (content !== "") return content;
    const imageAlt = collapse(element.querySelector("img[alt]")?.getAttribute("alt"));
    return imageAlt === "" ? null : imageAlt;
  };

  // The position of an element among the siblings with its tag, counted once for all the children of a parent:
  // counting for every element would make a long list cost the square of its length.
  const positions = new WeakMap<Element, number>();
  const positionAmongSiblings = (node: Element, parent: Element): number => {
    if (!positions.has(node)) {
      const counts = new Map<string, number>();
      for (const child of Array.from(parent.children)) {
        const position = (counts.get(child.localName) ?? 0) + 1;
        counts.set(child.localName, position);
        positions.set(child, position);
      }
    }
    return positions.get(node) ?? 1;
  };

  const isOnly = (selector: string, element: Element): boolean => {
    try {
      const found = queryAll(selector);
      return found.length === 1 && found[0] === element;
    } catch {
      return false; // a selector that does not parse names nothing
    }
  };

  // The shortest selector that names exactly this element, and that does not change when the page is rebuilt:
  // a unique id, then a test id, then stable classes, then a path of positions. Everything is escaped.
  const selectorFor = (element: Element): string => {
    const tag = element.localName;
    if (element.id !== "") {
      const idSelector = `#${CSS.escape(element.id)}`;
      if (isOnly(idSelector, element)) return idSelector;
    }
    const testId = element.getAttribute("data-testid");
    if (testId !== null && testId !== "") {
      const byTestId = `${tag}[data-testid=${CSS.escape(testId)}]`;
      if (isOnly(byTestId, element)) return byTestId;
    }
    const stable = Array.from(element.classList)
      .filter((name) => STABLE_CLASS.test(name) && !GENERATED_CLASS.test(name))
      .slice(0, 3);
    if (stable.length > 0) {
      const byClasses = tag + stable.map((name) => `.${CSS.escape(name)}`).join("");
      if (isOnly(byClasses, element)) return byClasses;
    }
    const parts: string[] = [];
    let length = 0;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (node !== element && node.id !== "" && isOnly(`#${CSS.escape(node.id)}`, node)) {
        parts.push(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent: Element | null = node.parentElement;
      if (parent === null) {
        parts.push(node.localName);
        break;
      }
      const part = `${node.localName}:nth-of-type(${String(positionAmongSiblings(node, parent))})`;
      parts.push(part);
      length += part.length;
      if (length > argument.selectorMax) break; // too long to be kept: no point in finishing it
    }
    const path = parts.reverse().join(" > ");
    return length > argument.selectorMax || isOnly(path, element) ? path : "";
  };

  // One element, as the page shows it, or null when it is not an element to number.
  const describe = (element: Element, domIndex: number): RawElement | null => {
    if (element.matches(NOT_CONTENT)) return null;
    if (element.localName !== "svg" && element.closest("svg") !== null) return null;
    const kind = kindOf(element);
    if (kind === null || isPartOfAnother(element, kind)) return null;
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    const rect = element.getBoundingClientRect();
    // Under 2 px is a hairline or a clipped screen-reader label, not something a visitor sees.
    if (rect.width < 2 || rect.height < 2) return null;
    const x = rect.left + window.scrollX;
    const y = rect.top + window.scrollY;
    // Entirely before the start of the page: a skip link parked far to the left, for example.
    if (x + rect.width <= 0 || y + rect.height <= 0) return null;
    return {
      domIndex,
      kind,
      selector: selectorFor(element),
      tag: element.localName,
      role: roleOf(element),
      name: nameOf(element),
      box: { x, y, width: rect.width, height: rect.height },
    };
  };

  const elements: RawElement[] = [];
  // `body *`, and not `document.body`, which a page can replace with `<img name="body">`.
  const all = Array.from(queryAll("body *"));
  for (let domIndex = 0; domIndex < all.length && elements.length < argument.max; domIndex += 1) {
    const element = all[domIndex];
    if (element === undefined) continue;
    try {
      const described = describe(element, domIndex);
      if (described !== null) elements.push(described);
    } catch {
      // The page can break the methods this script calls (a form with an input named "matches" replaces
      // `form.matches`). An element that cannot be read is left out; it must not fail the whole page.
      continue;
    }
  }
  return { elements, title: document.title };
}
