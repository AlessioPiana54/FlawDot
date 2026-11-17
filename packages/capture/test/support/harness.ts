import { afterAll, beforeAll, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  DEFAULT_VIEWPORTS,
  type Capture,
  type CaptureContext,
  type Viewport,
} from "@flawdot/core-model";
import {
  createChromiumProvider,
  createUrlCapture,
  type BrowserProvider,
  type UrlCaptureDeps,
} from "../../src/index.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { fixedClock, idleSignal, target, tempArtifacts, RUN_ID, PROJECT_ID } from "./fakes.js";

export interface TakeOptions {
  viewport?: Viewport;
  maxElements?: number;
  maxHeight?: number;
  deps?: Partial<UrlCaptureDeps>;
}

/**
 * A real Chromium, a server for the fixture pages and a store of files, started once for the tests of a file and
 * stopped when they end. Use it from the top of a `describe` or a test file.
 */
export function useBrowserHarness() {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
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

  const running = (): { server: FixtureServer; provider: BrowserProvider } => {
    if (server === undefined || provider === undefined)
      throw new Error("The harness is not started");
    return { server, provider };
  };

  const contextFor = (options: TakeOptions): CaptureContext => ({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    limits: { maxElements: options.maxElements ?? 300, maxHeight: options.maxHeight ?? 15_000 },
  });

  const urlCapture = (options: TakeOptions) =>
    createUrlCapture({
      browser: running().provider,
      artifacts,
      clock: fixedClock,
      ...options.deps,
    });

  return {
    artifacts,
    get server(): FixtureServer {
      return running().server;
    },
    get provider(): BrowserProvider {
      return running().provider;
    },
    take(path: string, options: TakeOptions = {}): Promise<Capture> {
      return urlCapture(options).capture(
        target(`${running().server.origin}${path}`),
        options.viewport ?? DEFAULT_VIEWPORTS.desktop,
        contextFor(options),
        idleSignal,
      );
    },
    /** Captures a page and, while its browser page is still open, runs `inspect` on it. */
    async inspect<T>(
      path: string,
      inspect: (page: Page, capture: Capture) => Promise<T>,
      options: TakeOptions = {},
    ): Promise<{ capture: Capture; result: T }> {
      let result: T | undefined;
      const capture = await urlCapture(options).capture(
        target(`${running().server.origin}${path}`),
        options.viewport ?? DEFAULT_VIEWPORTS.desktop,
        contextFor(options),
        idleSignal,
        async (live, finished) => {
          result = await inspect(live.page as Page, finished);
        },
      );
      return { capture, result: result as T };
    },
  };
}
