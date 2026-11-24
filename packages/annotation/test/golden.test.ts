import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "@flawdot/core-model";
import { createSharpAnnotator } from "../src/annotator.js";
import { capture, finding, RUN_ID, type BoxTuple } from "./support/builders.js";
import { backdrop, folderStore, useTempFolder, type Block } from "./support/files.js";
import { MAX_DIFFERING_SHARE, compareGolden } from "./support/golden.js";

// G1: the annotated pictures are compared with reference pictures in test/golden/. The backdrop is made here, not taken
// from a browser, so that fonts and pages cannot move the result. To make the references again, run with
// UPDATE_GOLDEN=1 and look at every picture before keeping it.

const folder = useTempFolder();

interface Scene {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly blocks: readonly Block[];
  readonly findings: readonly Finding[];
}

const PAGE_BLOCKS: readonly Block[] = [
  [30, 20, 260, 50],
  [240, 160, 180, 70],
  [30, 300, 400, 60],
];

const pageFindings = (): Finding[] => [
  finding(1, "critical", [240, 160, 180, 70]),
  finding(2, "medium", [30, 20, 260, 50]),
  finding(3, "low", [30, 300, 400, 60]),
];

const links = (): { findings: Finding[]; blocks: Block[] } => {
  const severities = ["critical", "medium", "low"] as const;
  const boxes: BoxTuple[] = Array.from({ length: 10 }, (_, index) => [
    20 + index * 60,
    200,
    52,
    20,
  ]);
  return {
    blocks: boxes.map((box): Block => box),
    findings: [
      ...boxes.map((box, index) => finding(index + 1, severities[index % 3] ?? "low", box)),
      finding(11, "critical", boxes[3] ?? [0, 0, 0, 0]),
      finding(12, "medium", boxes[3] ?? [0, 0, 0, 0]),
    ],
  };
};

const edges: readonly BoxTuple[] = [
  [2, 2, 60, 24],
  [600, 6, 36, 20],
  [4, 370, 80, 24],
  [580, 372, 56, 20],
  [-20, 150, 50, 30],
  [300, 380, 60, 40],
];

const scenes = (): Scene[] => [
  {
    name: "basic-1x",
    width: 640,
    height: 400,
    scale: 1,
    blocks: PAGE_BLOCKS,
    findings: pageFindings(),
  },
  {
    name: "basic-2x",
    width: 1280,
    height: 800,
    scale: 2,
    blocks: PAGE_BLOCKS,
    findings: pageFindings(),
  },
  { name: "cluster", width: 640, height: 400, scale: 1, ...links() },
  {
    name: "edges",
    width: 640,
    height: 400,
    scale: 1,
    blocks: edges.map((box): Block => box),
    findings: edges.map((box, index) =>
      finding(index + 1, (["critical", "medium", "low"] as const)[index % 3] ?? "low", box),
    ),
  },
  {
    name: "two-digit",
    width: 640,
    height: 400,
    scale: 1,
    blocks: [
      [60, 100, 120, 40],
      [260, 100, 120, 40],
      [60, 240, 120, 40],
      [260, 240, 120, 40],
    ],
    findings: [
      finding(9, "critical", [60, 100, 120, 40]),
      finding(10, "medium", [260, 100, 120, 40]),
      finding(99, "low", [60, 240, 120, 40]),
      finding(100, "critical", [260, 240, 120, 40]),
    ],
  },
];

describe("the annotated pictures match their reference pictures (G1)", () => {
  it.each(scenes().map((scene) => [scene.name, scene] as const))("%s", async (_name, scene) => {
    const root = await folder.make();
    await mkdir(join(root, RUN_ID), { recursive: true });
    const source = join(root, RUN_ID, "scene.png");
    await writeFile(source, await backdrop(scene.width, scene.height, scene.scale, scene.blocks));
    const { path } = await createSharpAnnotator({ artifacts: folderStore(root) }).annotate(
      capture(source, scene.width, scene.height, scene.scale),
      scene.findings,
    );
    const result = await compareGolden(scene.name, await readFile(path));
    expect(
      result.share,
      `differs from test/golden/${scene.name}.png; see ${result.evidence ?? "-"}`,
    ).toBeLessThanOrEqual(MAX_DIFFERING_SHARE);
  });
});
