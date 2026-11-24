import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FlawDotError, type ArtifactStore } from "@flawdot/core-model";
import { createSharpAnnotator } from "../src/annotator.js";
import { layoutMarks } from "../src/layout.js";
import { capture, finding, RUN_ID } from "./support/builders.js";
import { backdrop, folderStore, useTempFolder } from "./support/files.js";
import { differingShare, isColor, pixelAt, raw } from "./support/pixels.js";

const folder = useTempFolder();
let root = "";
let screenshot = "";
let store: ArtifactStore;

beforeAll(async () => {
  root = await folder.make();
  screenshot = join(root, RUN_ID, "page__desktop.png");
  store = folderStore(root);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, RUN_ID), { recursive: true });
  await writeFile(screenshot, await backdrop(800, 600));
});

const annotate = (findings: ReturnType<typeof finding>[], source = screenshot) =>
  createSharpAnnotator({ artifacts: store }).annotate(capture(source, 800, 600), findings);

describe("the annotator: the file it writes", () => {
  it("writes the annotated picture where the store says, next to the screenshot, and returns the path", async () => {
    const result = await annotate([finding(1, "critical", [300, 250, 100, 40])]);
    expect(result.path).toBe(
      store.pathFor(capture(screenshot, 800, 600).runId, "annotated", "page__desktop"),
    );
    const image = await raw(result.path);
    expect([image.width, image.height]).toEqual([800, 600]);
  });

  it("never changes the screenshot it draws on", async () => {
    const before = await readFile(screenshot);
    await annotate([finding(1, "critical", [300, 250, 100, 40])]);
    expect((await readFile(screenshot)).equals(before)).toBe(true);
  });

  it("makes the same file every time", async () => {
    const hash = async (): Promise<string> => {
      const { path } = await annotate([
        finding(1, "critical", [300, 250, 100, 40]),
        finding(2, "low", [40, 400, 100, 30]),
      ]);
      return createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    };
    expect(await hash()).toBe(await hash());
  });

  it("makes the folder when it is not there yet", async () => {
    const fresh = folderStore(join(root, "not-yet", "made"));
    const { path } = await createSharpAnnotator({ artifacts: fresh }).annotate(
      capture(screenshot, 800, 600),
      [finding(1, "low", [300, 250, 100, 40])],
    );
    expect((await raw(path)).width).toBe(800);
  });
});

describe("the annotator: what it draws", () => {
  it("draws the disc where the layout says, in the color of its severity, with a white ring", async () => {
    const findings = [finding(1, "critical", [300, 250, 100, 40])];
    const [mark] = layoutMarks(findings, { width: 800, height: 600, scale: 1 });
    const image = await raw((await annotate(findings)).path);
    const { center, radius } = mark!;
    expect(isColor(pixelAt(image, center.x + radius - 6, center.y + 4), "#c8331f")).toBe(true);
    expect(isColor(pixelAt(image, center.x - radius - 1, center.y), "#ffffff")).toBe(true);
    expect(isColor(pixelAt(image, 700, 100), "#f4f6f4")).toBe(true);
  });

  it("frames the element: the corner of the frame is dark where the box says", async () => {
    const image = await raw((await annotate([finding(1, "critical", [300, 250, 100, 40])])).path);
    const [red] = pixelAt(image, 294, 250);
    expect(red).toBeLessThan(120);
    expect(isColor(pixelAt(image, 350, 270), "#d8dedb")).toBe(true);
  });

  it("draws the legend of the three sizes in the bottom right corner", async () => {
    const plain = await raw(screenshot);
    const image = await raw((await annotate([finding(1, "critical", [300, 250, 100, 40])])).path);
    expect(isColor(pixelAt(image, 700, 580), "#f4f6f4", 0)).toBe(false);
    expect(isColor(pixelAt(plain, 700, 580), "#f4f6f4", 0)).toBe(true);
  });

  it("makes everything twice as big on a screenshot at a pixel ratio of 2", async () => {
    const big = join(root, RUN_ID, "page__desktop@2x.png");
    await writeFile(big, await backdrop(1600, 1200, 2));
    const findings = [finding(1, "critical", [300, 250, 100, 40])];
    const [mark] = layoutMarks(findings, { width: 1600, height: 1200, scale: 2 });
    const { path } = await createSharpAnnotator({ artifacts: store }).annotate(
      capture(big, 1600, 1200, 2),
      findings,
    );
    const image = await raw(path);
    const { center } = mark!;
    expect(mark?.radius).toBe(34);
    expect(isColor(pixelAt(image, center.x + 31, center.y), "#c8331f")).toBe(true);
    expect(isColor(pixelAt(image, center.x + 36, center.y), "#ffffff")).toBe(true);
  });

  it.each([
    ["no finding", () => []],
    ["a problem of the whole page", () => [finding(1, "low", [0, 0, 0, 0], { page: true })]],
    ["a problem with no number", () => [finding(1, "low", [300, 250, 100, 40], { number: null })]],
    [
      "a problem of another viewport",
      () => [finding(1, "low", [300, 250, 100, 40], { viewport: "mobile" })],
    ],
    [
      "a problem of another page",
      () => [finding(1, "low", [300, 250, 100, 40], { pageUrl: "https://example.com/other" })],
    ],
  ])("draws nothing for %s, and writes the picture as it was", async (_what, make) => {
    const { path } = await annotate(make());
    expect(differingShare(await raw(path), await raw(screenshot), 0)).toBe(0);
  });
});

describe("the annotator: when something is wrong", () => {
  it("refuses a screenshot whose size is not the size that the capture says", async () => {
    await expect(
      createSharpAnnotator({ artifacts: store }).annotate(capture(screenshot, 900, 600), []),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("says so, with a FlawDotError that does not give the whole path, when the screenshot cannot be read", async () => {
    const missing = join(root, RUN_ID, "gone.png");
    const failure = await annotate([], missing).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FlawDotError);
    expect((failure as FlawDotError).code).toBe("INTERNAL");
    expect((failure as FlawDotError).message).not.toContain(root);
  });

  it("refuses to write over the screenshot", async () => {
    const overwriting: ArtifactStore = { ...store, pathFor: () => screenshot };
    const before = await readFile(screenshot);
    await expect(
      createSharpAnnotator({ artifacts: overwriting }).annotate(capture(screenshot, 800, 600), []),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect((await readFile(screenshot)).equals(before)).toBe(true);
  });
});
