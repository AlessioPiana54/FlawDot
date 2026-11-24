import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sampleAiRequest, sampleAiResponse } from "@flawdot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import {
  fixtureExists,
  fixturePath,
  parseFixture,
  readFixtureText,
  writeFixture,
} from "../src/fixture-file.js";
import { fixtureKey } from "../src/fixture-key.js";
import { makeTempDir } from "./support/helpers.js";

const answer = {
  kind: "answer",
  response: sampleAiResponse(),
  model: "claude-sonnet-5-5",
} as const;
const failure = { kind: "error", code: "AI_RATE_LIMIT", message: "Too many requests." } as const;

describe("parseFixture", () => {
  it("reads an answer, an error and a sequence", () => {
    expect(parseFixture(JSON.stringify(answer), "a.json")).toEqual(answer);
    expect(parseFixture(JSON.stringify(failure), "a.json")).toEqual(failure);
    expect(
      parseFixture(JSON.stringify({ kind: "sequence", steps: [failure, answer] }), "a.json"),
    ).toEqual({ kind: "sequence", steps: [failure, answer] });
  });

  it("keeps the flag that says an error can be tried again, or cannot", () => {
    const step = { ...failure, retryable: false };

    expect(parseFixture(JSON.stringify(step), "a.json")).toEqual(step);
  });

  it("ignores the keys that are for people to read", () => {
    const text = JSON.stringify({
      ...answer,
      describe: "ui-visual tile 0",
      recordedAt: "2026-11-24",
    });

    expect(parseFixture(text, "a.json")).toEqual(answer);
  });

  const invalid: [string, unknown][] = [
    ["a step that is not an object", [1]],
    ["a step of an unknown kind", { kind: "other" }],
    ["an answer from an unknown model", { ...answer, model: "gpt-4" }],
    ["an answer that is not valid", { ...answer, response: { findings: "none" } }],
    ["an answer with an extra key", { ...answer, response: { findings: [], extra: 1 } }],
    ["an error with an unknown code", { ...failure, code: "NOPE" }],
    ["an error with no message", { ...failure, message: "" }],
    ["an error with a message that is too long", { ...failure, message: "x".repeat(301) }],
    ["an error with a retryable flag that is not true or false", { ...failure, retryable: "yes" }],
    ["a sequence with no steps", { kind: "sequence", steps: [] }],
    ["a sequence with too many steps", { kind: "sequence", steps: Array(21).fill(failure) }],
    ["a sequence whose steps are not a list", { kind: "sequence", steps: failure }],
    [
      "a sequence inside a sequence",
      { kind: "sequence", steps: [{ kind: "sequence", steps: [failure] }] },
    ],
  ];

  it.each(invalid)("refuses %s, and says which file it is", (_name, value) => {
    expect(() => parseFixture(JSON.stringify(value), "abc.json")).toThrow(
      expect.objectContaining({
        code: "INTERNAL",
        retryable: false,
        message: expect.stringContaining("abc.json") as string,
      }) as Error,
    );
  });

  it("refuses text that is not JSON", () => {
    expect(() => parseFixture("{ not json", "abc.json")).toThrow(/abc\.json.*not JSON/);
  });
});

describe("fixturePath", () => {
  it("is the folder and the key with .json", () => {
    const key = fixtureKey(sampleAiRequest());

    expect(fixturePath("folder", key)).toBe(join("folder", `${key}.json`));
  });

  it.each(["", "../x", "a".repeat(63), "A".repeat(64), `${"a".repeat(63)}/`])(
    "refuses a key that is not 64 lowercase hexadecimal characters: %j",
    (key) => {
      expect(() => fixturePath("folder", key)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }) as Error,
      );
    },
  );
});

describe("the fixtures on disk", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((clean) => clean()));
  });
  async function folder(): Promise<string> {
    const temp = await makeTempDir();
    cleanups.push(temp.remove);
    return temp.dir;
  }

  it("writes the fixture of a request in the folder, making the folder, and reads it back", async () => {
    const dir = join(await folder(), "not", "there", "yet");

    const path = await writeFixture(dir, sampleAiRequest(), answer);
    const key = fixtureKey(sampleAiRequest());
    const text = await readFixtureText(dir, key);

    expect(path).toBe(fixturePath(dir, key));
    expect(parseFixture(text ?? "", "x.json")).toEqual(answer);
  });

  it("writes a line that says which request it is for, and nothing that tells a page's path", async () => {
    const dir = await folder();
    const path = await writeFixture(
      dir,
      sampleAiRequest({ pageUrl: "https://example.com/private?token=SECRET" }),
      answer,
    );

    const text = await readFile(path, "utf8");

    expect(text).toContain('"describe": "ui-visual, tile 0 (desktop) of https://example.com"');
    expect(text).not.toContain("SECRET");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("tells whether a request has a fixture", async () => {
    const dir = await folder();
    expect(await fixtureExists(dir, sampleAiRequest())).toBe(false);

    await writeFixture(dir, sampleAiRequest(), answer);

    expect(await fixtureExists(dir, sampleAiRequest())).toBe(true);
    expect(await fixtureExists(dir, sampleAiRequest({ tile: 1 }))).toBe(false);
  });

  it("leaves only the fixture in the folder: the file it wrote aside is renamed, never left behind", async () => {
    const dir = await folder();

    await writeFixture(dir, sampleAiRequest(), answer);

    expect(await readdir(dir)).toEqual([`${fixtureKey(sampleAiRequest())}.json`]);
  });

  it("replaces the fixture that is there, whole", async () => {
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest(), failure);

    await writeFixture(dir, sampleAiRequest(), answer);

    const text = await readFixtureText(dir, fixtureKey(sampleAiRequest()));
    expect(parseFixture(text ?? "", "x.json")).toEqual(answer);
  });

  it("says that a request has no fixture when the folder is not there", async () => {
    expect(await fixtureExists(join(await folder(), "missing"), sampleAiRequest())).toBe(false);
  });

  it("fails with INTERNAL, naming the file, when it cannot tell whether a fixture is there", async () => {
    const dir = await folder();
    await writeFile(join(dir, "a-file"), "");

    // `a-file/…` is below a file, not a folder: not "missing" but impossible, on every system (ENOTDIR or ENOENT).
    const outcome = await fixtureExists(join(dir, "a-file"), sampleAiRequest()).then(
      (exists) => exists,
      (error: unknown) => error,
    );

    expect([false, expect.objectContaining({ code: "INTERNAL" })]).toContainEqual(outcome);
  });

  it("finds nothing, without failing, when the folder is not there", async () => {
    const dir = join(await folder(), "missing");

    expect(await readFixtureText(dir, fixtureKey(sampleAiRequest()))).toBeUndefined();
  });

  it("fails with INTERNAL, naming the file, when it cannot be read for another reason", async () => {
    const dir = await folder();
    // A folder where the file should be: reading it fails with EISDIR, not ENOENT.
    const key = fixtureKey(sampleAiRequest());
    await writeFile(join(dir, "marker"), "");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(dir, `${key}.json`)));

    await expect(readFixtureText(dir, key)).rejects.toMatchObject({
      code: "INTERNAL",
      retryable: false,
      message: expect.stringContaining(`${key}.json`) as string,
    });
  });
});
