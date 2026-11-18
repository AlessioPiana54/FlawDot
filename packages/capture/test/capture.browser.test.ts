import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  DEFAULT_VIEWPORTS,
  FlawDotError,
  SELECTOR_MAX,
  captureSchema,
  type Box,
  type Capture,
  type LivePage,
  type Viewport,
} from "@flawdot/core-model";
import { createChromiumProvider, createUrlCapture, type BrowserProvider } from "../src/index.js";
import {
  HANG_PATH,
  closedPort,
  startFixtureServer,
  type FixtureServer,
} from "./support/fixture-server.js";
import { colorName, colorsAt } from "./support/pixels.js";
import {
  FIXED_NOW,
  context,
  fixedClock,
  idleSignal,
  rejectionOf,
  target,
  tempArtifacts,
} from "./support/fakes.js";

// These tests drive a real Chromium against the pages in test/fixtures/site. Every box in those pages is written
// in pixels, so what is expected does not depend on fonts or on the system.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const desktop = DEFAULT_VIEWPORTS.desktop;
const sharpDesktop: Viewport = { ...desktop, deviceScaleFactor: 2 };

let server: FixtureServer;
let provider: BrowserProvider;
const artifacts = tempArtifacts();

beforeAll(async () => {
  server = await startFixtureServer();
  provider = createChromiumProvider();
});

afterAll(async () => {
  await provider.close();
  await server.close();
  artifacts.dispose();
});

const urlCapture = (): ReturnType<typeof createUrlCapture> =>
  createUrlCapture({ browser: provider, artifacts, clock: fixedClock });

function take(path: string, options: { viewport?: Viewport; maxElements?: number } = {}) {
  return urlCapture().capture(
    target(`${server.origin}${path}`),
    options.viewport ?? desktop,
    context(options.maxElements),
    idleSignal,
  );
}

/** Captures a page and, while its browser page is still open, runs `inspect` on it. */
async function takeAndInspect<T>(
  path: string,
  inspect: (page: Page, capture: Capture) => Promise<T>,
  maxElements?: number,
): Promise<{ capture: Capture; result: T }> {
  let result: T | undefined;
  const capture = await urlCapture().capture(
    target(`${server.origin}${path}`),
    desktop,
    context(maxElements),
    idleSignal,
    async (live, finished) => {
      result = await inspect(live.page as Page, finished);
    },
  );
  return { capture, result: result as T };
}

const boxOf = (capture: Capture, selector: string): Box => {
  const found = capture.elements.find((element) => element.selector === selector);
  if (found === undefined) throw new Error(`No element with the selector ${selector}`);
  return found.box;
};

function expectBox(actual: Box, expected: Box, tolerance = 1): void {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${key} of ${JSON.stringify(actual)}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

describe("a capture of a page with a fixed header", () => {
  it("returns a capture that passes the schema, with its files and its title", async () => {
    const capture = await take("/landing.html");
    expect(captureSchema.safeParse(capture).success).toBe(true);
    expect(capture.title).toBe("Landing");
    expect(capture.capturedAt).toBe(FIXED_NOW.toISOString());
    expect(capture.viewport).toEqual(desktop);
    expect(capture.screenshot).toMatchObject({ width: 1440, height: 2400 });
    expect(existsSync(capture.screenshot.path)).toBe(true);
    expect(existsSync(capture.marked.path)).toBe(true);
    expect(capture.marked.path).not.toBe(capture.screenshot.path);
    // The marked picture is not a copy: it has the numbers on it (their pixels are checked in capture-marked).
    expect(readFileSync(capture.marked.path).equals(readFileSync(capture.screenshot.path))).toBe(
      false,
    );
    expect(capture.tiles?.length).toBeGreaterThan(1);
  });

  it("reports the box of a known button where the page puts it, within 1 px", async () => {
    const capture = await take("/landing.html");
    expectBox(boxOf(capture, "#cta"), { x: 40, y: 200, width: 180, height: 48 });
    expectBox(boxOf(capture, "#title"), { x: 40, y: 96, width: 600, height: 48 });
    expectBox(boxOf(capture, "#hero"), { x: 40, y: 300, width: 200, height: 100 });
  });

  it("reports the fixed header where it is, and an element below the first screen by its place in the page", async () => {
    const capture = await take("/landing.html");
    expectBox(boxOf(capture, "#logo"), { x: 16, y: 12, width: 120, height: 40 });
    // 1500 is below the 900 px of the first screen: a box relative to the viewport would be wrong.
    expectBox(boxOf(capture, "#far"), { x: 40, y: 1500, width: 180, height: 48 });
  });

  it("reports page coordinates even when the page has scrolled itself", async () => {
    const capture = await take("/scrolled.html");
    expectBox(boxOf(capture, "#logo"), { x: 16, y: 12, width: 120, height: 40 });
    expectBox(boxOf(capture, "#cta"), { x: 40, y: 200, width: 180, height: 48 });
  });

  it("gives the same elements, with the same numbers, when it captures the same page twice", async () => {
    const first = await take("/landing.html");
    const second = await take("/landing.html");
    expect(second.elements).toEqual(first.elements);
    expect(first.elements.map((element) => Number(element.mark))).toEqual(
      first.elements.map((_, index) => index + 1),
    );
  });

  it("numbers the elements in reading order and gives each its tag, role and name", async () => {
    const { elements } = await take("/landing.html");
    expect(elements.map((element) => element.selector)).toEqual([
      "#logo",
      "#title",
      "#cta",
      "#hero",
      "#far",
    ]);
    expect(elements.map((element) => [element.tag, element.role, element.name])).toEqual([
      ["a", "link", "Logo"],
      ["h1", "heading", "Title"],
      ["button", "button", "Buy now"],
      ["img", "img", "Hero"],
      ["a", "link", "Far away"],
    ]);
  });
});

describe("a capture on a sharper screen", () => {
  it("makes a bigger picture, and keeps the boxes in CSS pixels", async () => {
    const normal = await take("/landing.html");
    const sharp = await take("/landing.html", { viewport: sharpDesktop });
    expect(sharp.screenshot).toMatchObject({ width: 2880, height: 4800 });
    // Same page and same screen name, but another pixel ratio: it must not overwrite the first picture.
    expect(sharp.screenshot.path).not.toBe(normal.screenshot.path);
    expect(existsSync(normal.screenshot.path)).toBe(true);
    expectBox(boxOf(sharp, "#cta"), { x: 40, y: 200, width: 180, height: 48 });
    expect(sharp.elements.map((element) => element.selector)).toEqual(
      normal.elements.map((element) => element.selector),
    );
  });
});

describe("which elements are numbered", () => {
  it("leaves out what the visitor cannot see, and keeps what is visible even for a screen reader", async () => {
    const { elements } = await take("/hidden.html");
    expect(elements.map((element) => element.selector).sort()).toEqual(["#av", "#v1", "#v2"]);
  });

  it("numbers a row from left to right, and the rows from top to bottom", async () => {
    const { elements } = await take("/order.html");
    expect(elements.map((element) => element.selector)).toEqual(["#b", "#a", "#c"]);
  });

  it("does not take the part of a control as an element of its own", async () => {
    const { elements } = await take("/nested.html");
    // A text in a button, an image in a link and a text in a heading belong to the control or the heading.
    expect(elements.map((element) => element.selector)).toEqual(["#btn", "#lnk", "#head", "#para"]);
    expect(elements.map((element) => element.name)).toEqual([
      "Pay now",
      "Home page",
      "A heading",
      "Own text inline",
    ]);
  });
});

describe("selectors", () => {
  it("gives every element a selector that finds exactly that element, whatever the ids and classes look like", async () => {
    const { capture, result } = await takeAndInspect("/hostile.html", (page, finished) =>
      page.evaluate(
        (selectors) =>
          selectors.map((selector) => {
            const found = document.querySelectorAll(selector);
            const text = (found[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
            return { selector, count: found.length, text };
          }),
        finished.elements.map((element) => element.selector),
      ),
    );
    expect(capture.elements).toHaveLength(11);
    for (const entry of result) {
      expect(entry.count, entry.selector).toBe(1);
    }
    // The selector found the element that was numbered, not another one.
    expect(result.map((entry) => entry.text)).toEqual(
      capture.elements.map((element) => element.name ?? ""),
    );
  });

  it("escapes what a selector cannot hold, and tells two elements with the same id apart", async () => {
    const { elements } = await take("/hostile.html");
    const selectors = elements.map((element) => element.selector);
    expect(selectors).toContain(String.raw`#x\:y\.z\[0\]`);
    expect(selectors).toContain(String.raw`#a\ b`);
    expect(new Set(selectors).size).toBe(selectors.length);
    const dups = elements.filter((element) => element.name?.startsWith("dup"));
    expect(dups).toHaveLength(2);
    expect(dups.map((element) => element.selector)).not.toContain("#dup");
    expect(dups[0]?.box).not.toEqual(dups[1]?.box);
  });

  it("never gives a selector longer than the limit, and leaves out the element that has no short one", async () => {
    const { elements } = await take("/deep.html");
    for (const element of elements)
      expect(element.selector.length).toBeLessThanOrEqual(SELECTOR_MAX);
    expect(elements.map((element) => element.name)).toEqual(["ok"]);
  });
});

describe("a page that works against the script", () => {
  it("is still captured when it replaces methods of document and of a form", async () => {
    const { elements } = await take("/clobbered.html");
    const byName = new Map(elements.map((element) => [element.selector, element.name]));
    // The element named by a label, and the plain one, are there with the right names.
    expect(byName.get("#ok")).toBe("Named by a label");
    expect(byName.get("#plain")).toBe("plain");
  });
});

describe("names", () => {
  it("cuts a long name, keeps an emoji whole, and leaves text that is not Latin alone", async () => {
    const { elements } = await take("/long-names.html");
    for (const element of elements) expect(element.name?.length ?? 0).toBeLessThanOrEqual(120);
    const names = new Map(elements.map((element) => [element.selector, element.name]));
    expect(names.get("#long")).toHaveLength(120);
    expect(names.get("#label")).toHaveLength(120);
    // 119 letters, then an emoji that would be cut in half: the emoji goes, no lone half stays.
    expect(names.get("#emoji")).toBe("a".repeat(119));
    expect(names.get("#jp")).toBe("日本語のボタン");
  });
});

describe("the cap on the number of elements", () => {
  it("keeps the interactive elements first, then the headings, then the images, and none of the text", async () => {
    const { elements } = await take("/priority.html", { maxElements: 100 });
    expect(elements).toHaveLength(100);
    expect(elements.map((element) => Number(element.mark))).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    const count = (tag: string): number => elements.filter((element) => element.tag === tag).length;
    expect([count("button"), count("h2"), count("img"), count("p")]).toEqual([40, 40, 20, 0]);
    const tops = elements.map((element) => element.box.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  it("numbers a page under the cap the same way, whether the cap is 160 or 1000", async () => {
    const exact = await take("/priority.html", { maxElements: 160 });
    const roomy = await take("/priority.html", { maxElements: 1000 });
    expect(roomy.elements).toHaveLength(160);
    expect(exact.elements).toEqual(roomy.elements);
  });
});

describe("what the capture never does to a page", () => {
  it("does not fill a form or submit it", async () => {
    const { result } = await takeAndInspect("/form.html", (page) =>
      page.evaluate(() => document.querySelector("input")?.value ?? "missing"),
    );
    expect(result).toBe("");
    expect(server.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(server.requests.some((request) => request.url.startsWith("/submit"))).toBe(false);
  });

  it("has no code that clicks, types or presses anything", () => {
    const sources = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const files = readdirSync(sources, { recursive: true, encoding: "utf8" }).filter((name) =>
      name.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(3);
    const forbidden = new RegExp(
      String.raw`\.(click|dblclick|tap|hover|dragTo|fill|press|type|check|uncheck|focus|blur|selectOption|setInputFiles|insertText|dispatchEvent)\(|\b(mouse|keyboard|touchscreen)\.`,
    );
    for (const file of files) {
      expect(readFileSync(join(sources, file), "utf8"), file).not.toMatch(forbidden);
    }
  });
});

describe("the live page", () => {
  it("is open when `onLive` runs, and gets the finished capture", async () => {
    const { capture, result } = await takeAndInspect("/landing.html", async (page, finished) => ({
      title: await page.title(),
      sameElements: finished.elements.length,
    }));
    expect(result).toEqual({ title: "Landing", sameElements: capture.elements.length });
    expect(capture.elements.length).toBeGreaterThan(0);
  });

  it("answers `boxOf` with the box of an element, null for a selector that matches nothing or is not valid", async () => {
    let live: LivePage | undefined;
    const capture = await urlCapture().capture(
      target(`${server.origin}/landing.html`),
      desktop,
      context(),
      idleSignal,
      async (found) => {
        live = found;
        expectBox((await found.boxOf("#cta")) ?? { x: -1, y: -1, width: -1, height: -1 }, {
          x: 40,
          y: 200,
          width: 180,
          height: 48,
        });
        expect(await found.boxOf("#nope")).toBeNull();
        expect(await found.boxOf("###")).toBeNull();
      },
    );
    expect(capture.elements.length).toBeGreaterThan(0);
    // After the capture the browser page is gone, and the live page must not pretend otherwise.
    await expect(live?.boxOf("#cta")).rejects.toThrow();
  });

  it("closes the browser context when `onLive` throws, and passes the error on", async () => {
    await expect(
      urlCapture().capture(
        target(`${server.origin}/landing.html`),
        desktop,
        context(),
        idleSignal,
        () => Promise.reject(new FlawDotError("INVALID_INPUT", "from the analyzer")),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await provider.get()).contexts()).toHaveLength(0);
  });
});

describe("when the capture fails", () => {
  const openContexts = async (): Promise<number> => (await provider.get()).contexts().length;

  it("says UNREACHABLE for a site that is not there, and may be tried again", async () => {
    const refused = await rejectionOf(
      urlCapture().capture(
        target(`http://127.0.0.1:${String(await closedPort())}/`),
        desktop,
        context(),
        idleSignal,
      ),
    );
    expect(refused).toMatchObject({ code: "UNREACHABLE", retryable: true });
    expect(await openContexts()).toBe(0);
  });

  it("says TIMEOUT when the page does not answer in time", async () => {
    const slow = createUrlCapture({
      browser: provider,
      artifacts,
      clock: fixedClock,
      navigationTimeoutMs: 300,
    });
    await expect(
      slow.capture(target(`${server.origin}${HANG_PATH}`), desktop, context(), idleSignal),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(await openContexts()).toBe(0);
  });

  it("says CANCELLED, without opening a browser, when the signal was already aborted", async () => {
    let asked = 0;
    const counting: BrowserProvider = {
      get: () => {
        asked += 1;
        return provider.get();
      },
      close: () => provider.close(),
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      createUrlCapture({ browser: counting, artifacts, clock: fixedClock }).capture(
        target(`${server.origin}/landing.html`),
        desktop,
        context(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
    expect(asked).toBe(0);
  });

  it("says CANCELLED when the signal is aborted while the page loads, and closes what it opened", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    await expect(
      urlCapture().capture(
        target(`${server.origin}${HANG_PATH}`),
        desktop,
        context(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await openContexts()).toBe(0);
  });

  it("says CANCELLED when the signal is aborted while the browser is still starting, and never loads the page", async () => {
    const slowStart: BrowserProvider = {
      get: async () => {
        await new Promise((done) => setTimeout(done, 400));
        return provider.get();
      },
      close: () => provider.close(),
    };
    const before = server.requests.length;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      createUrlCapture({ browser: slowStart, artifacts, clock: fixedClock }).capture(
        target(`${server.origin}/landing.html`),
        desktop,
        context(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(server.requests.length).toBe(before); // the page was never asked for
    expect(await openContexts()).toBe(0);
  });

  it("says TIMEOUT for a page whose script never gives the browser back, instead of waiting for ever", async () => {
    const impatient = createUrlCapture({
      browser: provider,
      artifacts,
      clock: fixedClock,
      navigationTimeoutMs: 700,
    });
    const started = Date.now();
    await expect(
      impatient.capture(target(`${server.origin}/busy.html`), desktop, context(), idleSignal),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await openContexts()).toBe(0);
  });

  it("does not put a query string in the message of an error", async () => {
    const error = await rejectionOf(
      urlCapture().capture(
        target(`http://127.0.0.1:${String(await closedPort())}/page?token=SECRET123`),
        desktop,
        context(),
        idleSignal,
      ),
    );
    expect(error).toMatchObject({ code: "UNREACHABLE" });
    expect(String((error as Error).message)).not.toContain("SECRET123");
  });
});

describe("the browser provider", () => {
  it("gives one browser to everyone who asks, and can be closed twice", async () => {
    const own = createChromiumProvider();
    const [first, second] = await Promise.all([own.get(), own.get()]);
    expect(first).toBe(second);
    await own.close();
    await own.close();
    expect(first.isConnected()).toBe(false);
  });

  it("starts a new browser when asked again after it was closed", async () => {
    const own = createChromiumProvider();
    const first = await own.get();
    await own.close();
    const second = await own.get();
    expect(second).not.toBe(first);
    expect(second.isConnected()).toBe(true);
    await own.close();
  });

  it("starts one new browser, not two, when several callers find it has died", async () => {
    const own = createChromiumProvider();
    const dead = await own.get();
    await dead.close(); // the browser goes away behind the provider's back
    const [a, b, c] = await Promise.all([own.get(), own.get(), own.get()]);
    expect(a).not.toBe(dead);
    expect(a.isConnected()).toBe(true);
    expect(b).toBe(a);
    expect(c).toBe(a);
    await own.close();
    expect(a.isConnected()).toBe(false);
  });

  it("can be closed before it ever opened a browser", async () => {
    await expect(createChromiumProvider().close()).resolves.toBeUndefined();
  });

  it("explains how to install Chromium when it is missing", async () => {
    const missing = createChromiumProvider({ executablePath: join(artifacts.root, "no-chromium") });
    await expect(missing.get()).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(missing.get()).rejects.toThrow(/Chromium/);
  });

  it("can be closed after a launch that failed, and the launch can be tried again", async () => {
    const missing = createChromiumProvider({ executablePath: join(artifacts.root, "no-chromium") });
    await expect(missing.get()).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(missing.close()).resolves.toBeUndefined();
    await expect(missing.get()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("the screenshot and the boxes agree", () => {
  // A circle is drawn on the screenshot from a box, so the picture must show the element where its box says.
  // Colours are compared by name (see colorName): the exact value depends on the screen profile of the system.

  it.each([
    ["on a normal screen", desktop],
    ["on a sharper screen", sharpDesktop],
  ])("shows each element inside its box, and not just outside it, %s", async (_why, viewport) => {
    const capture = await take("/fixed-bottom.html", { viewport });
    const scale = viewport.deviceScaleFactor;
    const checks: [string, string][] = [
      ["#cta", "green"],
      ["#vh", "blue"],
      ["#bar", "red"],
    ];
    const probes = checks.flatMap(([selector]) => {
      const { x, y, width, height } = boxOf(capture, selector);
      return [
        { x: (x + width / 2) * scale, y: (y + height / 2) * scale }, // the middle of the box
        { x: (x + 3) * scale, y: (y + 3) * scale }, // just inside the top-left corner
        { x: (x + width - 3) * scale, y: (y + height - 3) * scale }, // just inside the bottom-right corner
        { x: Math.max(0, x - 6) * scale, y: Math.max(0, y - 6) * scale }, // just outside the top-left corner
      ];
    });
    const colors = (await colorsAt(await provider.get(), capture.screenshot.path, probes)).map(
      colorName,
    );
    checks.forEach(([selector, expected], index) => {
      const [middle, topLeft, bottomRight, outside] = colors.slice(index * 4, index * 4 + 4);
      expect([selector, middle, topLeft, bottomRight]).toEqual([
        selector,
        expected,
        expected,
        expected,
      ]);
      expect([selector, outside]).toEqual([selector, "white"]);
    });
  });
});
