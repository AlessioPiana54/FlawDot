import { createHash } from "node:crypto";
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
import { boxOfPath } from "./measure-path.js";
import { collectCandidates } from "./in-page/collect.js";
import { createGuard } from "./guard.js";
import { readAriaSnapshot } from "./aria.js";
import { shootMarked } from "./marked.js";
import { checkArrival, finalUrlFor } from "./navigation.js";
import { NAVIGATION_TIMEOUT_MS, toFlawDotError, type CapturePhase } from "./navigation-errors.js";
import { pngSize } from "./png.js";
import { RAW_MAX, parsePageMetrics, parseRawPage } from "./raw.js";
import { dropOutsideCut, numberElements, usableElements } from "./set-of-marks.js";
import { QUIET_NETWORK_MS, stabilize } from "./stabilize.js";
import { buildTruncation, maxCutHeight, maxCutWidth } from "./tiles.js";
import { contextOptionsFor } from "./viewports.js";

export interface UrlCaptureDeps {
  browser: BrowserProvider;
  artifacts: ArtifactStore;
  clock: Clock;
  /** How long to wait for a page to load. Only tests change it, to check the timeout without waiting 30 s. */
  navigationTimeoutMs?: number;
  /** How long to wait for the network to go quiet. Only tests change it, for a page that never does. */
  quietNetworkMs?: number;
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
    ...contextOptionsFor(viewport),
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
      const guard = createGuard(pageTarget.url, timeout);

      /** A page that is still open, for the analyzers that need it (axe). It is valid only while `onLive` runs. */
      const liveFor = (page: Page): LivePage => ({
        page,
        boxOf: async (target) =>
          typeof target === "string"
            ? parseOrThrow(boxSchema.nullable(), await guard(page.evaluate(measureBox, target)), {
                code: "INTERNAL",
                what: "box",
              })
            : boxOfPath(page, target, guard),
      });

      // Only the error message depends on where the capture was when it failed.
      let phase: CapturePhase = "loading";

      try {
        if (signal.aborted) throw new FlawDotError("CANCELLED", "The capture was cancelled.");
        const browser = await deps.browser.get();
        return await withContext(browser, viewport, signal, async (browserContext) => {
          browserContext.setDefaultTimeout(timeout);
          const page = await browserContext.newPage();
          const response = await page.goto(pageTarget.url, { timeout, waitUntil: "load" });
          // A login page, an answer that is not a page: said now, before the page is scrolled and photographed.
          await checkArrival(page, response, pageTarget.url, guard);
          phase = "measuring";
          // The picture is never taller than the user allows, nor than the browser can draw at this pixel ratio.
          const maxCut = maxCutHeight(ctx.limits, viewport.deviceScaleFactor);
          await stabilize(page, {
            guard,
            quietNetworkMs: deps.quietNetworkMs ?? QUIET_NETWORK_MS,
            screenHeight: viewport.height,
            limitHeight: maxCut,
          });
          // A single-page app can send the visitor to its login route after the page has loaded, while the capture
          // waited for the network to go quiet and scrolled. The address is looked at again, with no response this
          // time (there is no new answer to read), and where the page ended is the address it has now.
          await checkArrival(page, null, pageTarget.url, guard);
          const finalUrl = finalUrlFor(pageTarget.url, page.url());

          const reported = await guard(
            page.evaluate(collectCandidates, { max: RAW_MAX, selectorMax: SELECTOR_MAX }),
          );
          const found = parseRawPage(reported);
          const metrics = parsePageMetrics(reported);
          const keptHeight = Math.min(metrics.height, maxCut);
          const width = Math.min(metrics.width, maxCutWidth(viewport.deviceScaleFactor));
          // What the picture does not show gets no number, and takes no place of the cap.
          const inPicture = dropOutsideCut(found.elements, { width, height: keptHeight });
          const elements = numberElements(inPicture, ctx.limits.maxElements);
          const truncation = buildTruncation({
            found: usableElements(inPicture).length,
            kept: elements.length,
            scanStopped: metrics.scanStopped,
            fullHeight: metrics.height,
            keptHeight,
          });

          const name = fileNameFor(pageTarget.url, viewport);
          const screenshotPath = deps.artifacts.pathFor(ctx.runId, "screenshot", name);
          phase = "picture";
          const picture = await guard(
            page.screenshot({
              path: screenshotPath,
              fullPage: true,
              clip: { x: 0, y: 0, width, height: keptHeight },
              animations: "disabled",
              scale: "device",
            }),
          );
          const size = pngSize(picture);

          const { marked, tiles } = await shootMarked(page, {
            elements,
            width,
            keptHeight,
            screenHeight: viewport.height,
            markedPath: deps.artifacts.pathFor(ctx.runId, "marked", name),
            tilePathFor: (index) =>
              deps.artifacts.pathFor(ctx.runId, "tile", `${name}__t${String(index)}`),
            guard,
          });
          const ariaSnapshot = await readAriaSnapshot(page, timeout);

          const capture = parseOrThrow(
            captureSchema,
            {
              runId: ctx.runId,
              page: pageTarget,
              ...(finalUrl === undefined ? {} : { finalUrl }),
              viewport,
              screenshot: { path: screenshotPath, ...size },
              marked,
              tiles,
              elements,
              title: found.title,
              ...(ariaSnapshot === undefined ? {} : { ariaSnapshot }),
              ...(truncation === undefined ? {} : { truncation }),
              capturedAt: deps.clock.now().toISOString(),
            },
            { code: "INTERNAL", what: "capture" },
          );
          // What goes wrong from here on is the caller's (an analyzer's), not the page's.
          phase = "analysis";
          if (onLive !== undefined) await onLive(liveFor(page), capture);
          return capture;
        });
      } catch (error) {
        throw toFlawDotError(error, { url: pageTarget.url, signal, phase });
      }
    },
  };
}
