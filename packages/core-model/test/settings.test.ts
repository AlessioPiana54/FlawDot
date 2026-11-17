import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WEIGHTS,
  captureLimitsSchema,
  categoryWeightsSchema,
  defaultSettings,
  settingsSchema,
} from "../src/index.js";

const accepts = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("default settings", () => {
  it("has the values decided for FlawDot", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      weights: { ui: 0.25, ux: 0.25, accessibility: 0.25, conversion: 0.25 },
      defaultLanguage: "en",
      aiTier: "accurate",
      viewports: ["desktop", "mobile"],
      captureLimits: { maxElements: 300, maxHeight: 15000 },
    });
  });

  it("is itself a valid set of settings", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("uses the default category weights", () => {
    expect(DEFAULT_SETTINGS.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("is frozen all the way down, so nobody can change the defaults by accident", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.weights)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.viewports)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.captureLimits)).toBe(true);
  });

  it("gives a fresh copy each time, so a change to one never reaches the defaults or the next copy", () => {
    const first = defaultSettings();
    first.viewports.push("tablet");
    first.captureLimits.maxElements = 999;
    first.weights.ui = 1;
    const second = defaultSettings();
    expect(second).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.viewports).toEqual(["desktop", "mobile"]);
    expect(second).not.toBe(first);
  });
});

describe("capture limits", () => {
  it.each([
    [20, 1000],
    [300, 15000],
    [1000, 50000],
    [20, 1000],
  ])("accepts %i elements and a height of %i px", (maxElements, maxHeight) => {
    expect(accepts(captureLimitsSchema, { maxElements, maxHeight })).toBe(true);
  });

  it.each([
    ["19 elements", { maxElements: 19, maxHeight: 15000 }],
    ["1001 elements", { maxElements: 1001, maxHeight: 15000 }],
    ["a height of 999 px", { maxElements: 300, maxHeight: 999 }],
    ["a height of 50001 px", { maxElements: 300, maxHeight: 50001 }],
    ["300.5 elements", { maxElements: 300.5, maxHeight: 15000 }],
    ["a height that is not a number", { maxElements: 300, maxHeight: "15000" }],
    ["a missing height", { maxElements: 300 }],
    ["an extra key", { maxElements: 300, maxHeight: 15000, maxDepth: 4 }],
  ])("rejects %s", (_why, value) => {
    expect(accepts(captureLimitsSchema, value)).toBe(false);
  });
});

describe("settings", () => {
  const valid = defaultSettings();

  it.each([
    ["a missing field", (({ aiTier: _aiTier, ...rest }) => rest)(valid)],
    ["an unknown language", { ...valid, defaultLanguage: "de" }],
    ["an unknown AI tier", { ...valid, aiTier: "cheap" }],
    ["no viewport at all", { ...valid, viewports: [] }],
    ["the same viewport twice", { ...valid, viewports: ["mobile", "mobile"] }],
    ["an unknown viewport", { ...valid, viewports: ["watch"] }],
    ["weights that do not add up to 1", { ...valid, weights: { ...valid.weights, ui: 0.5 } }],
    ["an extra key in the weights", { ...valid, weights: { ...valid.weights, seo: 0 } }],
    ["an extra key", { ...valid, theme: "dark" }],
    ["limits out of range", { ...valid, captureLimits: { maxElements: 5, maxHeight: 15000 } }],
  ])("rejects %s", (_why, value) => {
    expect(accepts(settingsSchema, value)).toBe(false);
  });

  it("accepts every viewport once, in any order", () => {
    expect(accepts(settingsSchema, { ...valid, viewports: ["tablet", "mobile", "desktop"] })).toBe(
      true,
    );
  });

  it("makes every key of the weights strict as well", () => {
    expect(accepts(categoryWeightsSchema, { ...DEFAULT_WEIGHTS, seo: 0 })).toBe(false);
  });
});
