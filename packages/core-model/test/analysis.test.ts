import { describe, expect, it } from "vitest";
import { analysisPlanSchema, runSummarySchema } from "../src/index.js";
import { RUN_ULID, pageTarget } from "./fixtures.js";

const plan = {
  projectOrigin: "http://localhost:3000",
  pages: [pageTarget],
  viewports: ["desktop", "mobile"],
  language: "en",
  ai: { kind: "none" },
} as const;

describe("analysisPlan", () => {
  it("accepts a plan of one page", () => {
    expect(analysisPlanSchema.parse(plan)).toEqual(plan);
  });

  it("keeps two pages that differ in the query: they are not the same page", () => {
    const other = { ...pageTarget, url: "http://localhost:3000/blog/hello?page=2" };

    expect(analysisPlanSchema.safeParse({ ...plan, pages: [pageTarget, other] }).success).toBe(
      true,
    );
  });

  it("accepts many pages on the origin of the project", () => {
    const other = { url: "http://localhost:3000/about", templateKey: "/about", templateSize: 1 };

    expect(analysisPlanSchema.safeParse({ ...plan, pages: [pageTarget, other] }).success).toBe(
      true,
    );
  });

  it.each([
    ["no page", { pages: [] }],
    ["no viewport", { viewports: [] }],
    ["a page twice", { pages: [pageTarget, pageTarget] }],
    [
      "a page twice, written with capital letters",
      { pages: [pageTarget, { ...pageTarget, url: "HTTP://LOCALHOST:3000/blog/hello" }] },
    ],
    [
      "a page twice, with a fragment",
      { pages: [pageTarget, { ...pageTarget, url: "http://localhost:3000/blog/hello#top" }] },
    ],
    [
      "the home page twice, with and without the slash",
      {
        pages: [
          { url: "http://localhost:3000", templateKey: "/", templateSize: 1 },
          { url: "http://localhost:3000/", templateKey: "/", templateSize: 1 },
        ],
      },
    ],
    ["a viewport twice", { viewports: ["desktop", "desktop"] }],
    ["an unknown viewport", { viewports: ["watch"] }],
    [
      "a page of another site",
      { pages: [{ url: "https://example.com/", templateKey: "/", templateSize: 1 }] },
    ],
    ["an origin that is not http", { projectOrigin: "ftp://localhost:3000" }],
    ["an origin with a password", { projectOrigin: "http://user:secret@localhost:3000" }],
    ["a language that does not exist", { language: "fr" }],
    ["an AI mode that does not exist", { ai: { kind: "magic" } }],
    ["a key that is not part of the plan", { entry: "web" }],
  ])("rejects %s", (_label, change) => {
    expect(analysisPlanSchema.safeParse({ ...plan, ...change }).success).toBe(false);
  });
});

const summary = {
  runId: RUN_ULID,
  projectId: "localhost-3000",
  status: "partial",
  entry: "mcp",
  startedAt: "2026-11-19T10:00:00.000Z",
  finishedAt: "2026-11-19T10:01:00.000Z",
  captures: { total: 4, done: 2, failed: 1, notRun: 1 },
  findings: 7,
  score: 81,
  band: "good",
  needsReview: 3,
} as const;

describe("runSummary", () => {
  it("accepts the summary of a finished run, with and without a score", () => {
    expect(runSummarySchema.parse(summary)).toEqual(summary);
    expect(runSummarySchema.safeParse({ ...summary, score: null, band: null }).success).toBe(true);
  });

  it.each([
    ["a run that is still running", { status: "running" }],
    ["no end time", { finishedAt: null }],
    ["a negative count", { captures: { total: 4, done: -1, failed: 1, notRun: 1 } }],
    ["a score over 100", { score: 101 }],
    ["a band that does not exist", { band: "great" }],
  ])("rejects %s", (_label, change) => {
    expect(runSummarySchema.safeParse({ ...summary, ...change }).success).toBe(false);
  });
});
