import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { elementSchema, type Element } from "@flawdot/core-model";
import { shootMarked } from "../src/marked.js";
import { pngBytes, rejectionOf } from "./support/fakes.js";

interface Script {
  /** Marks still on the page after the removal. */
  leftover?: number;
  /** The 1-based number of the screenshot that fails. */
  failAt?: number;
}

// A page that only writes down what it is asked to do, so the order and the options can be checked without a browser.
function fakePage(script: Script = {}) {
  const calls: string[] = [];
  const shots: Record<string, unknown>[] = [];
  const evaluated: { name: string; argument: unknown }[] = [];
  const page = {
    evaluate: (work: (argument?: unknown) => unknown, argument?: unknown) => {
      calls.push(`eval:${work.name}`);
      evaluated.push({ name: work.name, argument });
      return Promise.resolve(
        work.name === "removeMarkOverlay" ? (script.leftover ?? 0) : undefined,
      );
    },
    screenshot: (options: Record<string, unknown>) => {
      shots.push(options);
      calls.push(`shot:${String(shots.length)}`);
      if (script.failAt === shots.length) return Promise.reject(new Error("Target closed"));
      const clip = options["clip"] as { width: number; height: number };
      return Promise.resolve(pngBytes(clip.width, clip.height));
    },
  };
  return { page: page as unknown as Page, calls, shots, evaluated };
}

const element = (mark: number, x: number, y: number): Element =>
  elementSchema.parse({
    mark,
    selector: `#e${String(mark)}`,
    box: { x, y, width: 50, height: 20 },
    tag: "button",
    role: "button",
    name: null,
  });

const input = (overrides: Record<string, unknown> = {}) => ({
  elements: [element(1, 10, 20), element(2, 300, 950)],
  width: 1440,
  keptHeight: 2400,
  screenHeight: 900,
  markedPath: "out/marked.png",
  tilePathFor: (index: number) => `out/tile-${String(index)}.png`,
  guard: <T>(work: Promise<T>): Promise<T> => work,
  ...overrides,
});

describe("shootMarked", () => {
  it("draws the numbers, photographs the whole page and then each tile, and takes the numbers off again", async () => {
    const { page, calls } = fakePage();
    await shootMarked(page, input());
    expect(calls).toEqual([
      "eval:addMarkOverlay",
      "shot:1", // the whole marked picture
      "shot:2", // tile 0
      "shot:3", // tile 1
      "shot:4", // tile 2
      "eval:removeMarkOverlay",
    ]);
  });

  it("gives the page the mark and the corner of each element, and the width of the page", async () => {
    const { page, evaluated } = fakePage();
    await shootMarked(page, input());
    expect(evaluated[0]?.argument).toEqual({
      marks: [
        { mark: 1, x: 10, y: 20 },
        { mark: 2, x: 300, y: 950 },
      ],
      pageWidth: 1440,
    });
  });

  it("photographs the marked picture and the tiles at CSS size, cut from the full page, in the files it was told", async () => {
    const { page, shots } = fakePage();
    await shootMarked(page, input());
    expect(shots[0]).toMatchObject({
      path: "out/marked.png",
      fullPage: true,
      clip: { x: 0, y: 0, width: 1440, height: 2400 },
      scale: "css",
      animations: "disabled",
    });
    expect(shots.slice(1).map((shot) => [shot["path"], shot["clip"]])).toEqual([
      ["out/tile-0.png", { x: 0, y: 0, width: 1440, height: 900 }],
      ["out/tile-1.png", { x: 0, y: 810, width: 1440, height: 900 }],
      ["out/tile-2.png", { x: 0, y: 1500, width: 1440, height: 900 }],
    ]);
    for (const shot of shots) expect(shot["scale"]).toBe("css");
  });

  it("gives back the marked picture and the tiles, each with the size that the file really has", async () => {
    const { page } = fakePage();
    const done = await shootMarked(page, input());
    expect(done.marked).toEqual({ path: "out/marked.png" });
    expect(done.tiles).toEqual([
      {
        index: 0,
        top: 0,
        height: 900,
        image: { path: "out/tile-0.png", width: 1440, height: 900 },
      },
      {
        index: 1,
        top: 810,
        height: 900,
        image: { path: "out/tile-1.png", width: 1440, height: 900 },
      },
      {
        index: 2,
        top: 1500,
        height: 900,
        image: { path: "out/tile-2.png", width: 1440, height: 900 },
      },
    ]);
  });

  it("makes one tile as tall as the page for a page that is not taller than the screen", async () => {
    const { page } = fakePage();
    const done = await shootMarked(page, input({ keptHeight: 500, elements: [] }));
    expect(done.tiles).toEqual([
      {
        index: 0,
        top: 0,
        height: 500,
        image: { path: "out/tile-0.png", width: 1440, height: 500 },
      },
    ]);
  });

  it("takes the numbers off the page even when a screenshot fails, and passes that error on", async () => {
    const { page, calls } = fakePage({ failAt: 2 });
    const error = await rejectionOf(shootMarked(page, input()));
    expect(error).toMatchObject({ message: "Target closed" });
    expect(calls.at(-1)).toBe("eval:removeMarkOverlay");
    expect(calls).not.toContain("shot:3");
  });

  it("refuses to go on when a number is left on the page: axe would find it and the boxes would change", async () => {
    const { page } = fakePage({ leftover: 1 });
    const error = await rejectionOf(shootMarked(page, input()));
    expect(error).toMatchObject({ code: "INTERNAL" });
  });

  it("puts every wait on the page under the guard", async () => {
    const { page } = fakePage();
    let guarded = 0;
    await shootMarked(
      page,
      input({
        guard: <T>(work: Promise<T>): Promise<T> => {
          guarded += 1;
          return work;
        },
      }),
    );
    expect(guarded).toBe(6); // add, whole picture, three tiles, remove
  });
});
