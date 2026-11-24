import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiAnalysisRequest, AiFulfillment, AiProvider, AiTier } from "@flawdot/core-model";
import { sampleAiRequest, sampleAiResponse } from "@flawdot/test-support";
import { writeFixture } from "../../src/index.js";

/** A folder of its own for a test, and the way to throw it away. */
export async function makeTempDir(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "flawdot-ai-"));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** A folder where the request `sampleAiRequest()` has the answer `sampleAiResponse()`, written by the model `model`. */
export async function folderWithAnswer(
  model: "claude-sonnet-5-5" | "claude-haiku-5-5" = "claude-sonnet-5-5",
): Promise<{ dir: string; remove: () => Promise<void> }> {
  const temp = await makeTempDir();
  await writeFixture(temp.dir, sampleAiRequest(), {
    kind: "answer",
    response: sampleAiResponse(),
    model,
  });
  return temp;
}

/** A provider that plays a script: each call takes the next step (the last repeats). It counts its calls. */
export function scriptedProvider(steps: readonly (AiFulfillment | Error)[]): AiProvider & {
  calls: { request: AiAnalysisRequest; tier: AiTier }[];
} {
  const calls: { request: AiAnalysisRequest; tier: AiTier }[] = [];
  return {
    id: "fake",
    calls,
    estimate: () => Promise.resolve({ inputTokens: 0, outputTokens: 0, usd: 0 }),
    run(request, tier) {
      const step = steps[Math.min(calls.length, steps.length - 1)];
      calls.push({ request, tier });
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step as AiFulfillment);
    },
  };
}

/** A promise that nothing ever settles: a model that does not answer, a person who has not come back. */
export function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}
