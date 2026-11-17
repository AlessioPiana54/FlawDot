import { describe, expect, it } from "vitest";
import { waitForFonts } from "../src/in-page/settle.js";
import { useBrowserHarness } from "./support/harness.js";

// What the capture does to a page before it measures it: it hides consent banners (never clicks them), loads what
// is lazy, and does not wait for ever for a network that never goes quiet.
const harness = useBrowserHarness();

const selectorsOf = (capture: { elements: readonly { selector: string }[] }): string[] =>
  capture.elements.map((element) => element.selector);

describe("consent banners", () => {
  it("hides the banners of known tools and the ones that ask for cookies, leaves the look-alikes, and clicks nothing", async () => {
    const { capture, result } = await harness.inspect("/banner.html", (page) =>
      page.evaluate(() => {
        const shown = (id: string): boolean => {
          const element = document.getElementById(id);
          return element !== null && getComputedStyle(element).display !== "none";
        };
        return {
          onetrust: shown("onetrust-banner-sdk"),
          italian: shown("it-banner"),
          english: shown("en-banner"),
          promo: shown("promo"),
          recipes: shown("recipes"),
          notice: shown("notice"),
          header: shown("site-header"),
          menu: shown("site-menu"),
          overflow: [
            getComputedStyle(document.documentElement).overflow,
            getComputedStyle(document.body).overflow,
          ],
          clicked: (window as unknown as { __clicked?: boolean }).__clicked === true,
        };
      }),
    );
    expect(result).toEqual({
      onetrust: false,
      italian: false,
      english: false,
      promo: true, // asks to subscribe, not about cookies
      recipes: true, // says "cookie" but asks for nothing
      notice: true, // talks about cookies, but has no button to accept or reject
      header: true, // a header with a link to the cookie settings is the page's own navigation
      menu: true, // so is a box that holds a nav
      overflow: ["visible", "visible"], // the banner had locked the scroll of the page
      clicked: false,
    });
    expect(harness.server.requests.some((request) => request.url === "/__clicked")).toBe(false);

    const found = selectorsOf(capture);
    expect(found).toEqual(
      expect.arrayContaining([
        "#cta",
        "#subscribe",
        "#recipes-link",
        "#notice-link",
        "#cookie-settings",
        "#allow-link",
        "#menu-cookie-settings",
        "#menu-allow",
      ]),
    );
    for (const hidden of ["#accept", "#it-accept", "#it-reject", "#en-accept"]) {
      expect(found, hidden).not.toContain(hidden);
    }
  });

  it("hides a banner that the page adds when it is scrolled, with a second look after the scroll", async () => {
    const { capture } = await harness.inspect("/late-banner.html", () => Promise.resolve(null));
    expect(selectorsOf(capture)).toEqual(["#cta"]);
  });

  it("hides a banner of a known tool on a page whose security policy forbids styles", async () => {
    const { capture } = await harness.inspect("/csp.html", () => Promise.resolve(null));
    expect(selectorsOf(capture)).toEqual(["#cta"]);
  });

  it("leaves a page without a banner as it is", async () => {
    const { capture } = await harness.inspect("/landing.html", () => Promise.resolve(null));
    expect(selectorsOf(capture)).toEqual(["#logo", "#title", "#cta", "#hero", "#far"]);
  });
});

describe("what loads when it comes into view", () => {
  it("loads an image that is lazy and one that gets its source from an observer, far below the first screen", async () => {
    const { capture, result } = await harness.inspect("/lazy.html", (page) =>
      page.evaluate(() =>
        ["img-a", "img-b", "img-c"].map((id) => {
          const image = document.getElementById(id) as HTMLImageElement | null;
          return image !== null && image.complete && image.naturalWidth > 0;
        }),
      ),
    );
    expect(result).toEqual([true, true, true]); // img-c is in the middle: only the scroll step by step shows it
    const requested = harness.server.requests.map((request) => request.url);
    expect(requested).toEqual(expect.arrayContaining(["/img/lazy-a.svg", "/img/lazy-b.svg"]));
    expect(selectorsOf(capture)).toEqual(expect.arrayContaining(["#img-a", "#img-b"]));
  });

  it("leaves the page at the top, where the boxes are measured", async () => {
    const { capture, result } = await harness.inspect("/lazy.html", (page) =>
      page.evaluate(() => window.scrollY),
    );
    expect(result).toBe(0);
    const imageA = capture.elements.find((element) => element.selector === "#img-a");
    expect(imageA?.box.y).toBeCloseTo(6000, 0); // page coordinates, whatever was scrolled on the way
  });
});

describe("a network that never goes quiet", () => {
  it("is waited for only as long as the option says, and the page is captured all the same", async () => {
    const started = Date.now();
    const capture = await harness.take("/chatty.html", { deps: { quietNetworkMs: 300 } });
    expect(selectorsOf(capture)).toEqual(["#ok"]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("a font that never arrives", () => {
  it("is waited for only as long as it is told, and a page that covers document.fonts does not break the wait", async () => {
    const browser = await harness.provider.get();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${harness.server.origin}/slow-font.html`);
      const started = Date.now();
      await page.evaluate(waitForFonts, 300);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await context.close();
    }
  });

  it("is a page that is still captured when it covers document.fonts", async () => {
    const capture = await harness.take("/clobbered.html");
    expect(capture.elements.length).toBeGreaterThan(0);
  });
});
