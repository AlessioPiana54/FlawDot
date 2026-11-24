import { describe, expect, it } from "vitest";
import { severityOf } from "../src/severity.js";

describe("severityOf: how bad an axe impact is for FlawDot", () => {
  it.each([
    ["critical", "critical"],
    ["serious", "critical"],
    ["moderate", "medium"],
    ["minor", "low"],
  ] as const)("axe %s is %s", (impact, severity) => {
    expect(severityOf(impact)).toBe(severity);
  });

  it("calls an impact that axe did not give medium: a violation always has one, but it must not crash", () => {
    expect(severityOf(null)).toBe("medium");
  });
});
