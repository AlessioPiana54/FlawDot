import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkNode, resolveHome } from "../src/env.js";

describe("checkNode", () => {
  it.each(["24.0.0", "24.22.3", "26.13.1", "30.1.0"])("accepts Node %s", (version) => {
    expect(checkNode(version)).toBeNull();
  });

  it.each(["22.11.0", "23.9.0", "20.0.0", "18.20.4", "9.9.9"])(
    "refuses Node %s with a message that says what to do",
    (version) => {
      expect(checkNode(version)).toBe(
        `FlawDot needs Node.js 24 or newer (you have ${version}). Install the LTS from nodejs.org.`,
      );
    },
  );

  it("refuses a version it cannot read, rather than letting it through", () => {
    expect(checkNode("")).toContain("needs Node.js 24");
    expect(checkNode("banana")).toContain("needs Node.js 24");
  });
});

describe("resolveHome", () => {
  it("is the folder .flawdot in the home of the user when FLAWDOT_HOME is not set", () => {
    expect(resolveHome({}, "/home/ann")).toBe(resolve("/home/ann", ".flawdot"));
  });

  it("is FLAWDOT_HOME when it is set, as an absolute path", () => {
    const home = resolveHome({ FLAWDOT_HOME: join("data", "flawdot") }, "/home/ann");

    expect(isAbsolute(home)).toBe(true);
    expect(home).toBe(resolve("data", "flawdot"));
  });

  it("ignores a FLAWDOT_HOME that is empty or only spaces", () => {
    expect(resolveHome({ FLAWDOT_HOME: "" }, "/home/ann")).toBe(resolve("/home/ann", ".flawdot"));
    expect(resolveHome({ FLAWDOT_HOME: "   " }, "/home/ann")).toBe(
      resolve("/home/ann", ".flawdot"),
    );
  });
});
