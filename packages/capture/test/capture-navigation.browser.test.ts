import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORTS, FlawDotError } from "@flawdot/core-model";
import { createUrlCapture } from "../src/index.js";
import {
  DOWNLOAD_PATH,
  JSON_PATH,
  PDF_PATH,
  redirectPath,
  statusPath,
} from "./support/fixture-server.js";
import { useBrowserHarness } from "./support/harness.js";
import { context, fixedClock, idleSignal, rejectionOf, target } from "./support/fakes.js";

// Where a navigation ends: a login page, an answer that is not a page, a redirect, and the picture of a page that
// holds the browser up.
const harness = useBrowserHarness();

const openContexts = async (): Promise<number> => (await harness.provider.get()).contexts().length;

describe("a page that asks for a login", () => {
  it("says LOGIN_REQUIRED for a redirect to a login path, and closes what it opened", async () => {
    const error = await rejectionOf(harness.take(redirectPath("/login.html")));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED", retryable: false });
    expect(await openContexts()).toBe(0);
  });

  it("says LOGIN_REQUIRED for a redirect to a page that has a password field, whatever its path", async () => {
    const error = await rejectionOf(harness.take(redirectPath("/gate.html")));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it.each([401, 403])("says LOGIN_REQUIRED for a %i, with no redirect", async (code) => {
    const error = await rejectionOf(harness.take(statusPath(code)));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("does not put the path or the query string of the page in the message", async () => {
    const error = await rejectionOf(harness.take(redirectPath("/login.html", "token=SECRET123")));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED" });
    expect((error as Error).message).toContain(harness.server.origin);
    expect((error as Error).message).not.toContain("SECRET123");
    expect((error as Error).message).not.toContain("__redirect");
  });

  it("captures a login page that was asked for directly: it may be the page to analyze", async () => {
    const capture = await harness.take("/login.html");
    expect(capture.title).toBe("Login");
    expect(capture.finalUrl).toBeUndefined();
  });

  it.each(["/hidden-gate.html", "/invisible-gate.html"])(
    "captures %s, whose one password field is there but nobody can see it (display: none, visibility: hidden)",
    async (path) => {
      const capture = await harness.take(redirectPath(path));
      expect(capture.title).toBe("Home");
      expect(capture.finalUrl).toBe(`${harness.server.origin}${path}`);
    },
  );

  it("captures a sign-up form, which has two password fields, that a redirect led to", async () => {
    const capture = await harness.take(redirectPath("/signup.html"));
    expect(capture.title).toBe("Create an account");
    expect(capture.finalUrl).toBe(`${harness.server.origin}/signup.html`);
  });

  it("says, for a 403, that the site refused, not only that a login is needed", async () => {
    const error = await rejectionOf(harness.take(statusPath(403)));
    expect((error as Error).message).toContain("403");
    expect((error as Error).message).toContain("blocks automated visits");
  });
});

describe("a single-page app that moves the visitor after it has loaded", () => {
  it("says LOGIN_REQUIRED when its router goes to a login route", async () => {
    const error = await rejectionOf(harness.take("/spa-login.html"));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(await openContexts()).toBe(0);
  });

  it("says LOGIN_REQUIRED when it goes to another route and shows a login form", async () => {
    const error = await rejectionOf(harness.take("/spa-gate.html"));
    expect(error).toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("captures it when it goes to another route that is not a login, and records where it ended", async () => {
    const capture = await harness.take("/spa-moved.html");
    expect(capture.finalUrl).toBe(`${harness.server.origin}/dashboard`);
    expect(capture.page.url).toBe(`${harness.server.origin}/spa-moved.html`);
  });

  it("captures it when all it adds to the address is the language", async () => {
    const capture = await harness.take("/spa-locale.html");
    expect(capture.finalUrl).toBe(`${harness.server.origin}/en/`);
  });
});

describe("a page that answers with an error status", () => {
  it.each([404, 500])("captures a %i as the page it is, with its own problems", async (code) => {
    const capture = await harness.take(statusPath(code));
    expect(capture.elements.map((element) => element.selector)).toEqual(["#ok"]);
    expect(capture.finalUrl).toBeUndefined();
  });
});

describe("a redirect to another page", () => {
  it("records where the browser ended, and keeps the page that was asked for as the identity", async () => {
    const asked = redirectPath("/account.html");
    const capture = await harness.take(asked);
    expect(capture.finalUrl).toBe(`${harness.server.origin}/account.html`);
    expect(capture.page.url).toBe(`${harness.server.origin}${asked}`);
    expect(capture.title).toBe("Account");
  });

  it("records nothing for a page that was not redirected", async () => {
    const capture = await harness.take("/account.html");
    expect(capture.finalUrl).toBeUndefined();
    expect(capture.page.url).toBe(`${harness.server.origin}/account.html`);
  });
});

describe("an address that is not a web page", () => {
  it.each([
    ["a PDF shown inline", PDF_PATH],
    ["a download", DOWNLOAD_PATH],
    ["JSON", JSON_PATH],
  ])("says INVALID_INPUT for %s, and closes what it opened", async (_what, path) => {
    const error = await rejectionOf(harness.take(path));
    expect(error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect((error as Error).message).toContain(harness.server.origin);
    expect((error as Error).message).not.toContain(path);
    expect(await openContexts()).toBe(0);
  });

  it("says UNREACHABLE, and not worth another try, for https on a server that speaks http", async () => {
    const httpsOrigin = harness.server.origin.replace("http:", "https:");
    const error = await rejectionOf(
      createUrlCapture({
        browser: harness.provider,
        artifacts: harness.artifacts,
        clock: fixedClock,
      }).capture(
        target(`${httpsOrigin}/account.html`),
        DEFAULT_VIEWPORTS.desktop,
        context(),
        idleSignal,
      ),
    );
    expect(error).toMatchObject({ code: "UNREACHABLE", retryable: false });
    expect((error as Error).message).toMatch(/certificate/i);
  });
});

describe("an error from what the caller does with the open page", () => {
  it("stays the caller's own: a TIMEOUT of an analyzer is not taken for a font that never arrived", async () => {
    const error = await rejectionOf(
      harness.inspect("/account.html", () =>
        Promise.reject(new FlawDotError("TIMEOUT", "The analyzer took too long.")),
      ),
    );
    expect(error).toMatchObject({ code: "TIMEOUT", message: "The analyzer took too long." });
    expect(await openContexts()).toBe(0);
  });
});

describe("a font that never arrives", () => {
  it("says TIMEOUT, and names the font, instead of waiting for ever for the picture", async () => {
    const started = Date.now();
    const error = await rejectionOf(
      harness.take("/slow-font.html", { deps: { navigationTimeoutMs: 3500, quietNetworkMs: 200 } }),
    );
    expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect((error as Error).message).toContain("font");
    expect((error as Error).message).toContain(harness.server.origin);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await openContexts()).toBe(0);
  });
});
