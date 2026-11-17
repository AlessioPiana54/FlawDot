import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  DEFAULT_VIEWPORTS,
  ELEMENT_NAME_MAX,
  REPORT_LANGUAGES,
  SEVERITIES,
  VIEWPORT_NAMES,
  aiModeSchema,
  boxSchema,
  captureSchema,
  elementSchema,
  pageTargetSchema,
  projectSchema,
  runSchema,
  truncateElementName,
  viewportSchema,
} from "../src/index.js";
import { capture, element, pageTarget, run } from "./fixtures.js";

const rejects = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) =>
  expect(schema.safeParse(value).success).toBe(false);

describe("constants", () => {
  it("lists severities from most to least severe (numbering relies on it)", () => {
    expect(SEVERITIES).toEqual(["critical", "medium", "low"]);
  });

  it("keeps the vocabulary of the spec", () => {
    expect(CATEGORIES).toEqual(["ui", "ux", "accessibility", "conversion"]);
    expect(VIEWPORT_NAMES).toEqual(["desktop", "tablet", "mobile"]);
    expect(REPORT_LANGUAGES).toEqual(["en", "it"]);
  });

  it("defines the three default viewports with the decided sizes", () => {
    expect(DEFAULT_VIEWPORTS.desktop).toMatchObject({ width: 1440, height: 900 });
    expect(DEFAULT_VIEWPORTS.tablet).toMatchObject({ width: 768, height: 1024 });
    expect(DEFAULT_VIEWPORTS.mobile).toMatchObject({ width: 390, height: 844 });
    for (const [name, viewport] of Object.entries(DEFAULT_VIEWPORTS)) {
      expect(viewport.name).toBe(name);
      expect(viewportSchema.safeParse(viewport).success).toBe(true);
    }
  });
});

describe("viewport", () => {
  it.each([
    ["zero width", { ...DEFAULT_VIEWPORTS.desktop, width: 0 }],
    ["fractional height", { ...DEFAULT_VIEWPORTS.desktop, height: 900.5 }],
    ["unknown name", { ...DEFAULT_VIEWPORTS.desktop, name: "watch" }],
    ["pixel ratio above 4", { ...DEFAULT_VIEWPORTS.desktop, deviceScaleFactor: 5 }],
  ])("rejects %s", (_why, value) => rejects(viewportSchema, value));
});

describe("aiMode", () => {
  it.each([
    { kind: "none" },
    { kind: "subscription" },
    { kind: "byok", model: "claude-haiku-5-5", tier: "economy" },
  ])("accepts %j", (value) => {
    expect(aiModeSchema.parse(value)).toEqual(value);
  });

  it.each([
    ["unknown kind", { kind: "local" }],
    ["byok without a model", { kind: "byok", tier: "accurate" }],
    ["byok with an empty model", { kind: "byok", model: "", tier: "accurate" }],
    ["byok with an unknown tier", { kind: "byok", model: "m", tier: "cheap" }],
  ])("rejects %s", (_why, value) => rejects(aiModeSchema, value));
});

describe("project and page target", () => {
  it("accepts a localhost origin", () => {
    const project = {
      id: "localhost-3000",
      origin: "http://localhost:3000",
      createdAt: "2026-11-17T10:00:00.000Z",
    };
    expect(projectSchema.parse(project)).toEqual(project);
  });

  it.each([
    ["a file URL", "file:///etc/passwd"],
    ["an ftp URL", "ftp://example.com/a"],
    ["a javascript URL", "javascript:alert(1)"],
    ["text that is not a URL", "not a url"],
  ])("rejects %s as page URL", (_why, url) => {
    rejects(pageTargetSchema, { ...pageTarget, url });
  });

  it.each([
    ["an empty template key", { templateKey: "" }],
    ["zero pages in the group", { templateSize: 0 }],
  ])("rejects %s", (_why, patch) => rejects(pageTargetSchema, { ...pageTarget, ...patch }));
});

describe("run", () => {
  it("accepts a finished run with another AI mode", () => {
    const finished = {
      ...run,
      finishedAt: "2026-11-17T10:05:00.000Z",
      entry: "mcp",
      ai: { kind: "subscription" },
      status: "completed",
    };
    expect(runSchema.parse(finished)).toEqual(finished);
  });

  it.each([
    ["no viewports", { viewports: [] }],
    ["no pages", { pages: [] }],
    ["an unknown status", { status: "paused" }],
    ["an unknown entry", { entry: "cli" }],
    ["a date without timezone", { startedAt: "2026-11-17T10:00:00" }],
    ["a date that is not ISO", { startedAt: "yesterday" }],
    ["an unsupported language", { language: "de" }],
  ])("rejects %s", (_why, patch) => rejects(runSchema, { ...run, ...patch }));
});

describe("box", () => {
  it("accepts a box with a fractional position", () => {
    expect(boxSchema.parse({ x: -5, y: 0.5, width: 0, height: 10 })).toBeDefined();
  });

  it.each([
    ["negative width", { x: 0, y: 0, width: -1, height: 1 }],
    ["negative height", { x: 0, y: 0, width: 1, height: -1 }],
    ["infinite position", { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 }],
    ["NaN size", { x: 0, y: 0, width: Number.NaN, height: 1 }],
  ])("rejects %s", (_why, value) => rejects(boxSchema, value));
});

describe("element", () => {
  it("accepts an element with no role and no accessible name", () => {
    expect(elementSchema.safeParse({ ...element, role: null, name: null }).success).toBe(true);
  });

  it("accepts an accessible name of exactly 120 characters and rejects 121", () => {
    expect(
      elementSchema.safeParse({ ...element, name: "a".repeat(ELEMENT_NAME_MAX) }).success,
    ).toBe(true);
    rejects(elementSchema, { ...element, name: "a".repeat(ELEMENT_NAME_MAX + 1) });
  });

  // Literal numbers on purpose: the spec says 120, so changing the constant must break this test.
  it("cuts the accessible name at 120 characters, as the spec says", () => {
    expect(ELEMENT_NAME_MAX).toBe(120);
    expect(elementSchema.safeParse({ ...element, name: "a".repeat(120) }).success).toBe(true);
    rejects(elementSchema, { ...element, name: "a".repeat(121) });
  });

  it.each([
    ["mark 0", { mark: 0 }],
    ["an empty selector", { selector: "" }],
    ["an empty tag", { tag: "" }],
  ])("rejects %s", (_why, patch) => rejects(elementSchema, { ...element, ...patch }));
});

describe("truncateElementName", () => {
  it("leaves a name that already fits untouched, including one of exactly 120 characters", () => {
    expect(truncateElementName("Start free trial")).toBe("Start free trial");
    expect(truncateElementName("a".repeat(120))).toBe("a".repeat(120));
    expect(truncateElementName("")).toBe("");
  });

  it("cuts a longer name to 120 characters", () => {
    expect(truncateElementName("a".repeat(500))).toBe("a".repeat(120));
  });

  it("does not leave half of an emoji at the cut", () => {
    // The emoji takes two UTF-16 units; here its first unit would be the 120th character.
    const split = "a".repeat(119) + "😀" + "b";
    const cut = truncateElementName(split);
    expect(cut).toBe("a".repeat(119));
    expect(cut.length).toBeLessThanOrEqual(120);
  });

  it("keeps an emoji that ends exactly at the cut", () => {
    const whole = "a".repeat(118) + "😀" + "b";
    expect(truncateElementName(whole)).toBe("a".repeat(118) + "😀");
  });

  it("always gives a name the element schema accepts", () => {
    for (const name of ["x".repeat(121), "😀".repeat(200), "é".repeat(121)]) {
      const parsed = elementSchema.safeParse({ ...element, name: truncateElementName(name) });
      expect(parsed.success, name.slice(0, 5)).toBe(true);
    }
  });
});

describe("capture", () => {
  it("accepts a capture with no title and no elements", () => {
    expect(captureSchema.safeParse({ ...capture, title: null, elements: [] }).success).toBe(true);
  });

  it.each([
    ["an empty screenshot path", { screenshot: { path: "", width: 1, height: 1 } }],
    ["a zero-size screenshot", { screenshot: { path: "a.png", width: 0, height: 1 } }],
    ["no marked image", { marked: undefined }],
    ["an invalid element inside", { elements: [{ ...element, mark: -1 }] }],
  ])("rejects %s", (_why, patch) => rejects(captureSchema, { ...capture, ...patch }));
});
