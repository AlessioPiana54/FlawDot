import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  FlawDotError,
  SELECTOR_MAX,
  boxSchema,
  captureSchema,
  parseOrThrow,
  type AbortSignalLike,
  type ArtifactStore,
  type Clock,
  type InputPlugin,
  type LivePage,
  type Viewport,
} from "@flawdot/core-model";
import type { BrowserProvider } from "./browser-provider.js";
import { measureBox } from "./in-page/measure.js";
import { collectCandidates } from "./in-page/collect.js";
import { NAVIGATION_TIMEOUT_MS, stalled, toFlawDotError } from "./navigation-errors.js";
import { pngSize } from "./png.js";
import { RAW_MAX, parseRawPage } from "./raw.js";
import { numberElements } from "./set-of-marks.js";

export interface UrlCaptureDeps {
  browser: BrowserProvider;
  artifacts: ArtifactStore;
  clock: Clock;
  /** How long to wait for a page to load. Only tests change it, to check the timeout without waiting 30 s. */
  navigationTimeoutMs?: number;
}

/** A font that never answers must not hold the capture: it waits for the fonts, but not for long. */
const FONTS_WAIT_MS = 2_000;

// Stops what moves while the page is measured and photographed.
const STILL = [
  "*,*::before,*::after{",
  "animation:none!important;",
  "transition:none!important;",
  "caret-color:transparent!important;",
  "scroll-behavior:auto!important}",
].join("");

/**
 * Playwright puts a time limit on its own calls, but `page.evaluate` waits for as long as the page takes: a page
 * whose script never ends would hold the capture for ever. So every wait on the page has a deadline.
 */
async function within<T>(work: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(stalled(url)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** The files of one capture share a name that cannot hold a character from the URL: it is a hash of it. */
function fileNameFor(url: string, viewport: Viewport): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  // Two captures of one page at different pixel ratios must not write the same file.
  const ratio = viewport.deviceScaleFactor === 1 ? "" : `@${String(viewport.deviceScaleFactor)}x`;
  return `${hash}__${viewport.name}${ratio}`;
}

/**
 * Opens a browser context for one capture and closes it when the work ends, however it ends. Playwright closes a
 * context once: a second `close()` returns at once, before the first has finished. So the first close is kept, and
 * everyone who needs the context gone waits for that one.
 */
async function withContext<T>(
  browser: Browser,
  viewport: Viewport,
  signal: AbortSignalLike,
  work: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= context.close());
  // Closing the context makes every call that is waiting on the page fail; the error is then CANCELLED. A close
  // that fails has nothing to report: the capture's own result or error matters more.
  const closeOnAbort = (): void => {
    close().catch(() => undefined);
  };
  signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    // A signal that fired while the browser was starting reached no listener, so look again now that one is set.
    if (signal.aborted) throw new FlawDotError("CANCELLED", "The capture was cancelled.");
    return await work(context);
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
    await close().catch(() => undefined);
  }
}

/**
 * The `url` input, capture half: opens the page in its own browser context, measures it and photographs it. It
 * never fills a form, clicks or navigates away from the page, and it always closes its context. The browser itself
 * belongs to the provider, which the caller closes.
 */
export function createUrlCapture(deps: UrlCaptureDeps): Pick<InputPlugin, "capture"> {
  const timeout = deps.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;

  return {
    async capture(pageTarget, viewport, ctx, signal, onLive) {
      const guard = <T>(work: Promise<T>): Promise<T> => within(work, timeout, pageTarget.url);

      /** Gets the page ready to be measured: nothing moving, fonts loaded, scrolled back to the top. */
      const prepare = async (page: Page): Promise<void> => {
        await guard(page.addStyleTag({ content: STILL }));
        await guard(
          page.evaluate(
            `Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, ${String(FONTS_WAIT_MS)}))]).then(() => undefined)`,
          ),
        );
        // Boxes are measured from the top of the page, so a page that scrolled itself must be brought back.
        await guard(page.evaluate("window.scrollTo(0, 0)"));
      };

      /** A page that is still open, for the analyzers that need it (axe). It is valid only while `onLive` runs. */
      const liveFor = (page: Page): LivePage => ({
        page,
        boxOf: async (selector) =>
          parseOrThrow(boxSchema.nullable(), await guard(page.evaluate(measureBox, selector)), {
            code: "INTERNAL",
            what: "box",
          }),
      });

      try {
        if (signal.aborted) throw new FlawDotError("CANCELLED", "The capture was cancelled.");
        const browser = await deps.browser.get();
        return await withContext(browser, viewport, signal, async (browserContext) => {
          browserContext.setDefaultTimeout(timeout);
          const page = await browserContext.newPage();
          await page.goto(pageTarget.url, { timeout, waitUntil: "load" });
          await prepare(page);

          const found = parseRawPage(
            await guard(
              page.evaluate(collectCandidates, { max: RAW_MAX, selectorMax: SELECTOR_MAX }),
            ),
          );
          const elements = numberElements(found.elements, ctx.limits.maxElements);

          const name = fileNameFor(pageTarget.url, viewport);
          const screenshotPath = deps.artifacts.pathFor(ctx.runId, "screenshot", name);
          const picture = await page.screenshot({
            path: screenshotPath,
            fullPage: true,
            animations: "disabled",
            scale: "device",
          });
          const size = pngSize(picture);

          // The marked screenshot is made in a later step; until then it is a copy of the plain one.
          const markedPath = deps.artifacts.pathFor(ctx.runId, "marked", name);
          await mkdir(dirname(markedPath), { recursive: true });
          await copyFile(screenshotPath, markedPath);

          const capture = parseOrThrow(
            captureSchema,
            {
              runId: ctx.runId,
              page: pageTarget,
              viewport,
              screenshot: { path: screenshotPath, ...size },
              marked: { path: markedPath },
              elements,
              title: found.title,
              capturedAt: deps.clock.now().toISOString(),
            },
            { code: "INTERNAL", what: "capture" },
          );
          if (onLive !== undefined) await onLive(liveFor(page), capture);
          return capture;
        });
      } catch (error) {
        throw toFlawDotError(error, { url: pageTarget.url, signal });
      }
    },
  };
}
