import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectIdSchema,
  runIdSchema,
  type ArtifactStore,
  type CaptureContext,
  type Clock,
  type PageTarget,
} from "@flawdot/core-model";

export const RUN_ID = runIdSchema.parse("01ARZ3NDEKTSV4RRFFQ69G5FAV");
export const PROJECT_ID = projectIdSchema.parse("localhost-3000");

export const FIXED_NOW = new Date("2026-11-17T12:00:00.000Z");
export const fixedClock: Clock = { now: () => FIXED_NOW };

/** An artifact store in a folder of its own, removed by `dispose`. The store adds the extension of the kind. */
export function tempArtifacts(): ArtifactStore & { root: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "flawdot-capture-"));
  const extension = {
    screenshot: "png",
    marked: "marked.png",
    annotated: "annotated.png",
    export: "bin",
  };
  return {
    root,
    pathFor: (runId, kind, name) => join(root, runId, `${name}.${extension[kind]}`),
    sessionPath: (projectId) => join(root, "sessions", `${projectId}.json`),
    clearSession: () => Promise.resolve(),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const context = (maxElements = 300): CaptureContext => ({
  runId: RUN_ID,
  projectId: PROJECT_ID,
  limits: { maxElements, maxHeight: 15_000 },
});

export const target = (url: string): PageTarget => ({ url, templateKey: "/", templateSize: 1 });

/** A signal that has not been aborted and does not abort. */
export const idleSignal = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** The error that a call throws. The test fails if the call throws nothing, so an assertion on it cannot pass by accident. */
export function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw, and it did not");
}

/** The error that a promise rejects with. The test fails if the promise resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject, and it resolved");
}
