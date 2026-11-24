import { join } from "node:path";
import { createAxeAnalyzer, defaultCatalog, WCAG_CRITERIA } from "@flawdot/analyzer-rules";
import { createSharpAnnotator } from "@flawdot/annotation";
import { createChromiumProvider, createUrlCapture, type BrowserProvider } from "@flawdot/capture";
import type { Clock, SettingsRepository } from "@flawdot/core-model";
import { createFlawDot, type FlawDot } from "@flawdot/kernel";
import { createDirectoryArtifactStore, createInMemoryStorage } from "@flawdot/storage";
import { createIdGenerator, systemClock } from "./system.js";

export interface CoreOptions {
  /** Where the screenshots are written, under `artifacts/`. */
  readonly home: string;
  /** For a test: the browser to use instead of Chromium. Whoever gives it still gets it closed by `close()`. */
  readonly browser?: BrowserProvider;
  readonly clock?: Clock;
}

/**
 * What both ways of starting FlawDot share: the adapters, built once. `createKernel` puts them together for the way it
 * is started (the web app at Task 38 asks for "web"). Only the root of composition knows the adapters by name.
 */
export interface CoreGraph {
  readonly settings: Pick<SettingsRepository, "get">;
  createKernel(entry: "web" | "mcp"): FlawDot;
  /** Closes the browser. What was captured stays on disk. */
  close(): Promise<void>;
}

export function composeCore(options: CoreOptions): CoreGraph {
  const clock = options.clock ?? systemClock;
  const ids = createIdGenerator(clock);
  // The runs live in memory until the database comes (Task 23): the pictures stay on disk, the numbers are lost at exit.
  const storage = createInMemoryStorage({ clock });
  const artifacts = createDirectoryArtifactStore(join(options.home, "artifacts"));
  const browser = options.browser ?? createChromiumProvider();
  const input = { id: "url" as const, ...createUrlCapture({ browser, artifacts, clock }) };
  const analyzer = createAxeAnalyzer({ catalog: defaultCatalog, wcag: WCAG_CRITERIA });
  const annotator = createSharpAnnotator({ artifacts });

  return {
    settings: storage.settings,
    createKernel: (entry) =>
      createFlawDot({
        entry,
        inputs: [input],
        analyzers: [analyzer],
        repos: storage,
        annotator,
        clock,
        ids,
      }),
    close: () => browser.close(),
  };
}
