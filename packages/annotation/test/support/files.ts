import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll } from "vitest";
import type { ArtifactStore, ProjectId, RunId } from "@flawdot/core-model";

const EXTENSIONS = {
  screenshot: "png",
  marked: "marked.png",
  annotated: "annotated.png",
  export: "bin",
  tile: "tile.png",
} as const;

/** A store of files in a folder: `<root>/<runId>/<name>.<extension>`, like the real one will be. */
export function folderStore(root: string): ArtifactStore {
  return {
    pathFor: (runId: RunId, kind, name) => join(root, runId, `${name}.${EXTENSIONS[kind]}`),
    sessionPath: (projectId: ProjectId) => join(root, "session", `${projectId}.json`),
    clearSession: () => Promise.resolve(),
  };
}

/** A temporary folder that is removed when the tests of the file end. */
export function useTempFolder(): { path: () => string; make: () => Promise<string> } {
  const made: string[] = [];
  afterAll(async () => {
    await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
  });
  return {
    path: () => {
      const last = made[made.length - 1];
      if (last === undefined) throw new Error("no temporary folder yet");
      return last;
    },
    make: async () => {
      const folder = await mkdtemp(join(tmpdir(), "flawdot-annotation-"));
      made.push(folder);
      return folder;
    },
  };
}

export type Block = readonly [x: number, y: number, width: number, height: number];

const DEFAULT_BLOCKS: readonly Block[] = [
  [40, 40, 300, 60],
  [300, 250, 100, 40],
  [40, 400, 500, 120],
];

/** A flat page with a few grey blocks (CSS pixels), as a PNG: a screenshot that does not need a browser. */
export async function backdrop(
  width: number,
  height: number,
  scale = 1,
  blocks: readonly Block[] = DEFAULT_BLOCKS,
): Promise<Buffer> {
  const rects = blocks
    .map(
      ([x, y, w, h]) =>
        `<rect x="${String(x * scale)}" y="${String(y * scale)}" width="${String(w * scale)}" height="${String(h * scale)}" fill="#d8dedb"/>`,
    )
    .join("");
  return sharp({ create: { width, height, channels: 3, background: "#f4f6f4" } })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">${rects}</svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}
