import { describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { loginRequired, notAWebPage, stalled, toFlawDotError } from "../src/navigation-errors.js";
import { idleSignal } from "./support/fakes.js";

const URL_WITH_SECRET = "https://example.com/path?token=SECRET123&x=1";
const live = idleSignal;
const aborted = { ...idleSignal, aborted: true };

function playwrightError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("toFlawDotError", () => {
  it("returns a FlawDotError as it is, even when the signal was aborted", () => {
    const original = new FlawDotError("LOGIN_REQUIRED", "Log in first.");
    expect(toFlawDotError(original, { url: URL_WITH_SECRET, signal: live })).toBe(original);
    expect(toFlawDotError(original, { url: URL_WITH_SECRET, signal: aborted })).toBe(original);
  });

  it("says CANCELLED when the signal was aborted, whatever the error was", () => {
    const error = toFlawDotError(playwrightError("TimeoutError", "boom"), {
      url: URL_WITH_SECRET,
      signal: aborted,
    });
    expect(error).toMatchObject({ code: "CANCELLED", retryable: false });
  });

  it("says TIMEOUT for a Playwright timeout, and allows another try", () => {
    const error = toFlawDotError(playwrightError("TimeoutError", "page.goto: Timeout 30000ms"), {
      url: URL_WITH_SECRET,
      signal: live,
    });
    expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it.each([
    "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/",
    "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.invalid/",
  ])("says UNREACHABLE when the browser could not reach the page: %s", (message) => {
    const error = toFlawDotError(new Error(message), { url: URL_WITH_SECRET, signal: live });
    expect(error).toMatchObject({ code: "UNREACHABLE", retryable: true });
  });

  it.each([
    "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self-signed.test/",
    "page.goto: net::ERR_CERT_COMMON_NAME_INVALID at https://wrong-host.test/",
    "page.goto: net::ERR_CERT_DATE_INVALID at https://expired.test/",
    "page.goto: net::ERR_SSL_PROTOCOL_ERROR at https://127.0.0.1:3000/",
  ])(
    "says UNREACHABLE, not worth another try, for a certificate or HTTPS problem: %s",
    (message) => {
      const original = new Error(message);
      const error = toFlawDotError(original, { url: URL_WITH_SECRET, signal: live });
      expect(error).toMatchObject({ code: "UNREACHABLE", retryable: false });
      expect(error.message).toMatch(/certificate/i);
      expect(error.message).not.toContain("check that the site is running");
      expect(error.cause).toBe(original);
    },
  );

  it.each([
    "page.goto: Download is starting",
    "page.goto: net::ERR_ABORTED at https://example.com/report.pdf",
  ])(
    "says INVALID_INPUT, not a retry, for an address that is a file to download: %s",
    (message) => {
      const original = new Error(message);
      const error = toFlawDotError(original, { url: URL_WITH_SECRET, signal: live });
      expect(error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
      expect(error.cause).toBe(original);
    },
  );

  it("says CANCELLED, not INVALID_INPUT, for an ERR_ABORTED that the caller caused by aborting", () => {
    const error = toFlawDotError(new Error("page.goto: net::ERR_ABORTED"), {
      url: URL_WITH_SECRET,
      signal: aborted,
    });
    expect(error.code).toBe("CANCELLED");
  });

  it("says INTERNAL for anything else, and keeps the original as the cause", () => {
    const original = new Error("something odd");
    const error = toFlawDotError(original, { url: URL_WITH_SECRET, signal: live });
    expect(error).toMatchObject({ code: "INTERNAL", retryable: false });
    expect(error.cause).toBe(original);
  });

  it("copes with a thrown value that is not an Error", () => {
    expect(toFlawDotError("text", { url: URL_WITH_SECRET, signal: live }).code).toBe("INTERNAL");
    expect(toFlawDotError(undefined, { url: URL_WITH_SECRET, signal: live }).code).toBe("INTERNAL");
  });

  it("says TIMEOUT, retryable, for a page that stops answering while it is measured", () => {
    const error = stalled(URL_WITH_SECRET);
    expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(error.message).toContain("https://example.com");
    expect(error.message).not.toContain("SECRET123");
    expect(stalled("not a url").message).toContain("the page");
  });

  describe("loginRequired", () => {
    it("tells the user to log in, for a 401 or when the status is not known", () => {
      for (const error of [loginRequired(URL_WITH_SECRET), loginRequired(URL_WITH_SECRET, 401)]) {
        expect(error).toMatchObject({ code: "LOGIN_REQUIRED", retryable: false });
        expect(error.message).toContain("Log in to the site");
        expect(error.message).not.toContain("403");
      }
    });

    it("names both causes for a 403: it may need a login, or it may be keeping automated visits out", () => {
      const error = loginRequired(URL_WITH_SECRET, 403);
      expect(error).toMatchObject({ code: "LOGIN_REQUIRED", retryable: false });
      expect(error.message).toContain("403");
      expect(error.message).toContain("log in");
      expect(error.message).toContain("blocks automated visits");
      expect(error.message).toContain("https://example.com");
      expect(error.message).not.toContain("SECRET123");
    });
  });

  describe("while the picture is being taken", () => {
    const picture = { url: URL_WITH_SECRET, signal: live, phase: "picture" } as const;

    it("says what usually holds it up when Playwright gives up on the screenshot", () => {
      const error = toFlawDotError(
        playwrightError("TimeoutError", "page.screenshot: Timeout 30000ms exceeded."),
        picture,
      );
      expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
      expect(error.message).toContain("font");
      expect(error.message).toContain("https://example.com");
    });

    it("says the same when it is the deadline of the capture that fires first", () => {
      const error = toFlawDotError(stalled(URL_WITH_SECRET), picture);
      expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
      expect(error.message).toContain("font");
    });

    it("leaves every other error as it would be", () => {
      const original = new FlawDotError("INVALID_INPUT", "Nope.");
      expect(toFlawDotError(original, picture)).toBe(original);
      expect(toFlawDotError(new Error("net::ERR_FAILED"), picture).code).toBe("UNREACHABLE");
      expect(
        toFlawDotError(playwrightError("TimeoutError", "x"), { ...picture, signal: aborted }).code,
      ).toBe("CANCELLED");
    });

    it("keeps the message about the load for a timeout that is not in the picture phase", () => {
      for (const where of [{}, { phase: "loading" }, { phase: "measuring" }] as const) {
        const error = toFlawDotError(playwrightError("TimeoutError", "page.goto: Timeout"), {
          url: URL_WITH_SECRET,
          signal: live,
          ...where,
        });
        expect(error.message).toContain("did not finish loading");
      }
    });
  });

  it("names only the origin of the page in a message, never the path or the query string", () => {
    const messages = [
      toFlawDotError(playwrightError("TimeoutError", "x"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("net::ERR_FAILED"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("odd"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("net::ERR_FAILED"), { url: "not a url", signal: live }),
      toFlawDotError(new Error("net::ERR_CERT_DATE_INVALID"), {
        url: URL_WITH_SECRET,
        signal: live,
      }),
      toFlawDotError(new Error("Download is starting"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(playwrightError("TimeoutError", "page.screenshot: Timeout"), {
        url: URL_WITH_SECRET,
        signal: live,
        phase: "picture",
      }),
      loginRequired(URL_WITH_SECRET),
      notAWebPage(URL_WITH_SECRET),
    ].map((error) => error.message);
    for (const message of messages) {
      expect(message).not.toContain("SECRET123");
      expect(message).not.toContain("token");
    }
    expect(messages[0]).toContain("https://example.com");
  });
});
