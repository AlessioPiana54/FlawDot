import { describe, expect, it } from "vitest";
import {
  FlawDotError,
  analysisPlanSchema,
  pathOf,
  singlePagePlan,
  type ViewportName,
} from "../src/index.js";

const options = {
  viewports: ["desktop", "mobile"] as ViewportName[],
  language: "en" as const,
  ai: { kind: "none" as const },
};

const invalid = (url: string, extra = options): FlawDotError => {
  try {
    singlePagePlan(url, extra);
  } catch (error) {
    if (error instanceof FlawDotError) return error;
    throw error;
  }
  throw new Error("expected singlePagePlan to throw");
};

describe("singlePagePlan: one address becomes a plan of one page", () => {
  it("builds a plan that the plan schema accepts, with the options as they are", () => {
    const plan = singlePagePlan("https://shop.example/products/shoes", {
      viewports: ["tablet"],
      language: "it",
      ai: { kind: "subscription" },
    });

    expect(analysisPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan).toEqual({
      projectOrigin: "https://shop.example",
      pages: [
        {
          url: "https://shop.example/products/shoes",
          templateKey: "/products/shoes",
          templateSize: 1,
        },
      ],
      viewports: ["tablet"],
      language: "it",
      ai: { kind: "subscription" },
    });
  });

  it("takes the origin of a local site with its port", () => {
    const plan = singlePagePlan("http://localhost:3000/", options);
    expect(plan.projectOrigin).toBe("http://localhost:3000");
  });

  it("writes the address the same way whatever the spelling, and drops the fragment", () => {
    const plan = singlePagePlan("  HTTP://Example.COM#top  ", options);
    expect(plan.pages[0]?.url).toBe("http://example.com/");
    expect(plan.pages[0]?.templateKey).toBe("/");
  });

  it("keeps the query in the address of the page but not in its template", () => {
    const page = singlePagePlan("https://a.example/blog?page=2&token=abc", options).pages[0];
    expect(page?.url).toBe("https://a.example/blog?page=2&token=abc");
    expect(page?.templateKey).toBe("/blog");
  });

  it.each([
    ["a file address", "file:///etc/passwd"],
    ["a script address", "javascript:alert(1)"],
    ["an ftp address", "ftp://a.example/x"],
    ["an address with a password", "https://user:secret@a.example/"],
    ["an empty text", ""],
    ["only spaces", "   "],
    ["a text that is not an address", "not a url"],
  ])("refuses %s as INVALID_INPUT", (_label, url) => {
    expect(invalid(url).code).toBe("INVALID_INPUT");
  });

  it("does not repeat what it received in the message", () => {
    const message = invalid("https://user:SECRET-PASSWORD@a.example/").message;
    expect(message).not.toContain("SECRET-PASSWORD");
  });

  it("refuses no viewport and a viewport twice", () => {
    expect(invalid("http://a.example/", { ...options, viewports: [] }).code).toBe("INVALID_INPUT");
    expect(
      invalid("http://a.example/", { ...options, viewports: ["desktop", "desktop"] }).code,
    ).toBe("INVALID_INPUT");
  });
});

describe("pathOf: the part of an address that is the page", () => {
  it("gives the path without the query or the fragment", () => {
    expect(pathOf("https://a.example/blog/post?x=1#y")).toBe("/blog/post");
  });

  it("gives / for the root", () => {
    expect(pathOf("https://a.example")).toBe("/");
  });

  it("gives / for an address that cannot be read", () => {
    expect(pathOf("not a url")).toBe("/");
    expect(pathOf("")).toBe("/");
  });
});
