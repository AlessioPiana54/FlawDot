import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { FlawDotError } from "@flawdot/core-model";
import { BANNER_RULES } from "../src/banner-rules.js";
import { QUIET_NETWORK_MS, stabilize, waitForQuietNetwork } from "../src/stabilize.js";
import { rejectionOf } from "./support/fakes.js";

// A page that only writes down what it is asked to do, so the order and the arguments can be checked without a browser.
interface Script {
  idle?: "quiet" | "busy" | "broken";
}

function fakePage(script: Script = {}) {
  const calls: string[] = [];
  const evaluated: { name: string; argument: unknown }[] = [];
  const page = {
    waitForLoadState: (state: string, options: { timeout: number }) => {
      calls.push(`wait:${state}:${String(options.timeout)}`);
      if (script.idle === "busy") {
        const error = new Error("page.waitForLoadState: Timeout");
        error.name = "TimeoutError";
        return Promise.reject(error);
      }
      if (script.idle === "broken") return Promise.reject(new Error("Target closed"));
      return Promise.resolve();
    },
    evaluate: (work: string | ((argument: unknown) => unknown), argument?: unknown) => {
      const name = typeof work === "string" ? work : work.name;
      calls.push(`eval:${name.slice(0, 24)}`);
      evaluated.push({ name, argument });
      return Promise.resolve(undefined);
    },
  };
  return { page: page as unknown as Page, calls, evaluated };
}

const options = (overrides: Partial<Parameters<typeof stabilize>[1]> = {}) => ({
  guard: <T>(work: Promise<T>): Promise<T> => work,
  quietNetworkMs: 5000,
  screenHeight: 900,
  limitHeight: 15_000,
  ...overrides,
});

describe("waitForQuietNetwork", () => {
  it("is true when the network goes quiet, and waits for the time it was given at most", async () => {
    const { page, calls } = fakePage();
    await expect(waitForQuietNetwork(page, 1234)).resolves.toBe(true);
    expect(calls).toEqual(["wait:networkidle:1234"]);
  });

  it("is false, not an error, when the network never goes quiet: a page that polls for ever is still a page", async () => {
    const { page } = fakePage({ idle: "busy" });
    await expect(waitForQuietNetwork(page, 10)).resolves.toBe(false);
  });

  it("passes on any other error, because a closed page or an aborted capture must not look like a quiet network", async () => {
    const { page } = fakePage({ idle: "broken" });
    const error = await rejectionOf(waitForQuietNetwork(page, 10));
    expect(error).toMatchObject({ message: "Target closed" });
  });
});

describe("stabilize", () => {
  it("stops what moves, hides the banners, waits for the network, loads what is lazy, hides late banners, waits for fonts, and goes back to the top", async () => {
    const { page, calls } = fakePage();
    await stabilize(page, options());
    expect(calls).toEqual([
      "eval:applyStyle", // what moves
      "eval:applyStyle", // the known banners
      "eval:hideConsentBanners",
      "wait:networkidle:5000",
      "eval:loadLazyContent",
      "eval:hideConsentBanners",
      "eval:waitForFonts",
      "eval:scrollToTop",
    ]);
  });

  it("gives the banner function the list of known banners, checked, and the lazy function the size of a screen and the limit", async () => {
    const { page, evaluated } = fakePage();
    await stabilize(page, options({ screenHeight: 844, limitHeight: 8192 }));
    const banners = evaluated.filter((call) => call.name === "hideConsentBanners");
    expect(banners).toHaveLength(2);
    expect(banners[0]?.argument).toMatchObject({
      selectors: BANNER_RULES.selectors,
      consentPhrases: BANNER_RULES.consentPhrases,
      buttonWords: BANNER_RULES.buttonWords,
    });
    const styles = evaluated
      .filter((call) => call.name === "applyStyle")
      .map((call) => call.argument);
    expect(styles).toEqual([
      expect.stringContaining("animation:none!important"),
      expect.stringContaining("{display:none!important}"),
    ]);
    const lazy = evaluated.find((call) => call.name === "loadLazyContent");
    expect(lazy?.argument).toMatchObject({ stepPx: 844, limitPx: 8192 });
  });

  it("goes on when the network is busy, and gives the quiet wait the time of the option", async () => {
    const { page, calls } = fakePage({ idle: "busy" });
    await stabilize(page, options({ quietNetworkMs: 300 }));
    expect(calls).toContain("wait:networkidle:300");
    expect(calls.at(-1)).toBe("eval:scrollToTop");
  });

  it("stops at an error that is not a timeout of the quiet wait", async () => {
    const { page, calls } = fakePage({ idle: "broken" });
    await expect(stabilize(page, options())).rejects.toThrow("Target closed");
    expect(calls).not.toContain(expect.stringContaining("eval:loadLazyContent"));
  });

  it("puts every wait on the page under the guard, so a page that never answers ends as a timeout", async () => {
    const { page } = fakePage();
    let guarded = 0;
    await stabilize(
      page,
      options({
        guard: <T>(work: Promise<T>): Promise<T> => {
          guarded += 1;
          return work;
        },
      }),
    );
    expect(guarded).toBe(7); // two styles, banners, lazy, banners, fonts, scroll
  });

  it("refuses a list of banners that cannot be used, before it touches the page", async () => {
    const { page, calls } = fakePage();
    const error = await rejectionOf(
      stabilize(page, options({ rules: { ...BANNER_RULES, selectors: ["#a}"] } })),
    );
    expect(error).toBeInstanceOf(FlawDotError);
    expect(calls).toEqual([]);
  });

  it("waits five seconds for the network by default: it is the limit of the spec", () => {
    expect(QUIET_NETWORK_MS).toBe(5000);
  });
});
