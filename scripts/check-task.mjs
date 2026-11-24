#!/usr/bin/env node
// check-task.mjs: the check at the end of a task (`pnpm check:task`), with the time of each phase measured.
// docs/CONSTRAINTS.md section 5 says it must take 90 seconds at most, and nothing else told anybody when it got near.
// Usage: pnpm check:task   (or node scripts/check-task.mjs [--phases <file>] [--limits <file>] [--timings <file>])
//   defaults: the four phases below, scripts/check-time-limits.json, a report of the test files in a temporary folder.
// It runs the phases one after the other and stops at the first that fails, with the exit code of that phase (as `&&`
// did). At the end it prints the time of each phase and of all, and the five test files that took longest. Above
// `warnSeconds` there is a warning; above `failSeconds` it fails, with those five files in the message, EXCEPT on CI
// (the variable CI or GITHUB_ACTIONS is set): a runner of Windows or macOS is slower than a machine and the code is not
// at fault, so there it is only a warning (section 5: on CI the time has no limit).
// Exit codes: 0 within the limits or only warnings, 1 a phase failed or the time is over `failSeconds`, 2 the check
// could not run (a missing or broken file). A 2 never reads as a 0.
// A command is a list of arguments, started with no shell: there is nothing to quote, and no text that could be taken
// for another command.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};
const phasesFile = option("--phases", undefined);
const limitsFile = resolve(option("--limits", "scripts/check-time-limits.json"));
// A report that a run makes itself goes in a folder of its own, taken away when the check ends: nothing is left in the
// temporary folder, and a report of an earlier run can never be read by mistake.
const ownFolder =
  option("--timings", undefined) === undefined
    ? mkdtempSync(join(tmpdir(), "flawdot-check-task-"))
    : undefined;
if (ownFolder !== undefined) {
  process.on("exit", () => rmSync(ownFolder, { recursive: true, force: true }));
}
const timingsFile = resolve(option("--timings", join(ownFolder ?? "", "vitest.json")));

// pnpm is started the way pnpm started this script: its own path is in `npm_execpath`, an executable or a script of Node.
function pnpm(...args) {
  const path = process.env.npm_execpath;
  if (!path) bail("run it with `pnpm check:task`: it needs to know where pnpm is");
  return /\.[cm]?js$/.test(path) ? [process.execPath, path, ...args] : [path, ...args];
}

// The check, in order. `{timingsFile}` is where vitest writes the time of each test file.
const defaultPhases = () => [
  { name: "static", command: pnpm("check:fast") },
  { name: "guard", command: [process.execPath, "scripts/floor-guard.mjs"] },
  {
    name: "tests",
    command: pnpm(
      "exec",
      "vitest",
      "run",
      "--coverage",
      "--reporter=default",
      "--reporter=json",
      "--outputFile.json={timingsFile}",
    ),
  },
  { name: "diff-coverage", command: [process.execPath, "scripts/diff-coverage.mjs"] },
];

const bail = (message) => {
  console.error(`check-task: ${message}`);
  process.exit(2);
};
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return bail(`${file} is missing or is not valid JSON`);
  }
};
const isSeconds = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

const limits = readJson(limitsFile);
if (
  !isSeconds(limits?.warnSeconds) ||
  !isSeconds(limits?.failSeconds) ||
  limits.warnSeconds > limits.failSeconds
) {
  bail(`${limitsFile} needs numbers warnSeconds <= failSeconds, both above 0`);
}
const phases = phasesFile === undefined ? defaultPhases() : readJson(resolve(phasesFile));
const phaseIsValid = (p) =>
  typeof p?.name === "string" &&
  p.name !== "" &&
  Array.isArray(p?.command) &&
  p.command.length > 0 &&
  p.command.every((part) => typeof part === "string");
if (!Array.isArray(phases) || phases.length === 0 || !phases.every(phaseIsValid)) {
  bail(
    "the phases need a name and a command (a list of arguments) each, and there must be at least one",
  );
}

const onCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const pad = (text, width) => text.padEnd(width);

const timings = [];
let failure;
for (const phase of phases) {
  const started = performance.now();
  const [program, ...args] = phase.command.map((part) =>
    part.replaceAll("{timingsFile}", () => timingsFile),
  );
  const run = spawnSync(program, args, { stdio: "inherit" });
  if (run.error)
    console.error(`check-task: ${phase.name} could not be started: ${run.error.message}`);
  const ms = performance.now() - started;
  const code = run.status ?? 1;
  timings.push({ name: phase.name, ms, failed: code !== 0 });
  if (code !== 0) {
    failure = code;
    break;
  }
}

// The five test files that took longest, from the report of vitest. Without a report (the phase did not run, or it
// failed before writing it) there is no list: a missing list never fails the check.
function slowestFiles() {
  if (!existsSync(timingsFile)) return [];
  try {
    const here = `${process.cwd().replaceAll("\\", "/")}/`;
    return JSON.parse(readFileSync(timingsFile, "utf8"))
      .testResults.map((file) => ({
        name: String(file.name).replaceAll("\\", "/").replace(here, ""),
        ms: file.endTime - file.startTime,
      }))
      .filter((file) => Number.isFinite(file.ms))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);
  } catch {
    return [];
  }
}

const total = timings.reduce((sum, t) => sum + t.ms, 0);
const slowest = slowestFiles();
const width = Math.max(5, ...timings.map((t) => t.name.length)) + 2;

console.log("\ncheck:task");
for (const t of timings) {
  console.log(
    `  ${pad(t.name, width)}${t.failed ? `failed after ${seconds(t.ms)}` : seconds(t.ms)}`,
  );
}
console.log(
  `  ${pad("total", width)}${seconds(total)}  (warning over ${limits.warnSeconds} s, failure over ${limits.failSeconds} s)`,
);
if (slowest.length > 0) {
  console.log("\nSlowest test files:");
  for (const file of slowest) console.log(`  ${pad(seconds(file.ms), 8)}${file.name}`);
}

// The summary of a CI run is a Markdown file that GitHub gives us a path to. Elsewhere there is none.
if (process.env.GITHUB_STEP_SUMMARY) {
  const text = [
    "### check:task",
    "",
    "| Phase | Time |",
    "|---|---:|",
    ...timings.map((t) => `| ${t.name} | ${t.failed ? "failed after " : ""}${seconds(t.ms)} |`),
    `| **total** | **${seconds(total)}** |`,
    "",
    ...(slowest.length > 0
      ? ["Slowest test files:", "", ...slowest.map((f) => `- ${seconds(f.ms)} \`${f.name}\``), ""]
      : []),
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

if (failure !== undefined) process.exit(failure);

const where =
  slowest.length > 0
    ? ` Slowest test files: ${slowest.map((f) => `${f.name} (${seconds(f.ms)})`).join(", ")}.`
    : "";
const took = `check:task took ${seconds(total)}`;
const over = (limit) => `${took}, over ${limit} s.${where}`;
if (total / 1000 > limits.failSeconds) {
  if (onCi) {
    console.log(
      `::warning::${over(limits.failSeconds)} On CI this is only a warning: the runner may be slow.`,
    );
  } else {
    console.error(`::error::${over(limits.failSeconds)}`);
    process.exit(1);
  }
} else if (total / 1000 > limits.warnSeconds) {
  console.log(`::warning::${over(limits.warnSeconds)}`);
}
