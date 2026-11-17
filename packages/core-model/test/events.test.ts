import { describe, expect, it } from "vitest";
import { PHASES, progressEventSchema } from "../src/index.js";
import { RUN_ULID } from "./fixtures.js";

const step = { runId: RUN_ULID, url: "http://localhost:3000/", viewport: "desktop" } as const;

const validEvents = [
  { type: "run_started", runId: RUN_ULID, total: 6 },
  { type: "phase", ...step, phase: "capture" },
  { type: "capture_done", ...step, findings: 12, costUsd: 0.31 },
  { type: "capture_done", ...step, findings: 0, costUsd: null },
  {
    type: "capture_failed",
    ...step,
    error: { code: "TIMEOUT", message: "The page took too long to load.", retryable: true },
  },
  { type: "run_finished", runId: RUN_ULID, status: "partial" },
] as const;

describe("progressEvent", () => {
  it.each(validEvents)("accepts $type", (event) => {
    expect(progressEventSchema.parse(event)).toEqual(event);
  });

  it("covers every phase of the pipeline", () => {
    expect(PHASES).toEqual(["capture", "rules", "ai", "done"]);
    for (const phase of PHASES) {
      expect(progressEventSchema.safeParse({ type: "phase", ...step, phase }).success).toBe(true);
    }
  });

  it.each([
    ["an unknown type", { type: "run_paused", runId: RUN_ULID }],
    ["no type", { runId: RUN_ULID, total: 1 }],
    ["a negative total", { type: "run_started", runId: RUN_ULID, total: -1 }],
    ["a malformed run id", { type: "run_started", runId: "abc", total: 1 }],
    ["an unknown phase", { type: "phase", ...step, phase: "export" }],
    ["a negative cost", { type: "capture_done", ...step, findings: 1, costUsd: -0.1 }],
    [
      "a fractional findings count",
      { type: "capture_done", ...step, findings: 1.5, costUsd: null },
    ],
    ["a failure with an unknown code", { type: "capture_failed", ...step, error: { code: "X" } }],
    ["a page that is not http(s)", { type: "phase", ...step, url: "file:///a", phase: "ai" }],
    ["an unknown final status", { type: "run_finished", runId: RUN_ULID, status: "paused" }],
  ])("rejects %s", (_why, event) => {
    expect(progressEventSchema.safeParse(event).success).toBe(false);
  });
});
