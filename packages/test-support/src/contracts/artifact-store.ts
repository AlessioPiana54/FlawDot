import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative } from "node:path";
import type { RunId } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { throwOf } from "../errors.js";
import { projectId, runId } from "../fixtures.js";
import { useFixture, withSecondInstance, type ArtifactStoreFactory } from "../harness.js";

const KINDS = ["screenshot", "marked", "annotated", "tile"] as const;
const ALL_KINDS = [...KINDS, "export"] as const;
// Written here and in the store on purpose: the suite is the oracle, and a store that drifts fails it.
const EXTENSIONS = {
  screenshot: ".png",
  marked: ".marked.png",
  annotated: ".annotated.png",
  tile: ".tile.png",
} as const;

/**
 * What every `ArtifactStore` must do. It hands out paths, and a path is built from a name that the capture code
 * and the exporters choose, so the name is checked: nothing may ever land outside the root of the store, and
 * the names that Windows reads in a special way (a device such as `NUL`, a stream such as `name:x`) are out too.
 * The root is inside a folder of its own, so that a file that landed beside it would show.
 */
export function runArtifactStoreContract(factory: ArtifactStoreFactory): void {
  describe("ArtifactStore contract", () => {
    const current = useFixture(factory);
    const store = () => current().fixture.subject;
    const root = () => current().fixture.root;
    const insideRoot = (path: string): boolean => {
      const inside = relative(root(), path);
      return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
    };
    const run = runId(1);

    it.each(KINDS)("ends the path of a %s with the extension of its kind", (kind) => {
      const path = store().pathFor(run, kind, "page__desktop");

      expect(path.endsWith(`page__desktop${EXTENSIONS[kind]}`)).toBe(true);
    });

    it("gives a different path to each kind of the same page, and one folder to all of them", () => {
      const paths = ALL_KINDS.map((kind) =>
        store().pathFor(run, kind, kind === "export" ? "page.pdf" : "page"),
      );

      expect(new Set(paths).size).toBe(paths.length);
      expect(new Set(paths.slice(0, 4).map((path) => dirname(path))).size).toBe(1);
    });

    it("gives an absolute path inside the root, the same one every time", () => {
      const first = store().pathFor(run, "screenshot", "page");

      expect(isAbsolute(first)).toBe(true);
      expect(insideRoot(first)).toBe(true);
      expect(store().pathFor(run, "screenshot", "page")).toBe(first);
    });

    it("gives different paths for different runs and different names", () => {
      const base = store().pathFor(run, "screenshot", "page");

      expect(store().pathFor(runId(2), "screenshot", "page")).not.toBe(base);
      expect(store().pathFor(run, "screenshot", "other")).not.toBe(base);
    });

    it.each([
      ["a screenshot of a viewport", "a1b2c3d4e5f6__desktop"],
      ["a screenshot at a pixel ratio", "a1b2c3d4e5f6__mobile@1.5x"],
      ["a tile of a long page", "a1b2c3d4e5f6__desktop__t3"],
    ])("accepts the name of %s", (_label, name) => {
      expect(insideRoot(store().pathFor(run, "tile", name))).toBe(true);
    });

    it("makes the folder of the file, so that whoever writes the file does not have to", () => {
      const path = store().pathFor(run, "annotated", "page");

      writeFileSync(path, "x");

      expect(existsSync(path)).toBe(true);
    });

    it("keeps the name of an export with its own extension, in a folder for exports", () => {
      const path = store().pathFor(run, "export", "report.pdf");

      expect(basename(path)).toBe("report.pdf");
      expect(insideRoot(path)).toBe(true);
      expect(basename(dirname(path))).toBe("exports");
    });

    it("rejects the name of an export that has no extension", () => {
      expect(throwOf(() => store().pathFor(run, "export", "report")).code).toBe("INVALID_INPUT");
    });

    it.each([
      ["nothing", ""],
      ["a dot", "."],
      ["two dots", ".."],
      ["a way up the folders", "../outside"],
      ["a way up in the middle", "page/../../outside"],
      ["a way up with backslashes", "..\\outside"],
      ["a slash", "folder/page"],
      ["a backslash", "folder\\page"],
      ["a drive letter", "C:page"],
      ["a Windows stream", "page:stream"],
      ["a null byte", "page\0.png"],
      ["a space", "my page"],
      ["a letter that is not ASCII", "pagé"],
      ["a dot at the start", ".hidden"],
      ["a dot at the end", "page."],
      ["two dots in a row", "page..png"],
      ["a Windows device", "NUL"],
      ["a Windows device with an extension", "con.txt"],
      ["a Windows device with a number", "lpt9"],
      ["a name that is too long", "p".repeat(151)],
    ])("rejects a name made of %s, and writes nothing", (_label, name) => {
      const beside = readdirSync(dirname(root()));

      for (const kind of ALL_KINDS) {
        const error = throwOf(() => store().pathFor(run, kind, name));
        expect(error.code).toBe("INVALID_INPUT");
      }

      expect(readdirSync(dirname(root()))).toEqual(beside);
    });

    it.each([".marked", ".annotated", ".tile", ".MARKED"])(
      "rejects a name that ends with %s, which would give two kinds the same file",
      (ending) => {
        for (const kind of KINDS) {
          expect(throwOf(() => store().pathFor(run, kind, `page${ending}`)).code).toBe(
            "INVALID_INPUT",
          );
        }
      },
    );

    it("keeps every kind of every name apart, even when a name looks like the end of another", () => {
      const paths = [
        store().pathFor(run, "marked", "page"),
        store().pathFor(run, "screenshot", "page"),
        store().pathFor(run, "screenshot", "page-marked"),
      ];

      expect(new Set(paths).size).toBe(paths.length);
    });

    it("does not repeat in the error the name that was rejected", () => {
      const error = throwOf(() => store().pathFor(run, "screenshot", "CANARY/../name"));

      expect(error.message).not.toContain("CANARY");
    });

    it("rejects a run id and a project id that are not what they say, even if the compiler was told otherwise", () => {
      expect(throwOf(() => store().pathFor("../outside" as RunId, "screenshot", "page")).code).toBe(
        "INVALID_INPUT",
      );
      expect(
        throwOf(() => store().sessionPath("../outside" as ReturnType<typeof projectId>)).code,
      ).toBe("INVALID_INPUT");
    });

    it("keeps the login session of a project in a file of its own", () => {
      const path = store().sessionPath(projectId("example.com"));

      expect(insideRoot(path)).toBe(true);
      expect(basename(path)).toBe("storage-state.json");
      expect(store().sessionPath(projectId("example.com"))).toBe(path);
      expect(store().sessionPath(projectId("other.example"))).not.toBe(path);
      expect(existsSync(dirname(path))).toBe(true);
    });

    it.each(["con", "nul", "aux.com", "com1.local", "lpt9", "xn--bcher-kva.example"])(
      "keeps the session of the site %s, even if Windows reads its name as a device",
      (site) => {
        const path = store().sessionPath(projectId(site));

        writeFileSync(path, "{}");

        expect(insideRoot(path)).toBe(true);
        expect(existsSync(path)).toBe(true);
      },
    );

    it("rejects a project id that ends with a dot, which Windows would cut", () => {
      expect(throwOf(() => store().sessionPath(projectId("example."))).code).toBe("INVALID_INPUT");
    });

    it("deletes the session of a project, and only that one", async () => {
      const mine = store().sessionPath(projectId("example.com"));
      const theirs = store().sessionPath(projectId("other.example"));
      writeFileSync(mine, "{}");
      writeFileSync(theirs, "{}");

      await store().clearSession(projectId("example.com"));

      expect(existsSync(mine)).toBe(false);
      expect(existsSync(theirs)).toBe(true);
    });

    it("clears a session that does not exist without an error", async () => {
      await store().clearSession(projectId("example.com"));
      await store().clearSession(projectId("example.com"));

      expect(existsSync(store().sessionPath(projectId("example.com")))).toBe(false);
    });

    it("does not share a root between two instances", async () => {
      await withSecondInstance(factory, current().clock, async (second) => {
        expect(second.root).not.toBe(root());
      });
    });
  });
}
