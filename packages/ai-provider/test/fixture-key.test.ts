import { readdirSync } from "node:fs";
import { sampleAiRequest } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  describeRequest,
  FIXTURE_KEY_FIELDS,
  FIXTURE_KEY_PATTERN,
  fixtureKey,
} from "../src/fixture-key.js";

describe("canonicalJson", () => {
  it("puts the keys of every object in order, at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("gives the same text for the same data built in another order", () => {
    expect(canonicalJson({ x: 1, y: [1, { q: 1, p: 2 }] })).toBe(
      canonicalJson({ y: [1, { p: 2, q: 1 }], x: 1 }),
    );
  });

  it("keeps the order of an array, because it means something", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("leaves out a key that is undefined, and writes undefined in an array as null, as JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  it("writes plain values as JSON does", () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("refuses a number that is not finite, which JSON cannot write", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/finite/);
    expect(() => canonicalJson(Infinity)).toThrow(/finite/);
  });
});

describe("fixtureKey", () => {
  it("is 64 lowercase hexadecimal characters", () => {
    expect(fixtureKey(sampleAiRequest())).toMatch(FIXTURE_KEY_PATTERN);
  });

  it("is the same for the same request", () => {
    expect(fixtureKey(sampleAiRequest())).toBe(fixtureKey(sampleAiRequest()));
  });

  it("does not change with what changes from one run to the next: the request id, the run id and the image file", () => {
    const base = fixtureKey(sampleAiRequest());

    expect(fixtureKey(sampleAiRequest({ requestId: "another-request" }))).toBe(base);
    expect(
      fixtureKey(
        sampleAiRequest({
          runId: "00000000000000000000000002" as ReturnType<typeof sampleAiRequest>["runId"],
        }),
      ),
    ).toBe(base);
    expect(
      fixtureKey(
        sampleAiRequest({ image: { path: "runs/other/tile-0.png", mediaType: "image/png" } }),
      ),
    ).toBe(base);
  });

  it("does not change with the order of the keys inside the elements or the schema", () => {
    const request = sampleAiRequest({ responseSchema: { type: "object", title: "x" } });
    const reordered = sampleAiRequest({ responseSchema: { title: "x", type: "object" } });

    expect(fixtureKey(reordered)).toBe(fixtureKey(request));
  });

  const changes: Record<
    (typeof FIXTURE_KEY_FIELDS)[number],
    Partial<ReturnType<typeof sampleAiRequest>>
  > = {
    analyzer: { analyzer: "conversion" },
    promptVersion: { promptVersion: "v2" },
    language: { language: "it" },
    viewport: { viewport: "mobile" },
    tile: { tile: 1 },
    pageUrl: { pageUrl: "https://example.com/other" },
    instructions: { instructions: "Something else." },
    elements: { elements: [] },
    responseSchema: { responseSchema: { type: "array" } },
  };

  it.each(FIXTURE_KEY_FIELDS)("changes when %s changes", (field) => {
    expect(fixtureKey(sampleAiRequest(changes[field]))).not.toBe(fixtureKey(sampleAiRequest()));
  });

  it("is a known value for a known request, so that a change of how it is made cannot go unnoticed", () => {
    // If this fails, every saved answer is orphaned: change it only on purpose, and record the fixtures again.
    expect(fixtureKey(sampleAiRequest())).toBe(
      "a1015d684f7dbc040d5c764921e0bf853bf5530a816035693b3d9c4f50d31182",
    );
  });

  it("finds the fixture that is saved in the repository for the sample request", () => {
    const saved = readdirSync(new URL("./fixtures/", import.meta.url));

    expect(saved).toContain(`${fixtureKey(sampleAiRequest())}.json`);
  });
});

describe("describeRequest", () => {
  it("says which request it is with the origin of the page, and not its path or query", () => {
    const text = describeRequest(
      sampleAiRequest({ pageUrl: "https://example.com/private?token=SECRET" }),
    );

    expect(text).toBe("ui-visual, tile 0 (desktop) of https://example.com");
    expect(text).not.toContain("SECRET");
  });
});
