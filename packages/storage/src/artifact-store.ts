import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  FlawDotError,
  parseOrThrow,
  projectIdSchema,
  runIdSchema,
  type ArtifactStore,
  type ProjectId,
} from "@flawdot/core-model";

type Kind = Parameters<ArtifactStore["pathFor"]>[1];

const EXTENSION: Readonly<Record<Exclude<Kind, "export">, string>> = {
  screenshot: ".png",
  marked: ".marked.png",
  annotated: ".annotated.png",
  tile: ".tile.png",
};

const NAME_MAX = 150;
// Letters, digits, "_", "-", "@" and dots in the middle: the names that capture makes ("a1b2c3d4e5f6__mobile@1.5x",
// "...__t3") and an export ("report.pdf"). No separator, no ":" (a stream on Windows), no space, no non-ASCII letter.
const SAFE_NAME = /^[A-Za-z0-9@_-][A-Za-z0-9._@-]*$/;
// A name that Windows reads as a device, with or without an extension ("nul", "CON.txt"): the CI runs on Windows.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const EXPORT_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
// The extension of a kind is added to the name, so a screenshot called "page.marked" would be the file of the marked
// screenshot of "page" ("page.marked.png"). A name that ends like the extension of another kind is refused.
const KIND_SUFFIX = /\.(marked|annotated|tile)$/i;

/** The message names the rule and never the name that was received. */
function checkName(kind: Kind, name: string): void {
  const allowed =
    name.length <= NAME_MAX &&
    SAFE_NAME.test(name) &&
    !name.includes("..") &&
    !name.endsWith(".") &&
    !WINDOWS_DEVICE.test(name) &&
    (kind === "export" ? EXPORT_EXTENSION.test(name) : !KIND_SUFFIX.test(name));
  if (!allowed) {
    throw new FlawDotError(
      "INVALID_INPUT",
      `A file name may have letters, digits, "_", "-", "@" and dots in the middle, up to ${String(NAME_MAX)} characters${kind === "export" ? ", and an export needs an extension" : ", and may not end with .marked, .annotated or .tile"}`,
    );
  }
}

/**
 * Hands out paths under `root`, on the disk: `<root>/runs/<runId>/<name><extension>` (an export goes to
 * `<root>/runs/<runId>/exports/<name>` and its name carries the extension, because only the exporter knows the
 * format) and `<root>/sessions/project-<projectId>/storage-state.json`. The folder of a path is made when the
 * path is handed out, so whoever writes the file does not have to. The ids and the name are checked, and a name
 * can hold nothing that moves a path out of the root.
 */
export function createDirectoryArtifactStore(root: string): ArtifactStore {
  const base = resolve(root);
  const sessionFolder = (projectId: ProjectId): string => {
    const id = parseOrThrow(projectIdSchema, projectId, { what: "project id" });
    // Windows drops a dot at the end of a folder name, so "example." and "example" would be one folder.
    if (id.endsWith(".")) {
      throw new FlawDotError("INVALID_INPUT", "A project id may not end with a dot");
    }
    // The prefix keeps a site such as "con", "nul" or "aux.com", which Windows reads as a device, from being one.
    return join(base, "sessions", `project-${id}`);
  };

  return {
    pathFor(runId, kind, name) {
      const run = parseOrThrow(runIdSchema, runId, { what: "run id" });
      checkName(kind, name);
      const folder = join(base, "runs", run, ...(kind === "export" ? ["exports"] : []));
      mkdirSync(folder, { recursive: true });
      return join(folder, kind === "export" ? name : `${name}${EXTENSION[kind]}`);
    },
    sessionPath(projectId) {
      const folder = sessionFolder(projectId);
      mkdirSync(folder, { recursive: true, mode: 0o700 }); // the session holds cookies: the owner only (POSIX)
      return join(folder, "storage-state.json");
    },
    clearSession: async (projectId) => {
      await rm(join(sessionFolder(projectId), "storage-state.json"), { force: true });
    },
  };
}
