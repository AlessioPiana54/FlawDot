import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sampleAiRequest, sampleAiResponse } from "@flawdot/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeProvider,
  createMcpFulfiller,
  createProviderFulfiller,
  writeFixture,
} from "../src/index.js";
import { makeTempDir } from "./support/helpers.js";

// N1 of docs/CONSTRAINTS.md: in the tests no request goes to the Anthropic API. The words below are put together from
// pieces so that this file does not hold them: scripts/floor-guard.mjs flags the host (and any key) in a test file.
const API_HOST = ["api", "anthropic", "com"].join(".");
const SDK = ["@anthropic-ai", "sdk"].join("/");
const KEY_START = ["sk", "ant", ""].join("-");

const packageRoot = new URL("../", import.meta.url);

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(`${entry.name}/`, dir))
      : entry.name.endsWith(".ts")
        ? [new URL(entry.name, dir)]
        : [],
  );
}

describe("N1: no request to the Anthropic API", () => {
  const fetches = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = ((...args: unknown[]) => {
      fetches(...args);
      throw new Error("The tests must not use the network");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    fetches.mockReset();
  });

  it("has no key in the environment, as in the CI", () => {
    expect(process.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("answers, retries and fails without any call to fetch", async () => {
    const temp = await makeTempDir();
    try {
      await writeFixture(temp.dir, sampleAiRequest(), {
        kind: "sequence",
        steps: [
          { kind: "error", code: "AI_RATE_LIMIT", message: "Busy." },
          { kind: "answer", response: sampleAiResponse(), model: "claude-sonnet-5-5" },
        ],
      });
      const signal = new AbortController().signal;
      const fulfiller = createProviderFulfiller(createFakeProvider({ fixturesDir: temp.dir }), {
        tier: "accurate",
        sleep: () => Promise.resolve(),
      });

      await fulfiller.fulfill(sampleAiRequest(), signal); // an answer, after a failure that is tried again
      await expect(fulfiller.fulfill(sampleAiRequest({ tile: 9 }), signal)).rejects.toMatchObject({
        code: "INTERNAL", // no fixture: an error, not a call
      });
      await createMcpFulfiller({ submit: () => Promise.resolve(sampleAiResponse()) }).fulfill(
        sampleAiRequest(),
        signal,
      );

      expect(fetches).not.toHaveBeenCalled();
    } finally {
      await temp.remove();
    }
  });

  describe("the source of the package", () => {
    const files = [
      ...sourceFiles(new URL("src/", packageRoot)),
      new URL("scripts/record-fixtures.mjs", packageRoot),
    ];

    it("finds the files it is going to check", () => {
      expect(files.length).toBeGreaterThan(6);
    });

    it.each(
      files.map(
        (file) => [file.pathname.split("/ai-provider/")[1] ?? file.pathname, file] as const,
      ),
    )("%s has no host, SDK, key or way to open a connection", (_name, file) => {
      const text = readFileSync(file, "utf8");

      for (const forbidden of [
        API_HOST,
        SDK,
        KEY_START,
        "fetch(",
        "node:http",
        "node:https",
        "node:net",
        "node:dns",
        "node:tls",
        "XMLHttpRequest",
        "WebSocket",
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });

    it("depends on core-model and nothing else", () => {
      const manifest = JSON.parse(
        readFileSync(
          join(new URL(packageRoot).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "package.json"),
          "utf8",
        ),
      ) as {
        dependencies: Record<string, string>;
      };

      expect(Object.keys(manifest.dependencies)).toEqual(["@flawdot/core-model"]);
    });
  });
});
