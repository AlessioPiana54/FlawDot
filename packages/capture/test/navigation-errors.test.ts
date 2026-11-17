import { describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { stalled, toFlawDotError } from "../src/navigation-errors.js";
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
    "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self-signed.test/",
  ])("says UNREACHABLE when the browser could not reach the page: %s", (message) => {
    const error = toFlawDotError(new Error(message), { url: URL_WITH_SECRET, signal: live });
    expect(error).toMatchObject({ code: "UNREACHABLE", retryable: true });
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

  it("names only the origin of the page in a message, never the path or the query string", () => {
    const messages = [
      toFlawDotError(playwrightError("TimeoutError", "x"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("net::ERR_FAILED"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("odd"), { url: URL_WITH_SECRET, signal: live }),
      toFlawDotError(new Error("net::ERR_FAILED"), { url: "not a url", signal: live }),
    ].map((error) => error.message);
    for (const message of messages) {
      expect(message).not.toContain("SECRET123");
      expect(message).not.toContain("token");
    }
    expect(messages[0]).toContain("https://example.com");
  });
});
