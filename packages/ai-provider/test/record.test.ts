import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sampleAiRequest, sampleAiResponse } from "@flawdot/test-support";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { FlawDotError, type AiFulfillment, type AiProvider } from "@flawdot/core-model";
import {
  createFakeProvider,
  createProviderFulfiller,
  RecordInterrupted,
  recordFixtures,
  writeFixture,
} from "../src/index.js";
import { makeTempDir } from "./support/helpers.js";

const answer: AiFulfillment = { response: sampleAiResponse(), model: "claude-haiku-5-5" };
const signal = new AbortController().signal;

/** A stand-in for the real provider: it says it is "claude", counts its calls, and costs a known amount. */
function realLooking(): {
  provider: AiProvider;
  run: Mock<AiProvider["run"]>;
  estimate: Mock<AiProvider["estimate"]>;
} {
  const estimate = vi.fn<AiProvider["estimate"]>(() =>
    Promise.resolve({ inputTokens: 100, outputTokens: 50, usd: 0.01 }),
  );
  const run = vi.fn<AiProvider["run"]>(() => Promise.resolve(answer));
  return { provider: { id: "claude", estimate, run }, run, estimate };
}

describe("recordFixtures", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((clean) => clean()));
  });
  async function folder(): Promise<string> {
    const temp = await makeTempDir();
    cleanups.push(temp.remove);
    return temp.dir;
  }

  it("does not spend anything unless it is told that spending is fine, and says why", async () => {
    const { provider, run, estimate } = realLooking();

    await expect(
      recordFixtures({
        provider,
        tier: "accurate",
        requests: [sampleAiRequest()],
        outDir: await folder(),
        confirmSpend: false,
        signal,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("costs money") as string,
    });
    expect(run).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it("refuses the fake provider: there is nothing to record", async () => {
    await expect(
      recordFixtures({
        provider: createFakeProvider({ fixturesDir: "x" }),
        tier: "accurate",
        requests: [sampleAiRequest()],
        outDir: await folder(),
        confirmSpend: true,
        signal,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("fake") as string,
    });
  });

  it("makes the estimate first, then saves the answer of each request as a fixture the fake provider can replay", async () => {
    const { provider, run } = realLooking();
    const dir = await folder();

    const result = await recordFixtures({
      provider,
      tier: "economy",
      requests: [sampleAiRequest(), sampleAiRequest({ tile: 1 })],
      outDir: dir,
      confirmSpend: true,
      signal,
    });

    expect(result.estimate).toEqual({ inputTokens: 100, outputTokens: 50, usd: 0.01 });
    expect(result.written).toHaveLength(2);
    expect(result.skipped).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(sampleAiRequest(), "economy", signal);
    expect(await readdir(dir)).toHaveLength(2);
    const replay = createProviderFulfiller(createFakeProvider({ fixturesDir: dir }), {
      tier: "economy",
    });
    expect(await replay.fulfill(sampleAiRequest({ requestId: "another-run" }), signal)).toEqual({
      response: sampleAiResponse(),
      model: "claude-haiku-5-5",
    });
  });

  it("skips a request that already has a fixture, and spends nothing on it, unless it is told to overwrite", async () => {
    const { provider, run } = realLooking();
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest(), { kind: "answer", ...answer });

    const skipped = await recordFixtures({
      provider,
      tier: "accurate",
      requests: [sampleAiRequest()],
      outDir: dir,
      confirmSpend: true,
      signal,
    });
    expect(skipped).toMatchObject({ written: [], skipped: 1 });
    expect(run).not.toHaveBeenCalled();

    const overwritten = await recordFixtures({
      provider,
      tier: "accurate",
      requests: [sampleAiRequest()],
      outDir: dir,
      confirmSpend: true,
      overwrite: true,
      signal,
    });
    expect(overwritten.written).toHaveLength(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it("says what it had saved when a call fails half way, with the code of the failure, so the money spent is not lost track of", async () => {
    const { provider, run } = realLooking();
    run
      .mockResolvedValueOnce(answer)
      .mockRejectedValueOnce(new FlawDotError("AI_RATE_LIMIT", "Busy."));
    const dir = await folder();
    await writeFixture(dir, sampleAiRequest({ tile: 2 }), { kind: "answer", ...answer });

    const failure = await recordFixtures({
      provider,
      tier: "accurate",
      requests: [sampleAiRequest(), sampleAiRequest({ tile: 1 }), sampleAiRequest({ tile: 2 })],
      outDir: dir,
      confirmSpend: true,
      signal,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RecordInterrupted);
    const interrupted = failure as RecordInterrupted;
    expect(interrupted).toMatchObject({ code: "AI_RATE_LIMIT", retryable: true });
    expect(interrupted.message).toContain("Busy.");
    expect(interrupted.message).toContain("1 fixture(s) were saved");
    expect(interrupted.partial.written).toHaveLength(1);
    expect(interrupted.partial.skipped).toBe(0); // it stopped before the third request, which has one already
    expect(interrupted.partial.estimate.usd).toBe(0.01);
    expect(interrupted.cause).toBeInstanceOf(FlawDotError);
  });

  it("turns a failure that is not a FlawDotError (a folder that cannot be written) into INTERNAL, still with the result so far", async () => {
    const { provider } = realLooking();
    const temp = await folder();
    const notAFolder = join(temp, "a-file");
    await writeFile(notAFolder, "");

    const failure = await recordFixtures({
      provider,
      tier: "accurate",
      requests: [sampleAiRequest()],
      outDir: notAFolder,
      confirmSpend: true,
      signal,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RecordInterrupted);
    expect(failure).toMatchObject({ code: "INTERNAL", retryable: false });
    expect((failure as RecordInterrupted).partial.written).toEqual([]);
    expect((failure as RecordInterrupted).message).not.toContain(notAFolder);
  });

  it("stops when it is cancelled, and keeps what it has already saved", async () => {
    const controller = new AbortController();
    const { provider, run } = realLooking();
    run.mockImplementation(() => {
      controller.abort(); // cancelled after the first answer
      return Promise.resolve(answer);
    });
    const dir = await folder();

    await expect(
      recordFixtures({
        provider,
        tier: "accurate",
        requests: [sampleAiRequest(), sampleAiRequest({ tile: 1 })],
        outDir: dir,
        confirmSpend: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED", partial: { written: [expect.any(String)] } });

    expect(run).toHaveBeenCalledOnce();
    expect(await readdir(dir)).toHaveLength(1);
  });
});
