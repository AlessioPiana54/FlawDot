#!/usr/bin/env node
// diff-coverage.mjs: C3 of docs/CONSTRAINTS.md. At least 80% of the CHANGED, instrumented lines in
// packages other than kernel and core-model must be covered. Reads coverage/lcov.info (already
// produced by `vitest run --coverage`), so it does not rerun the tests.
// Usage: node scripts/diff-coverage.mjs [--base <ref>] [--lcov <file>] [--min <percent>]
// Exit codes: 0 ok, 1 below the threshold, 2 could not run (no merge base, missing lcov).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const MIN = Number(arg("--min", "80"));
const lcovPath = arg("--lcov", "coverage/lcov.info");
const bail = (msg) => {
  console.error("diff-coverage: " + msg);
  process.exit(2);
};
const git = (args, { diffExit = false } = {}) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return diffExit && e.status === 1 && typeof e.stdout === "string" ? e.stdout : null;
  }
};

const top = git(["rev-parse", "--show-toplevel"])?.trim();
if (!top) bail("not inside a git work tree");
process.chdir(top);

const baseArg = arg("--base");
const candidates = baseArg ? [baseArg] : ["origin/main", "main"];
let mergeBase = null;
for (const ref of candidates) {
  mergeBase = git(["merge-base", ref, "HEAD"])?.trim() ?? null;
  if (mergeBase) break;
}
if (!mergeBase) bail("no merge base against " + candidates.join(" or "));

// Files that C3 applies to: sources of the "other" packages (plugins, adapters, CLI, server, UI).
const EXCLUDED = /^packages\/(kernel|core-model)\//;
const applies = (f) =>
  /^(packages|apps)\/.+\/src\/.+\.(ts|tsx)$/.test(f) && !EXCLUDED.test(f) && !/\.d\.ts$/.test(f);

const changed = new Map(); // file -> Set(line numbers)
const addLine = (f, n) => {
  if (!changed.has(f)) changed.set(f, new Set());
  changed.get(f).add(n);
};

const tracked = git(["diff", "--unified=0", mergeBase, "--"]);
if (tracked === null) bail("could not diff against " + mergeBase);
let current = "";
for (const raw of tracked.split("\n")) {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("+++ ")) current = line.slice(4).replace(/^b\//, "");
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (m && applies(current)) {
    const start = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    for (let n = start; n < start + len; n++) addLine(current, n);
  }
}
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
if (untracked === null) bail("could not list untracked files");
for (const f of untracked
  .split("\n")
  .map((s) => s.trim())
  .filter(applies)) {
  const lines = readFileSync(f, "utf8").split("\n").length;
  for (let n = 1; n <= lines; n++) addLine(f, n);
}

if (changed.size === 0) {
  console.log("diff-coverage: no changed source lines in packages that C3 covers");
  process.exit(0);
}
if (!existsSync(lcovPath)) bail(`${lcovPath} not found: run "vitest run --coverage" first`);

const lcov = new Map(); // file -> Map(line -> hits)
let sf = null;
for (const raw of readFileSync(lcovPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (line.startsWith("SF:")) {
    sf = line.slice(3).replace(/\\/g, "/");
    sf = sf.startsWith(top.replace(/\\/g, "/") + "/") ? sf.slice(top.length + 1) : sf;
    lcov.set(sf, new Map());
  } else if (line.startsWith("DA:") && sf) {
    const [n, hits] = line.slice(3).split(",").map(Number);
    lcov.get(sf).set(n, hits);
  }
}

let total = 0;
let covered = 0;
const misses = [];
for (const [f, lines] of changed) {
  const da = lcov.get(f);
  if (!da) {
    // A changed source file with no coverage record at all: it was never loaded by a test.
    misses.push(`${f}: not loaded by any test`);
    total += lines.size;
    continue;
  }
  for (const n of lines) {
    if (!da.has(n)) continue; // not an executable line (comment, type, blank)
    total++;
    if (da.get(n) > 0) covered++;
    else misses.push(`${f}:${n}`);
  }
}

const pct = total === 0 ? 100 : (covered / total) * 100;
console.log(
  `diff-coverage: ${covered}/${total} changed lines covered (${pct.toFixed(1)}%, min ${MIN}%)`,
);
if (pct < MIN) {
  for (const m of misses.slice(0, 30)) console.error("  uncovered: " + m);
  process.exit(1);
}
