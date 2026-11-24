import { rm, writeFile } from "node:fs/promises";
import { runAiProviderContract, sampleAiRequest, sampleAiResponse } from "@flawdot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath } from "../src/fixture-file.js";
import { createFakeProvider, fixtureKey, writeFixture } from "../src/index.js";
import { folderWithAnswer, makeTempDir } from "./support/helpers.js";

const signal = new AbortController().signal;

runAiProviderContract(async () => {
  const folder = await folderWithAnswer();
  return { subject: createFakeProvider({ fixturesDir: folder.dir }), dispose: folder.remove };
});

describe("the fake provider", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((clean) => clean()));
  });
  async function folder(): Promise<string> {
    const temp = await makeTempDir();
    cleanups.push(temp.remove);
    return temp.dir;
  }

  it("answers with the saved answer and the model the file says, whatever the tier", async () => {
    const temp = await folderWithAnswer("claude-haiku-5-5");
    cleanups.push(temp.remove);
    const provider = createFakeProvider({ fixturesDir: temp.dir });

    for (const tier of ["accurate", "economy"] as const) {
      const result = await provider.run(sampleAiRequest(), tier, signal);

      expect(result).toEqual({ response: sampleAiResponse(), model: "claude-haiku-5-5" });
    }
  });

  it("finds the answer of the same request in another run, with another request id and run id", async () => {
    const temp = await folderWithAnswer();
    cleanups.push(temp.remove);
    const provider = createFakeProvider({ fixturesDir: temp.dir });

    const result = await provider.run(
      sampleAiRequest({ requestId: "another-one" }),
      "accurate",
      signal,
    );

    expect(result.response).toEqual(sampleAiResponse());
  });

  it("fails with INTERNAL when the request has no fixture, naming the request and never the network", async () => {
    const dir = await folder();
    const provider = createFakeProvider({ fixturesDir: dir });
    const request = sampleAiRequest({ pageUrl: "https://example.com/private?token=SECRET" });

    const failure = await provider
      .run(request, "accurate", signal)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "INTERNAL", retryable: false });
    const message = (failure as Error).message;
    expect(message).toContain(fixtureKey(request));
    expect(message).toContain("ui-visual, tile 0 (desktop) of https://example.com");
    expect(message).toContain("never uses the network");
    expect(message).not.toContain("SECRET");
  });

  it("fails with INTERNAL, naming the file, when a fixture is broken", async () => {
    const dir = await folder();
    await writeFile(fixturePath(dir, fixtureKey(sampleAiRequest())), "{ broken");
    const provider = createFakeProvider({ fixturesDir: dir });

    await expect(provider.run(sampleAiRequest(), "accurate", signal)).rejects.toMatchObject({
      code: "INTERNAL",
      message: expect.stringContaining(`${fixtureKey(sampleAiRequest())}.json`) as string,
    });
  });

  it("fails as the fixture says, with the flag it says, so the retries and the failures can be tried", async () => {
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest(), {
      kind: "error",
      code: "AI_AUTH",
      message: "Key refused.",
    });
    await writeFixture(dir, sampleAiRequest({ tile: 1 }), {
      kind: "error",
      code: "AI_BAD_RESPONSE",
      message: "The model refused.",
      retryable: true,
    });
    const provider = createFakeProvider({ fixturesDir: dir });

    await expect(provider.run(sampleAiRequest(), "accurate", signal)).rejects.toMatchObject({
      code: "AI_AUTH",
      message: "Key refused.",
      retryable: false,
    });
    await expect(
      provider.run(sampleAiRequest({ tile: 1 }), "accurate", signal),
    ).rejects.toMatchObject({
      code: "AI_BAD_RESPONSE",
      retryable: true,
    });
  });

  it("plays a sequence one step at each call and repeats the last", async () => {
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest(), {
      kind: "sequence",
      steps: [
        { kind: "error", code: "AI_RATE_LIMIT", message: "Busy." },
        { kind: "answer", response: sampleAiResponse(), model: "claude-sonnet-5-5" },
      ],
    });
    const provider = createFakeProvider({ fixturesDir: dir });

    const outcomes: string[] = [];
    for (let call = 0; call < 4; call += 1) {
      outcomes.push(
        await provider.run(sampleAiRequest(), "accurate", signal).then(
          () => "answer",
          (error: Error & { code: string }) => error.code,
        ),
      );
    }

    expect(outcomes).toEqual(["AI_RATE_LIMIT", "answer", "answer", "answer"]);
  });

  it("keeps the count of a sequence for each provider, so two tests do not share it", async () => {
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest(), {
      kind: "sequence",
      steps: [
        { kind: "error", code: "AI_RATE_LIMIT", message: "Busy." },
        { kind: "answer", response: sampleAiResponse(), model: "claude-sonnet-5-5" },
      ],
    });
    const first = createFakeProvider({ fixturesDir: dir });
    await first.run(sampleAiRequest(), "accurate", signal).catch(() => undefined);

    await expect(
      createFakeProvider({ fixturesDir: dir }).run(sampleAiRequest(), "accurate", signal),
    ).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
  });

  it("reads a fixture once: it keeps it, so deleting the file does not change the answers", async () => {
    const temp = await folderWithAnswer();
    cleanups.push(temp.remove);
    const provider = createFakeProvider({ fixturesDir: temp.dir });
    await provider.run(sampleAiRequest(), "accurate", signal);

    await rm(fixturePath(temp.dir, fixtureKey(sampleAiRequest())));

    await expect(provider.run(sampleAiRequest(), "accurate", signal)).resolves.toBeDefined();
  });

  it("is cancelled while it looks for the fixture", async () => {
    const temp = await folderWithAnswer();
    cleanups.push(temp.remove);
    const provider = createFakeProvider({ fixturesDir: temp.dir });
    const controller = new AbortController();

    const pending = provider.run(sampleAiRequest(), "accurate", controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  describe("estimate", () => {
    it("costs nothing, and counts the same for the same requests whatever the tier", async () => {
      const provider = createFakeProvider({ fixturesDir: "no-such-folder" });
      const requests = [sampleAiRequest(), sampleAiRequest({ tile: 1 })];

      const accurate = await provider.estimate(requests, "accurate");
      const economy = await provider.estimate(requests, "economy");

      expect(accurate).toEqual(economy);
      expect(accurate.usd).toBe(0);
      expect(accurate.outputTokens).toBe(1600);
      expect(await provider.estimate(requests, "accurate")).toEqual(accurate);
    });

    it("grows with the text of the request, and does not read a file", async () => {
      const provider = createFakeProvider({ fixturesDir: "no-such-folder" });

      const short = await provider.estimate([sampleAiRequest({ instructions: "a" })], "accurate");
      const long = await provider.estimate(
        [sampleAiRequest({ instructions: "a".repeat(4000) })],
        "accurate",
      );

      expect(long.inputTokens - short.inputTokens).toBeGreaterThan(900);
    });
  });
});
