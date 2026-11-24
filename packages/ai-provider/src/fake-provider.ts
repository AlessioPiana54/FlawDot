import {
  FlawDotError,
  type AiAnalysisRequest,
  type AiFulfillment,
  type AiProvider,
  type AiTier,
  type AbortSignalLike,
  type CostEstimate,
} from "@flawdot/core-model";
import { raceAbort, throwIfAborted } from "./abort.js";
import { parseFixture, readFixtureText, type FakeFixture, type FakeStep } from "./fixture-file.js";
import { describeRequest, fixtureKey } from "./fixture-key.js";

export interface FakeProviderOptions {
  /** The folder with the saved answers, one `<hash>.json` for each request (see `fixtureKey`). */
  fixturesDir: string;
}

// A fake costs nothing, but its numbers must not change from one run to the next, because the tests that show an
// estimate compare them. The tokens are a rough count by the length of the text, plus a fixed part for the image.
const IMAGE_TOKENS = 1500;
const ANSWER_TOKENS = 800;

function tokensOf(request: AiAnalysisRequest): number {
  const characters =
    request.instructions.length +
    JSON.stringify(request.elements).length +
    JSON.stringify(request.responseSchema).length;
  return Math.ceil(characters / 4) + IMAGE_TOKENS;
}

/**
 * A provider that answers from saved files and never reaches the network, so the whole pipeline runs in the tests
 * with no key and no cost (N1). A request with no saved answer is an error that names the request, never a call.
 * The tier is ignored on purpose: the answers are written for a request, and the model is the one the file says.
 */
export function createFakeProvider(options: FakeProviderOptions): AiProvider {
  const loaded = new Map<string, FakeFixture>();
  const calls = new Map<string, number>();

  async function load(request: AiAnalysisRequest): Promise<{ key: string; fixture: FakeFixture }> {
    const key = fixtureKey(request);
    const cached = loaded.get(key);
    if (cached !== undefined) return { key, fixture: cached };
    const text = await readFixtureText(options.fixturesDir, key);
    if (text === undefined) {
      throw new FlawDotError(
        "INTERNAL",
        `There is no fixture ${key}.json for this request (${describeRequest(request)}). ` +
          "Write it with writeFixture, or record it with record-fixtures. The fake provider never uses the network.",
        { retryable: false },
      );
    }
    const fixture = parseFixture(text, `${key}.json`);
    loaded.set(key, fixture);
    return { key, fixture };
  }

  function stepFor(key: string, fixture: FakeFixture): FakeStep {
    if (fixture.kind !== "sequence") return fixture;
    const count = calls.get(key) ?? 0;
    calls.set(key, count + 1);
    return fixture.steps[Math.min(count, fixture.steps.length - 1)] as FakeStep;
  }

  return {
    id: "fake",

    estimate(requests: readonly AiAnalysisRequest[], _tier: AiTier): Promise<CostEstimate> {
      return Promise.resolve({
        inputTokens: requests.reduce((total, request) => total + tokensOf(request), 0),
        outputTokens: requests.length * ANSWER_TOKENS,
        usd: 0,
      });
    },

    async run(
      request: AiAnalysisRequest,
      _tier: AiTier,
      signal: AbortSignalLike,
    ): Promise<AiFulfillment> {
      throwIfAborted(signal);
      const { key, fixture } = await raceAbort(load(request), signal);
      const step = stepFor(key, fixture);
      if (step.kind === "error") {
        throw new FlawDotError(
          step.code,
          step.message,
          step.retryable === undefined ? {} : { retryable: step.retryable },
        );
      }
      // A copy, so that a caller who edits the answer does not change the next one.
      return { response: structuredClone(step.response), model: step.model };
    },
  };
}
