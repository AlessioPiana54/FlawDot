import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserProvider } from "@flawdot/capture";
import { FlawDotError, singlePagePlan } from "@flawdot/core-model";
import { composeCore } from "../src/compose-core.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flawdot-core-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A browser that cannot start, and counts how many times it is closed. */
function brokenBrowser() {
  const closed = { times: 0 };
  const browser: BrowserProvider = {
    get: () => Promise.reject(new FlawDotError("INTERNAL", "Could not start Chromium.")),
    close: () => {
      closed.times += 1;
      return Promise.resolve();
    },
  };
  return { browser, closed };
}

const plan = singlePagePlan("http://127.0.0.1:9/", {
  viewports: ["desktop"],
  language: "en",
  ai: { kind: "none" },
});

describe("composeCore", () => {
  it("builds a kernel on which an analysis runs from the capture to the report", async () => {
    const { browser } = brokenBrowser();
    const kernel = composeCore({ home, browser }).createKernel("mcp");

    const handle = kernel.analyze(plan);
    const summary = await handle.done;
    const report = await kernel.report(handle.runId);

    // The browser cannot start, so the capture fails, and that is a result: the run is saved and can be reported.
    expect(summary.captures).toMatchObject({ total: 1, done: 0, failed: 1 });
    expect(report.pages[0]).toMatchObject({ status: "failed", error: { code: "INTERNAL" } });
  });

  it("tells the run how it was started", async () => {
    const { browser } = brokenBrowser();
    const core = composeCore({ home, browser });

    for (const entry of ["web", "mcp"] as const) {
      const kernel = core.createKernel(entry);
      const handle = kernel.analyze(plan);
      await handle.done;
      expect((await kernel.report(handle.runId)).run.entry).toBe(entry);
    }
  });

  it("gives the settings, which are the default ones until the user changes them", async () => {
    const { browser } = brokenBrowser();

    const settings = await composeCore({ home, browser }).settings.get();

    expect(settings.viewports).toEqual(["desktop", "mobile"]);
    expect(settings.defaultLanguage).toBe("en");
  });

  it("closes the browser when it is closed", async () => {
    const { browser, closed } = brokenBrowser();

    await composeCore({ home, browser }).close();

    expect(closed.times).toBe(1);
  });
});
