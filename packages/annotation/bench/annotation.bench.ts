import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { expect, test } from "vitest";
import { createSharpAnnotator } from "../src/annotator.js";
import { capture, finding, RUN_ID, seeded } from "../test/support/builders.js";
import { folderStore } from "../test/support/files.js";

// B4 of docs/CONSTRAINTS.md section 4: annotating a page of 1440 x 6000 pixels takes less than 1 s. The page is a flat
// picture and 60 findings are spread over it, about one for each 100 pixels of height.
//
// The times are written to bench-results/B4.json, and scripts/bench-gate.mjs compares them with the limits of
// scripts/bench-limits.json. This file only measures.
const WIDTH = 1440;
const HEIGHT = 6000;
const FINDINGS = 60;
const RUNS = 5;

test("B4: a page of 1440 x 6000 pixels with 60 findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "flawdot-bench-"));
  try {
    await mkdir(join(root, RUN_ID), { recursive: true });
    const source = join(root, RUN_ID, "tall__desktop.png");
    await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#f4f6f4" } })
      .png()
      .toFile(source);

    const random = seeded(4);
    const severities = ["critical", "medium", "low"] as const;
    const findings = Array.from({ length: FINDINGS }, (_, index) =>
      finding(index + 1, severities[index % 3] ?? "low", [
        60 + random() * (WIDTH - 360),
        40 + index * (HEIGHT / FINDINGS),
        80 + random() * 200,
        20 + random() * 40,
      ]),
    );
    const annotator = createSharpAnnotator({ artifacts: folderStore(root) });
    const page = capture(source, WIDTH, HEIGHT);

    // The first run pays for loading the library. That is not what is measured.
    await annotator.annotate(page, findings);

    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      await annotator.annotate(page, findings);
      times.push(Math.round(performance.now() - started));
    }

    const folder = fileURLToPath(new URL("../../../bench-results/", import.meta.url));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      `${folder}B4.json`,
      `${JSON.stringify({ id: "B4", samplesMs: { "1440x6000": times } }, null, 2)}\n`,
    );
    expect(times).toHaveLength(RUNS);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
