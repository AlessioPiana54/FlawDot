import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArtifactStoreContract } from "@flawdot/test-support";
import { createDirectoryArtifactStore } from "../src/index.js";

// The root is a folder inside a folder that belongs to the test, so that a file outside the root would show.
runArtifactStoreContract(() => {
  const folder = mkdtempSync(join(tmpdir(), "flawdot-artifacts-"));
  const root = join(folder, "store");
  return {
    subject: createDirectoryArtifactStore(root),
    root,
    dispose: () => {
      rmSync(folder, { recursive: true, force: true });
    },
  };
});
