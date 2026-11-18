import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DEFAULT_VIEWPORTS } from "@flawdot/core-model";
import { useBrowserHarness } from "../test/support/harness.js";

// B3 of docs/CONSTRAINTS.md section 4: a capture of a fixture page takes less than 5 s per viewport. The pages are on
// this machine, so the time is the capture's own: Chromium, the measuring and the pictures, with no network.
//
// The times are written to bench-results/B3.json, and scripts/bench-gate.mjs compares them with the limits of
// scripts/bench-limits.json: a warning above the limit, a failure above twice the limit. This file only measures.
const RUNS_PER_VIEWPORT = 5;
const PAGE = "/landing.html";

const harness = useBrowserHarness();

test("B3: a capture of the fixture page, for each viewport", async () => {
  // The first capture of a browser pays for starting it. That is not what is measured.
  await harness.take(PAGE);

  const samplesMs: Record<string, number[]> = {};
  for (const viewport of Object.values(DEFAULT_VIEWPORTS)) {
    const times: number[] = [];
    for (let run = 0; run < RUNS_PER_VIEWPORT; run += 1) {
      const started = performance.now();
      await harness.take(PAGE, { viewport });
      times.push(Math.round(performance.now() - started));
    }
    samplesMs[viewport.name] = times;
  }

  const folder = fileURLToPath(new URL("../../../bench-results/", import.meta.url));
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}B3.json`, `${JSON.stringify({ id: "B3", samplesMs }, null, 2)}\n`);
  expect(Object.keys(samplesMs)).toEqual(["desktop", "tablet", "mobile"]);
}, 180_000);
