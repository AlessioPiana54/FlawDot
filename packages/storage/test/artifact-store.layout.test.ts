import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectId, runId } from "@flawdot/test-support";
import { createDirectoryArtifactStore } from "../src/index.js";

// What the contract leaves to each store: where exactly the files go. SQLite (Task 23) and the stores of Task 24
// keep this layout, so that the history of the app and the one of the MCP server are the same folder.
describe("directory artifact store layout", () => {
  let folder: string;
  let root: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "flawdot-layout-"));
    root = join(folder, "store");
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("puts the files of a run in runs/<runId>, and the exports in a folder of their own", () => {
    const store = createDirectoryArtifactStore(root);
    const run = runId(7);

    expect(store.pathFor(run, "screenshot", "home__desktop")).toBe(
      join(root, "runs", run, "home__desktop.png"),
    );
    expect(store.pathFor(run, "marked", "home__desktop")).toBe(
      join(root, "runs", run, "home__desktop.marked.png"),
    );
    expect(store.pathFor(run, "annotated", "home__desktop")).toBe(
      join(root, "runs", run, "home__desktop.annotated.png"),
    );
    expect(store.pathFor(run, "tile", "home__desktop__t3")).toBe(
      join(root, "runs", run, "home__desktop__t3.tile.png"),
    );
    expect(store.pathFor(run, "export", "report.pdf")).toBe(
      join(root, "runs", run, "exports", "report.pdf"),
    );
  });

  it("puts the session of a project in sessions/project-<id>, a name no Windows device can have", () => {
    const store = createDirectoryArtifactStore(root);

    expect(store.sessionPath(projectId("localhost-3000"))).toBe(
      join(root, "sessions", "project-localhost-3000", "storage-state.json"),
    );
  });
});
