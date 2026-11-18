#!/usr/bin/env node
// bench-gate.mjs: compares the benchmark times with their limits (docs/CONSTRAINTS.md section 4).
// Usage: node scripts/bench-gate.mjs [--results <folder>] [--limits <file>]
//   defaults: bench-results, scripts/bench-limits.json
// A benchmark writes <results>/<id>.json as { "id": "B3", "samplesMs": { "<series>": [ms, ms, ...] } }.
// The limits file says { "<id>": { "warnMs": n, "failMs": n } }. For each series the MEAN of its samples is compared:
// above warnMs is a warning (shown in the summary of the CI run), above failMs is a failure.
// Exit codes: 0 within the limits or only warnings, 1 over a failMs, 2 the gate could not run (a missing or broken
// file, a limit with no result). A 2 never reads as a 0.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > -1 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};
const resultsFolder = resolve(option("--results", "bench-results"));
const limitsFile = resolve(option("--limits", "scripts/bench-limits.json"));

const bail = (message) => {
  console.error(`bench-gate: ${message}`);
  process.exit(2);
};
const readJson = (file) => {
  if (!existsSync(file)) bail(`${file} does not exist`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return bail(`${file} is not valid JSON`);
  }
};
const isNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

const limits = readJson(limitsFile);
const ids = Object.keys(limits);
if (ids.length === 0) bail(`${limitsFile} has no limit`);

const rows = [];
let failed = false;
for (const id of ids) {
  const { warnMs, failMs } = limits[id] ?? {};
  if (!isNumber(warnMs) || !isNumber(failMs) || warnMs > failMs) {
    bail(`${id} needs numbers warnMs <= failMs in ${limitsFile}`);
  }
  const result = readJson(join(resultsFolder, `${id}.json`));
  const series = result?.samplesMs;
  if (result?.id !== id || typeof series !== "object" || series === null) {
    bail(`${id}.json is not a result of ${id}`);
  }
  const names = Object.keys(series);
  if (names.length === 0) bail(`${id}.json has no series`);
  for (const name of names) {
    const samples = series[name];
    if (!Array.isArray(samples) || samples.length === 0 || !samples.every(isNumber)) {
      bail(`${id}.json: the series "${name}" has no usable times`);
    }
    const mean = Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length);
    const max = Math.max(...samples);
    const status = mean > failMs ? "FAIL" : mean > warnMs ? "warning" : "ok";
    if (status === "FAIL") failed = true;
    rows.push({ id, name, mean, max, warnMs, failMs, status });
  }
}

for (const row of rows) {
  const line = `${row.id} ${row.name}: mean ${row.mean} ms, max ${row.max} ms (warn above ${row.warnMs}, fail above ${row.failMs})`;
  if (row.status === "FAIL") console.error(`::error::${line}`);
  else if (row.status === "warning") console.log(`::warning::${line}`);
  else console.log(line);
}

// The summary of a CI run is a Markdown file that GitHub gives us a path to. Elsewhere there is none.
if (process.env.GITHUB_STEP_SUMMARY) {
  const table = [
    "### Benchmarks",
    "",
    "| Benchmark | Series | Mean (ms) | Max (ms) | Warn above | Fail above | |",
    "|---|---|---:|---:|---:|---:|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.name} | ${r.mean} | ${r.max} | ${r.warnMs} | ${r.failMs} | ${r.status} |`,
    ),
    "",
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}

process.exit(failed ? 1 : 0);
