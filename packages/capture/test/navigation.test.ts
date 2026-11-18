import { describe, expect, it, vi } from "vitest";
import type { Guard } from "../src/guard.js";
import {
  checkArrival,
  finalUrlFor,
  isHtmlType,
  looksLikeLoginPath,
  movedToOtherPath,
} from "../src/navigation.js";
import { rejectionOf } from "./support/fakes.js";

const noGuard: Guard = (work) => work;

describe("looksLikeLoginPath", () => {
  it.each([
    "https://example.com/login",
    "https://example.com/Login/",
    "https://example.com/signin",
    "https://example.com/sign-in",
    "https://example.com/users/sign_in",
    "https://example.com/account/login.html",
    "https://example.com/log-in?next=/dashboard",
    "https://example.com/auth",
    "https://example.com/sso/start",
    "https://example.com/authenticate",
  ])("recognises %s", (url) => {
    expect(looksLikeLoginPath(url)).toBe(true);
  });

  it.each([
    "https://example.com/",
    "https://example.com/dashboard",
    "https://example.com/blog/author",
    "https://example.com/authors",
    "https://example.com/blog/auth-guide",
    "https://example.com/loginfo",
    "https://example.com/logout",
    "https://example.com/?page=login",
  ])("does not mistake %s for a login page", (url) => {
    expect(looksLikeLoginPath(url)).toBe(false);
  });

  it("is false for text that is not a URL", () => {
    expect(looksLikeLoginPath("not a url")).toBe(false);
  });
});

describe("movedToOtherPath", () => {
  it.each([
    ["the same address", "https://example.com/a", "https://example.com/a"],
    ["a trailing slash", "https://example.com/a", "https://example.com/a/"],
    ["the bare origin and the same with a slash", "https://example.com", "https://example.com/"],
    ["another query", "https://example.com/a?x=1", "https://example.com/a?x=2"],
    ["a hash", "https://example.com/a", "https://example.com/a#top"],
    ["upper case in the path", "https://example.com/About", "https://example.com/about"],
    ["https instead of http", "http://example.com/a", "https://example.com/a"],
    ["www in front of the host", "https://example.com/a", "https://www.example.com/a"],
    ["a language prefix on the home page", "https://example.com/", "https://example.com/en/"],
    ["a language prefix on a page", "https://example.com/about", "https://example.com/it/about"],
    [
      "a language and region prefix",
      "https://example.com/about",
      "https://example.com/en-US/about",
    ],
    [
      "a language prefix that goes away",
      "https://example.com/fr/about",
      "https://example.com/about",
    ],
  ])("is false for %s", (_why, requested, final) => {
    expect(movedToOtherPath(requested, final)).toBe(false);
  });

  it.each([
    ["another path", "https://example.com/a", "https://example.com/b"],
    ["another host", "https://example.com/a", "https://accounts.example.org/a"],
    ["another port", "http://localhost:3000/a", "http://localhost:4000/a"],
    ["a deeper path", "https://example.com/", "https://example.com/shop/"],
    [
      "another page under the same language prefix",
      "https://example.com/en/a",
      "https://example.com/en/b",
    ],
    [
      "a login page under a language prefix",
      "https://example.com/",
      "https://example.com/en/login",
    ],
    [
      "a segment of three letters, which is not a language",
      "https://example.com/",
      "https://example.com/faq",
    ],
  ])("is true for %s", (_why, requested, final) => {
    expect(movedToOtherPath(requested, final)).toBe(true);
  });

  it("is false when an address cannot be read, so nothing is called a login by mistake", () => {
    expect(movedToOtherPath("not a url", "https://example.com/")).toBe(false);
    expect(movedToOtherPath("https://example.com/", "not a url")).toBe(false);
  });
});

describe("isHtmlType", () => {
  it.each([
    "text/html",
    "text/html; charset=utf-8",
    "TEXT/HTML",
    "application/xhtml+xml",
    undefined,
    "",
  ])("accepts %j as a web page", (type) => {
    expect(isHtmlType(type)).toBe(true);
  });

  it.each([
    "application/pdf",
    "application/json",
    "application/octet-stream",
    "image/png",
    "text/plain",
  ])("rejects %s", (type) => {
    expect(isHtmlType(type)).toBe(false);
  });
});

describe("finalUrlFor", () => {
  it("is nothing when the page was not redirected, however the address is written", () => {
    expect(finalUrlFor("https://example.com/a", "https://example.com/a")).toBeUndefined();
    expect(finalUrlFor("https://example.com", "https://example.com/")).toBeUndefined();
    expect(finalUrlFor("https://example.com/a#top", "https://example.com/a")).toBeUndefined();
  });

  it("is the address the browser ended at, when it is another", () => {
    expect(finalUrlFor("https://example.com/a", "https://example.com/en/a?x=1")).toBe(
      "https://example.com/en/a?x=1",
    );
  });

  it("leaves out a user name, a password and the hash", () => {
    expect(finalUrlFor("https://example.com/a", "https://user:secret@example.com/b#frag")).toBe(
      "https://example.com/b",
    );
  });

  it("is nothing for an address that is not http(s), or cannot be read", () => {
    expect(finalUrlFor("https://example.com/a", "about:blank")).toBeUndefined();
    expect(finalUrlFor("https://example.com/a", "chrome-error://chromewebdata/")).toBeUndefined();
    expect(finalUrlFor("https://example.com/a", "not a url")).toBeUndefined();
    expect(finalUrlFor("not a url", "https://example.com/a")).toBeUndefined();
  });
});

function arrival(options: {
  requested?: string;
  final?: string;
  status?: number;
  contentType?: string;
  passwordFields?: number;
  noResponse?: boolean;
}) {
  const evaluate = vi.fn(() => Promise.resolve(options.passwordFields ?? 0));
  const requested = options.requested ?? "https://example.com/account";
  const page = { url: () => options.final ?? requested, evaluate };
  const response = options.noResponse
    ? null
    : {
        status: () => options.status ?? 200,
        headers: (): Record<string, string> =>
          options.contentType === undefined ? {} : { "content-type": options.contentType },
      };
  return { evaluate, run: () => checkArrival(page, response, requested, noGuard) };
}

describe("checkArrival", () => {
  it.each([401, 403])("says LOGIN_REQUIRED for a %i, with no redirect at all", async (status) => {
    const { run, evaluate } = arrival({ status });
    expect(await rejectionOf(run())).toMatchObject({ code: "LOGIN_REQUIRED", retryable: false });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("says LOGIN_REQUIRED for a 401 that came after a redirect to a page that is not a login", async () => {
    const { run } = arrival({ status: 401, final: "https://example.com/area" });
    expect(await rejectionOf(run())).toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it.each([404, 410, 500, 503])(
    "lets a %i through: it is a page, with its own problems",
    async (status) => {
      await expect(arrival({ status }).run()).resolves.toBeUndefined();
    },
  );

  it.each(["application/pdf", "application/json", "image/png"])(
    "says INVALID_INPUT, not retryable, for a %s",
    async (contentType) => {
      const { run } = arrival({ contentType });
      expect(await rejectionOf(run())).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    },
  );

  it("says LOGIN_REQUIRED for a redirect to a login path, without looking for a password field", async () => {
    const { run, evaluate } = arrival({ final: "https://example.com/login?next=/account" });
    expect(await rejectionOf(run())).toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("says LOGIN_REQUIRED for a redirect to another path that has one password field", async () => {
    const { run, evaluate } = arrival({ final: "https://example.com/welcome", passwordFields: 1 });
    expect(await rejectionOf(run())).toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3])(
    "lets a redirect through to a page with %i password fields: a sign-up or change-password form, not a login",
    async (passwordFields) => {
      const { run } = arrival({ final: "https://example.com/welcome", passwordFields });
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("lets a redirect to another path with no password field through", async () => {
    const { run, evaluate } = arrival({ final: "https://example.com/en/", passwordFields: 0 });
    await expect(run()).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("captures a login page that was asked for directly, and does not look for a password field", async () => {
    const { run, evaluate } = arrival({
      requested: "https://example.com/login",
      passwordFields: 1,
    });
    await expect(run()).resolves.toBeUndefined();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("does not look for a password field when the page did not move", async () => {
    const { run, evaluate } = arrival({ passwordFields: 3 });
    await expect(run()).resolves.toBeUndefined();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("goes by the address alone when the navigation gave no response", async () => {
    const { run } = arrival({ noResponse: true, final: "https://example.com/sign-in" });
    expect(await rejectionOf(run())).toMatchObject({ code: "LOGIN_REQUIRED" });
    await expect(arrival({ noResponse: true }).run()).resolves.toBeUndefined();
  });

  it("names only the origin of the page in what it throws", async () => {
    const requested = "https://example.com/private?token=SECRET123";
    const { run } = arrival({ requested, status: 401 });
    const error = await rejectionOf(run());
    expect((error as Error).message).toContain("https://example.com");
    expect((error as Error).message).not.toContain("SECRET123");
  });

  it("asks the guard to bound the look for a password field", async () => {
    let guarded = 0;
    const guard: Guard = (work) => {
      guarded += 1;
      return work;
    };
    const evaluate = vi.fn(() => Promise.resolve(0));
    const page = { url: () => "https://example.com/shop/", evaluate };
    await checkArrival(page, null, "https://example.com/", guard);
    expect(guarded).toBe(1);
  });
});
