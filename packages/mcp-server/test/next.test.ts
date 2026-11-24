import { describe, expect, it } from "vitest";
import { defaultSettings, singlePagePlan } from "@flawdot/core-model";
import { createRunRegistry } from "../src/runs.js";
import { textOf } from "./support/connect.js";
import { fakeHandle } from "./support/fake-handle.js";
import { R1 } from "./support/connect.js";
import { createNextTool } from "../src/tools/next.js";
import { makeReport } from "./support/report.js";

// The tool called without the protocol around it: a call that the client cancels never shows its answer to the client,
// so the way it ends can only be seen here.

const plan = singlePagePlan("http://localhost:3000/", {
  viewports: ["desktop"],
  language: "en",
  ai: { kind: "none" },
});

function setup() {
  const runs = createRunRegistry();
  const handle = fakeHandle(R1);
  runs.start(plan, () => handle);
  let reports = 0;
  const tool = createNextTool({
    flawdot: {
      analyze: () => handle,
      report: () => {
        reports += 1;
        return Promise.resolve(makeReport());
      },
    },
    settings: { get: () => Promise.resolve(defaultSettings()) },
    images: () => Promise.reject(new Error("not needed")),
    ai: { kind: "none" },
    log: () => undefined,
    runs,
    waitMs: 60_000,
  });
  return { tool, handle, reports: () => reports };
}

describe("flawdot_next, called without the protocol", () => {
  it("answers at once when the call is cancelled, without waiting for the run or asking for its report", async () => {
    const { tool, handle, reports } = setup();
    const controller = new AbortController();

    const call = tool.run({ runId: R1 }, { signal: controller.signal });
    controller.abort();
    const result = await call;

    expect(textOf(result)).toContain("The wait was cancelled");
    expect(result.isError).toBeUndefined();
    expect(reports()).toBe(0);
    expect(handle.cancelled()).toBe(0);
  });

  it("answers at once when the call was cancelled before it began", async () => {
    const { tool } = setup();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.run({ runId: R1 }, { signal: controller.signal });

    expect(textOf(result)).toContain("The wait was cancelled");
  });
});
