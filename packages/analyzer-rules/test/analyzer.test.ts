import { describe, expect, it } from "vitest";
import {
  FlawDotError,
  type AbortSignalLike,
  type AnalyzerContext,
  type Box,
  type Capture,
} from "@flawdot/core-model";
import { createAxeAnalyzer } from "../src/analyzer.js";
import { emptyCatalog } from "../src/catalog.js";
import { WCAG_CRITERIA } from "../src/wcag-criteria.js";
import { box, element } from "./support/builders.js";
import { savedAxeResult } from "./support/fixtures.js";

const PAGE_URL = "https://shop.example/account/orders?token=SECRET123#frag";
const deps = { catalog: emptyCatalog, wcag: WCAG_CRITERIA };
const neverAborted: AbortSignalLike = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** A capture of the page, with the elements the analyzer reads. */
const captureOf = (elements: ReturnType<typeof element>[]): Capture =>
  ({ page: { url: PAGE_URL }, elements }) as unknown as Capture;

const fakePage = { evaluate: () => undefined, context: () => undefined };

function context(
  boxOf: (selector: string) => Promise<Box | null> = () => Promise.resolve(null),
  page: unknown = fakePage,
): AnalyzerContext {
  return { language: "en", livePage: { page, boxOf } };
}

/** A signal that can be aborted by the test, and that keeps the listeners of the analyzer. */
function controllableSignal(): { signal: AbortSignalLike; abort: () => void } {
  const listeners = new Set<() => void>();
  const state = { aborted: false };
  const signal: AbortSignalLike = {
    get aborted() {
      return state.aborted;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    signal,
    abort: () => {
      state.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

const rejectionOf = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("the accessibility analyzer", () => {
  it("is the rule analyzer of the accessibility category", () => {
    const analyzer = createAxeAnalyzer(deps);
    expect(analyzer).toMatchObject({
      kind: "rule",
      id: "accessibility-wcag",
      category: "accessibility",
    });
  });

  it("runs axe on the live page, measures the selectors no mark has, and gives the drafts and the count", async () => {
    const seen: string[] = [];
    const runAxe = (page: unknown) => {
      expect(page).toBe(fakePage);
      return Promise.resolve(savedAxeResult("violations"));
    };
    const analyzer = createAxeAnalyzer({ ...deps, runAxe: runAxe });
    const elements = [element(1, "p.low", box(20, 20, 400, 24))];
    const result = await analyzer.analyze(
      captureOf(elements),
      context((selector) => {
        seen.push(selector);
        return Promise.resolve(selector === "#low" ? box(20, 20, 400, 24) : null);
      }),
      neverAborted,
    );
    // In the order of the rules of axe: button-name, color-contrast, image-alt, label, role-img-alt.
    expect(seen).toEqual(["#icon", "#low", "#logo", "#email", "#plain"]);
    expect(result.needsReview).toBe(0);
    const contrast = result.drafts.find((draft) => draft.ruleKey === "color-contrast");
    expect(contrast?.location).toMatchObject({ kind: "element", mark: 1, selector: "p.low" });
    expect(result.drafts.find((draft) => draft.ruleKey === "image-alt")?.location).toEqual({
      kind: "page",
    });
  });

  it("passes the way to an element in an iframe or in a shadow root to the live page as the path axe gave", async () => {
    const asked: unknown[] = [];
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("frames")),
    });
    await analyzer.analyze(
      captureOf([]),
      context((target) => {
        asked.push(target);
        return Promise.resolve(null);
      }),
      neverAborted,
    );
    expect(asked).toEqual([[["#host", "#sb"]], ["iframe", "#fi"]]);
  });

  it("puts a finding on the mark that holds an element that was measured by a path", async () => {
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("frames")),
    });
    const result = await analyzer.analyze(
      captureOf([element(1, "iframe", box(0, 0, 300, 80))]),
      context((target) =>
        Promise.resolve(
          typeof target === "string" || target[0] !== "iframe" ? null : box(10, 10, 100, 20),
        ),
      ),
      neverAborted,
    );
    expect(result.drafts.map((draft) => [draft.ruleKey, draft.location.kind])).toEqual([
      ["button-name", "page"],
      ["label", "element"],
    ]);
  });

  it("counts what needs a person without making a finding of it", async () => {
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("clean")),
    });
    const result = await analyzer.analyze(captureOf([]), context(), neverAborted);
    expect(result).toEqual({ drafts: [], needsReview: 1 });
  });

  it("measures one selector after another, not all at once", async () => {
    let running = 0;
    let most = 0;
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("many")),
    });
    await analyzer.analyze(
      captureOf([]),
      context(async () => {
        running += 1;
        most = Math.max(most, running);
        await Promise.resolve();
        running -= 1;
        return null;
      }),
      neverAborted,
    );
    expect(most).toBe(1);
  });
});

describe("the analyzer when it is stopped, late or broken", () => {
  it("says CANCELLED, and does not start axe, when the signal is aborted already", async () => {
    let started = false;
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => {
        started = true;
        return Promise.resolve({});
      },
    });
    const { signal, abort } = controllableSignal();
    abort();
    const error = await rejectionOf(analyzer.analyze(captureOf([]), context(), signal));
    expect(error).toMatchObject({ code: "CANCELLED", retryable: false });
    expect(started).toBe(false);
  });

  it("says CANCELLED when it is aborted while axe is running", async () => {
    const analyzer = createAxeAnalyzer({ ...deps, runAxe: () => new Promise(() => undefined) });
    const { signal, abort } = controllableSignal();
    const running = rejectionOf(analyzer.analyze(captureOf([]), context(), signal));
    abort();
    expect(await running).toMatchObject({ code: "CANCELLED" });
  });

  it("says CANCELLED between two measures when it is aborted, and measures no more", async () => {
    const { signal, abort } = controllableSignal();
    let measured = 0;
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("many")),
    });
    const error = await rejectionOf(
      analyzer.analyze(
        captureOf([]),
        context(() => {
          measured += 1;
          abort();
          return Promise.resolve(null);
        }),
        signal,
      ),
    );
    expect(error).toMatchObject({ code: "CANCELLED" });
    expect(measured).toBe(1);
  });

  it("says TIMEOUT, retryable, and names only the origin of the page, when axe takes too long", async () => {
    const analyzer = createAxeAnalyzer({
      ...deps,
      timeoutMs: 20,
      runAxe: () => new Promise(() => undefined),
    });
    const error = await rejectionOf(analyzer.analyze(captureOf([]), context(), neverAborted));
    expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect((error as Error).message).toContain("https://shop.example");
    expect((error as Error).message).not.toContain("SECRET123");
    expect((error as Error).message).not.toContain("/account");
  });

  it("says INTERNAL, with a fixed message and the cause kept, when axe fails", async () => {
    const boom = new Error("boom: the page said SECRET123");
    const analyzer = createAxeAnalyzer({ ...deps, runAxe: () => Promise.reject(boom) });
    const error = await rejectionOf(analyzer.analyze(captureOf([]), context(), neverAborted));
    expect(error).toMatchObject({ code: "INTERNAL", retryable: false, cause: boom });
    expect((error as Error).message).toContain("https://shop.example");
    expect((error as Error).message).not.toContain("SECRET123");
  });

  it("says CANCELLED, not INTERNAL, when axe fails because the browser was closed by an abort", async () => {
    const { signal, abort } = controllableSignal();
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => {
        abort();
        return Promise.reject(new Error("Target page, context or browser has been closed"));
      },
    });
    const error = await rejectionOf(analyzer.analyze(captureOf([]), context(), signal));
    expect(error).toMatchObject({ code: "CANCELLED" });
  });

  it("passes an error of FlawDot from the page through as it is", async () => {
    const analyzer = createAxeAnalyzer({
      ...deps,
      runAxe: () => Promise.resolve(savedAxeResult("many")),
    });
    const own = new FlawDotError("TIMEOUT", "The page did not answer.");
    const error = await rejectionOf(
      analyzer.analyze(
        captureOf([]),
        context(() => Promise.reject(own)),
        neverAborted,
      ),
    );
    expect(error).toBe(own);
  });

  it("says INTERNAL when what it is given as the live page is not a page", async () => {
    const analyzer = createAxeAnalyzer({ ...deps, runAxe: () => Promise.resolve({}) });
    for (const page of [undefined, null, "page", {}, { evaluate: () => undefined }]) {
      const error = await rejectionOf(
        analyzer.analyze(captureOf([]), context(undefined, page), neverAborted),
      );
      expect(error).toMatchObject({ code: "INTERNAL" });
    }
  });

  it("says INTERNAL when axe returns something that is not its result", async () => {
    const analyzer = createAxeAnalyzer({ ...deps, runAxe: () => Promise.resolve("<html>") });
    const error = await rejectionOf(analyzer.analyze(captureOf([]), context(), neverAborted));
    expect(error).toMatchObject({ code: "INTERNAL" });
  });
});
