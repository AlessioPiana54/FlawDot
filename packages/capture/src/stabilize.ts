import type { Page } from "playwright-core";
import { BANNER_RULES, hidingStyleFor, type BannerRules } from "./banner-rules.js";
import type { Guard } from "./guard.js";
import { hideConsentBanners } from "./in-page/banners.js";
import { applyStyle } from "./in-page/apply-style.js";
import { loadLazyContent, scrollToTop, waitForFonts } from "./in-page/settle.js";

/** How long to wait for the network to go quiet: the limit of the spec. A page that never does is not an error. */
export const QUIET_NETWORK_MS = 5000;

/** A font that never answers must not hold the capture: it waits for the fonts, but not for long. */
const FONTS_WAIT_MS = 2000;
const LAZY_STEP_DELAY_MS = 80;
const LAZY_SCROLL_MAX_MS = 6000;
const LAZY_IMAGE_WAIT_MS = 2000;

// Stops what moves while the page is measured and photographed.
const STILL = [
  "*,*::before,*::after{",
  "animation:none!important;",
  "transition:none!important;",
  "caret-color:transparent!important;",
  "scroll-behavior:auto!important}",
].join("");

/**
 * Waits for the network to go quiet (no connection for half a second), for `ms` at most. It is true when it did and
 * false when it ran out of time: a page that polls or streams for ever never goes quiet, and still is a page.
 * Any other error is passed on: a closed page or an aborted capture must not look like a quiet network.
 */
export async function waitForQuietNetwork(page: Page, ms: number): Promise<boolean> {
  try {
    await page.waitForLoadState("networkidle", { timeout: ms });
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return false;
    throw error;
  }
}

export interface StabilizeOptions {
  /** Puts a deadline on each wait on the page. */
  guard: Guard;
  /** The soft limit for the wait for a quiet network. */
  quietNetworkMs: number;
  /** The height of the screen, which is the step of the scroll that loads what is lazy. */
  screenHeight: number;
  /** The scroll goes no lower than this: the tallest the picture may be. */
  limitHeight: number;
  rules?: BannerRules;
}

/**
 * Gets the page ready to be measured and photographed: nothing moving, no consent banner in front of it, what is
 * loaded on scroll loaded, fonts there, and back at the top. The page is left at scroll 0. A banner is hidden early,
 * so that its style also covers one that arrives late, and once more after the scroll for one that came with it.
 */
export async function stabilize(page: Page, options: StabilizeOptions): Promise<void> {
  const { guard } = options;
  const rules = options.rules ?? BANNER_RULES;
  // The list ends up inside the page, so it is checked before the page is touched.
  const hidingStyle = hidingStyleFor(rules);
  const banners = {
    selectors: [...rules.selectors],
    consentPhrases: [...rules.consentPhrases],
    buttonWords: [...rules.buttonWords],
  };

  await guard(page.evaluate(applyStyle, STILL));
  await guard(page.evaluate(applyStyle, hidingStyle));
  await guard(page.evaluate(hideConsentBanners, banners));
  await waitForQuietNetwork(page, options.quietNetworkMs);
  await guard(
    page.evaluate(loadLazyContent, {
      stepPx: options.screenHeight,
      limitPx: options.limitHeight,
      delayMs: LAZY_STEP_DELAY_MS,
      maxMs: LAZY_SCROLL_MAX_MS,
      imageWaitMs: LAZY_IMAGE_WAIT_MS,
    }),
  );
  await guard(page.evaluate(hideConsentBanners, banners));
  await guard(page.evaluate(waitForFonts, FONTS_WAIT_MS));
  await guard(page.evaluate(scrollToTop));
}
