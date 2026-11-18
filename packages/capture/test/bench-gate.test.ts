import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The gate of the benchmarks lives in scripts/, which is not a package; the tests of scripts live here, with the
// first benchmark (B3) that it judges.
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/bench-gate.mjs");

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "flawdot-bench-"));
  mkdirSync(join(folder, "results"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const writeLimits = (limits: unknown): void => {
  writeFileSync(join(folder, "limits.json"), JSON.stringify(limits));
};
const writeResult = (content: unknown, name = "B3.json"): void => {
  writeFileSync(
    join(folder, "results", name),
    typeof content === "string" ? content : JSON.stringify(content),
  );
};
const LIMITS = { B3: { warnMs: 5000, failMs: 10_000 } };

function gate(env: Record<string, string> = {}) {
  const run = spawnSync(
    process.execPath,
    [SCRIPT, "--results", join(folder, "results"), "--limits", join(folder, "limits.json")],
    { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env } },
  );
  return { code: run.status, out: run.stdout, err: run.stderr };
}

describe("bench-gate", () => {
  it("passes, quietly, when every series is within its limit", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [1200, 1300], mobile: [1500] } });
    const result = gate();
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("::warning::");
    expect(result.out).toContain("B3 desktop: mean 1250 ms");
  });

  it("warns, and still passes, above the limit", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [1000], mobile: [6000, 7000] } });
    const result = gate();
    expect(result.code).toBe(0);
    expect(result.out).toContain("::warning::B3 mobile: mean 6500 ms");
    expect(result.out).not.toContain("::warning::B3 desktop");
  });

  it("fails above twice the limit", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [1000], tablet: [12_000, 11_000] } });
    const result = gate();
    expect(result.code).toBe(1);
    expect(result.err).toContain("::error::B3 tablet: mean 11500 ms");
  });

  it("judges the mean, so one slow run among fast ones does not fail it", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [1000, 1000, 1000, 1000, 11_000] } });
    const result = gate();
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("::warning::"); // the mean is 3000, below 5000
    expect(result.out).toContain("max 11000 ms");
  });

  it("does not cross a limit it only equals: warnMs gives no warning, failMs gives a warning but no failure", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [5000], mobile: [10_000] } });
    const result = gate();
    expect(result.code).toBe(0);
    expect(result.out).toContain("::warning::B3 mobile");
    expect(result.out).not.toContain("::warning::B3 desktop");
  });

  it("writes a table to the summary of the CI run when GitHub gives it a file", () => {
    writeLimits(LIMITS);
    writeResult({ id: "B3", samplesMs: { desktop: [1200] } });
    const summary = join(folder, "summary.md");
    expect(gate({ GITHUB_STEP_SUMMARY: summary }).code).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("### Benchmarks");
    expect(text).toContain("| B3 | desktop | 1200 | 1200 | 5000 | 10000 | ok |");
  });

  describe("exits with 2, never with 0, when it cannot judge", () => {
    it("has no result for a limit", () => {
      writeLimits(LIMITS);
      expect(gate().code).toBe(2);
    });

    it("finds a result that is not JSON", () => {
      writeLimits(LIMITS);
      writeResult("{ not json");
      expect(gate().code).toBe(2);
    });

    it("finds a result of another benchmark", () => {
      writeLimits(LIMITS);
      writeResult({ id: "B1", samplesMs: { desktop: [1] } });
      expect(gate().code).toBe(2);
    });

    it.each([
      ["no series", { id: "B3", samplesMs: {} }],
      ["an empty series", { id: "B3", samplesMs: { desktop: [] } }],
      ["a time that is not a number", { id: "B3", samplesMs: { desktop: ["fast"] } }],
      ["a negative time", { id: "B3", samplesMs: { desktop: [-1] } }],
      ["no times at all", { id: "B3" }],
    ])("finds %s in a result", (_what, content) => {
      writeLimits(LIMITS);
      writeResult(content);
      expect(gate().code).toBe(2);
    });

    it.each([
      ["no limit", {}],
      ["a warning limit above the failure limit", { B3: { warnMs: 9000, failMs: 1000 } }],
      ["a limit that is not a number", { B3: { warnMs: "5s", failMs: 10_000 } }],
    ])("finds %s in the limits", (_what, limits) => {
      writeLimits(limits);
      writeResult({ id: "B3", samplesMs: { desktop: [1] } });
      expect(gate().code).toBe(2);
    });

    it("finds no limits file", () => {
      writeResult({ id: "B3", samplesMs: { desktop: [1] } });
      expect(gate().code).toBe(2);
    });
  });
});
