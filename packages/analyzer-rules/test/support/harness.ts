/// <reference lib="dom" />

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  DEFAULT_VIEWPORTS,
  projectIdSchema,
  runIdSchema,
  type ArtifactStore,
  type Capture,
  type RuleAnalysis,
} from "@flawdot/core-model";
import { createChromiumProvider, createUrlCapture, type BrowserProvider } from "@flawdot/capture";
import { createAxeAnalyzer } from "../../src/analyzer.js";
import { defaultCatalog } from "../../src/default-catalog.js";
import { WCAG_CRITERIA } from "../../src/wcag-criteria.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";

const RUN_ID = runIdSchema.parse("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const PROJECT_ID = projectIdSchema.parse("localhost-3000");
const idleSignal = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** An artifact store in a folder of its own, for the screenshots that a capture writes. */
function tempArtifacts(): ArtifactStore & { dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "flawdot-analyzer-"));
  const extension = {
    screenshot: "png",
    marked: "marked.png",
    annotated: "annotated.png",
    export: "bin",
    tile: "tile.png",
  };
  return {
    pathFor: (runId, kind, name) => join(root, runId, `${name}.${extension[kind]}`),
    sessionPath: (projectId) => join(root, "sessions", `${projectId}.json`),
    clearSession: () => Promise.resolve(),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface Analyzed {
  capture: Capture;
  analysis: RuleAnalysis;
  /** The page as it was before axe ran and after the analysis ended: they must be the same. */
  htmlBefore: string;
  htmlAfter: string;
  /** What `inspect` returned, run on the live page after the analysis. */
  inspected: unknown;
}

/**
 * A real Chromium and a server for the fixture pages, started once for the tests of a file. A page is captured with
 * the real capture of FlawDot and analyzed while it is still open, exactly as the kernel will do it.
 */
export function useBrowserHarness() {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  let server: FixtureServer | undefined;
  let provider: BrowserProvider | undefined;
  const artifacts = tempArtifacts();

  beforeAll(async () => {
    server = await startFixtureServer();
    provider = createChromiumProvider();
  });

  afterAll(async () => {
    await provider?.close();
    await server?.close();
    artifacts.dispose();
  });

  return {
    async analyze(
      path: string,
      inspect: (page: Page) => Promise<unknown> = () => Promise.resolve(undefined),
    ): Promise<Analyzed> {
      if (server === undefined || provider === undefined)
        throw new Error("The harness is not started");
      const analyzer = createAxeAnalyzer({ catalog: defaultCatalog, wcag: WCAG_CRITERIA });
      const result: Partial<Analyzed> = {};
      const capture = await createUrlCapture({
        browser: provider,
        artifacts,
        clock: { now: () => new Date("2026-11-18T12:00:00.000Z") },
      }).capture(
        { url: `${server.origin}${path}`, templateKey: "/", templateSize: 1 },
        DEFAULT_VIEWPORTS.desktop,
        { runId: RUN_ID, projectId: PROJECT_ID, limits: { maxElements: 300, maxHeight: 15_000 } },
        idleSignal,
        async (live, finished) => {
          const page = live.page as Page;
          result.htmlBefore = await page.evaluate(() => document.documentElement.outerHTML);
          result.analysis = await analyzer.analyze(
            finished,
            { language: "en", livePage: live },
            idleSignal,
          );
          result.htmlAfter = await page.evaluate(() => document.documentElement.outerHTML);
          result.inspected = await inspect(page);
        },
      );
      return { capture, inspected: undefined, ...result } as Analyzed;
    },
  };
}
