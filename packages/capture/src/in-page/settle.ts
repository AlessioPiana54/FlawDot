/// <reference lib="dom" />

// This function runs INSIDE the page: Playwright sends its source text to the browser. It must not use an import
// or a name from outside its own body.

export interface LazyArgument {
  /** How far to scroll at each step: the height of the screen, so nothing is skipped. */
  stepPx: number;
  /** Do not scroll below this height of the page. A page that grows as it scrolls is not followed for ever. */
  limitPx: number;
  delayMs: number;
  /** The most time to spend scrolling. */
  maxMs: number;
  /** The most time to wait for the images that are still loading, after the scroll. */
  imageWaitMs: number;
}

/** Waits for the fonts of the page, but for `maxMs` at most: a font that never answers must not hold the capture. */
export async function waitForFonts(maxMs: number): Promise<void> {
  // A page can cover `document.fonts` with an element of that name, so the getter comes from the prototype.
  const fonts: unknown = Object.getOwnPropertyDescriptor(Document.prototype, "fonts")?.get?.call(
    document,
  );
  const ready = (fonts as { ready?: Promise<unknown> } | undefined)?.ready;
  if (ready === undefined || typeof ready.then !== "function") return;
  await Promise.race([ready, new Promise((done) => setTimeout(done, maxMs))]);
}

/** Boxes are measured from the top of the page, so a page that scrolled must be brought back. */
export function scrollToTop(): void {
  window.scrollTo(0, 0);
}

/**
 * Scrolls through the page, one screen at a time, so that what loads when it comes into view does (lazy images,
 * content that an observer fills in), and waits for the images that were started. The page is left wherever the
 * scroll ended; `scrollToTop` brings it back. It cannot run for ever: it is bounded by the height limit, by the
 * time, and by the wait for images.
 */
export async function loadLazyContent(argument: LazyArgument): Promise<void> {
  const wait = (ms: number): Promise<void> =>
    new Promise((done) => {
      setTimeout(done, ms);
    });
  // A page can replace methods of `document` by naming an element after them, so they come from the prototype.
  const queryAll = (selector: string): NodeListOf<Element> =>
    Document.prototype.querySelectorAll.call(document, selector);

  const root = queryAll(":root")[0];
  const total = (): number => Math.min(root?.scrollHeight ?? 0, argument.limitPx);
  const step = Math.max(1, argument.stepPx);
  const started = Date.now();

  for (let y = 0; y < total() && Date.now() - started < argument.maxMs; y += step) {
    window.scrollTo(0, y);
    await wait(argument.delayMs);
  }
  window.scrollTo(0, total()); // the bottom itself, which a step may have passed over
  await wait(argument.delayMs);

  const loading = Array.from(queryAll("img")).filter(
    (image): image is HTMLImageElement => image instanceof HTMLImageElement && !image.complete,
  );
  if (loading.length > 0) {
    const loaded = loading.map(
      (image) =>
        new Promise<void>((done) => {
          image.addEventListener("load", () => done(), { once: true });
          image.addEventListener("error", () => done(), { once: true });
        }),
    );
    await Promise.race([Promise.all(loaded), wait(argument.imageWaitMs)]);
  }
}
