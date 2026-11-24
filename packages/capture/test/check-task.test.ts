import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The runner of `pnpm check:task` lives in scripts/, which is not a package; its tests live here, next to those of the
// benchmark gate. They give it phases of their own (a few lines of Node that sleep) and limits of fractions of a second.
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/check-task.mjs");

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "flawdot-check-task-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

// A command is a list of arguments, as the runner starts it with no shell.
const node = (script: string, ...args: string[]) => ["node", "-e", script, ...args];
const sleep = (name: string, ms: number) => ({
  name,
  command: node(`setTimeout(() => {}, ${String(ms)})`),
});
const quick = (name: string) => ({ name, command: node("") });

interface Options {
  phases: unknown;
  limits?: unknown;
  /** The text of a vitest JSON report, put where the runner looks for it. */
  timings?: unknown;
  env?: Record<string, string>;
}

function check({ phases, limits = { warnSeconds: 5, failSeconds: 10 }, timings, env }: Options) {
  const args = [SCRIPT];
  const write = (name: string, value: unknown): string => {
    const file = join(folder, name);
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  args.push("--phases", write("phases.json", phases), "--limits", write("limits.json", limits));
  if (timings !== undefined) args.push("--timings", write("timings.json", timings));
  const run = spawnSync(process.execPath, args, {
    encoding: "utf8",
    // The runner reads the environment to tell a CI run from a run on a machine: a test sets what it needs.
    env: { ...process.env, CI: "", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

const fileReport = (name: string, ms: number, startTime = 1_000_000) => ({
  name: `${process.cwd().replaceAll("\\", "/")}/packages/${name}`,
  startTime,
  endTime: startTime + ms,
});

describe("check-task: the time of the phases", () => {
  it("runs the phases in order and says how long each took and how long all took", () => {
    const result = check({ phases: [quick("static"), quick("guard"), quick("tests")] });

    expect(result.code).toBe(0);
    for (const name of ["static", "guard", "tests"]) expect(result.out).toContain(name);
    expect(result.out).toMatch(/total\s+\d+(\.\d+)? s/);
    expect(result.out).not.toContain("::warning::");
  });

  it("warns, and still passes, above the warning limit", () => {
    const result = check({
      phases: [sleep("one", 300), sleep("two", 300)],
      limits: { warnSeconds: 0.4, failSeconds: 30 },
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain("::warning::");
    expect(result.out).toContain("over 0.4 s");
  });

  it("fails above the failure limit, on a machine", () => {
    const result = check({
      phases: [sleep("one", 300), sleep("two", 300)],
      limits: { warnSeconds: 0.1, failSeconds: 0.3 },
    });

    expect(result.code).toBe(1);
    expect(result.out + result.err).toContain("::error::");
    expect(result.out + result.err).toContain("over 0.3 s");
  });

  it.each([["CI"], ["GITHUB_ACTIONS"]])(
    "only warns above the failure limit when %s is set: a slow runner is not a fault of the code",
    (variable) => {
      const result = check({
        phases: [sleep("one", 300), sleep("two", 300)],
        limits: { warnSeconds: 0.1, failSeconds: 0.3 },
        env: { [variable]: "true" },
      });

      expect(result.code).toBe(0);
      expect(result.out).toContain("::warning::");
      expect(result.out + result.err).not.toContain("::error::");
    },
  );

  it("does not warn when the time is within the limits", () => {
    const result = check({
      phases: [quick("only")],
      limits: { warnSeconds: 60, failSeconds: 60 },
    });

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("::warning::");
  });
});

describe("check-task: a phase that fails", () => {
  it("stops there, does not run the phases after it, and gives its exit code", () => {
    const marker = join(folder, "after.txt");
    const result = check({
      phases: [
        quick("static"),
        { name: "guard", command: node("process.exit(3)") },
        {
          name: "tests",
          command: node("require('fs').writeFileSync(process.argv[1], 'ran')", marker),
        },
      ],
    });

    expect(result.code).toBe(3);
    expect(existsSync(marker)).toBe(false);
    expect(result.out + result.err).toContain("guard");
  });

  it("fails the phase, and says why, when its program cannot be started", () => {
    const result = check({
      phases: [quick("static"), { name: "missing", command: ["flawdot-no-such-program"] }],
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain("missing could not be started");
  });

  it("still tells the time of the phases that ran, and which one failed", () => {
    const result = check({
      phases: [sleep("static", 100), { name: "guard", command: node("process.exit(1)") }],
    });

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/static\s+\d+(\.\d+)? s/);
    expect(result.out).toMatch(/guard\s+failed/);
  });
});

describe("check-task: the slowest test files", () => {
  const report = {
    testResults: [
      fileReport("a/test/a.test.ts", 100, 9_000_000), // it started late, so it ends last: only its duration is small
      fileReport("b/test/b.test.ts", 9000),
      fileReport("c/test/c.test.ts", 500),
      fileReport("d/test/d.test.ts", 7000),
      fileReport("e/test/e.test.ts", 300),
      fileReport("f/test/f.test.ts", 4000),
      fileReport("g/test/g.test.ts", 8000),
    ],
  };

  it("names the five slowest, slowest first, with their paths from the root of the repository", () => {
    const result = check({ phases: [quick("tests")], timings: report });

    const lines = result.out.split("\n").filter((line) => line.includes(".test.ts"));
    expect(lines.map((line) => /packages\/(\w)\//.exec(line)?.[1])).toEqual([
      "b",
      "g",
      "d",
      "f",
      "c",
    ]);
    expect(lines[0]).toContain("9.0 s");
    expect(result.out).not.toContain("a.test.ts");
  });

  it("names them in the message too when the time is over the limit", () => {
    const result = check({
      phases: [sleep("tests", 300)],
      limits: { warnSeconds: 0.1, failSeconds: 0.2 },
      timings: report,
    });

    expect(result.code).toBe(1);
    expect(result.out + result.err).toContain("b.test.ts");
  });

  it("shows no list, and does not fail, when there is no report: the phase that makes it did not run", () => {
    const result = check({ phases: [quick("static")] });

    expect(result.code).toBe(0);
    expect(result.out).not.toContain(".test.ts");
  });
});

describe("check-task: it must never read as a pass when it could not judge", () => {
  it.each([
    ["a limits file that is not JSON", { limits: "{ not json" }],
    ["a limit that is not a number", { limits: { warnSeconds: "70", failSeconds: 90 } }],
    ["a warning limit above the failure limit", { limits: { warnSeconds: 95, failSeconds: 90 } }],
    ["a limit that is missing", { limits: { warnSeconds: 70 } }],
    ["no phase", { phases: [] }],
    ["a phase with no command", { phases: [{ name: "x" }] }],
    ["a command that is a text and not a list", { phases: [{ name: "x", command: "node -e ''" }] }],
    ["a command with a part that is not a text", { phases: [{ name: "x", command: ["node", 1] }] }],
    ["a phases file that is not JSON", { phases: "[" }],
  ])("exits 2 for %s", (_label, override) => {
    const result = check({ phases: [quick("static")], ...override });

    expect(result.code).toBe(2);
    expect(result.err).toContain("check-task:");
  });

  it("exits 2 when the limits file is missing", () => {
    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--limits", join(folder, "nowhere.json"), "--phases", join(folder, "p.json")],
      { encoding: "utf8" },
    );

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("check-task:");
  });
});

describe("check-task: the summary of a CI run", () => {
  it("writes a table of the phases to the summary file that GitHub gives", () => {
    const summary = join(folder, "summary.md");

    const result = check({
      phases: [quick("static"), quick("tests")],
      timings: { testResults: [fileReport("x/test/x.test.ts", 1500)] },
      env: { GITHUB_STEP_SUMMARY: summary },
    });

    expect(result.code).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("check:task");
    expect(text).toContain("| static |");
    expect(text).toContain("| tests |");
    expect(text).toContain("x.test.ts");
  });
});
