import {
  FlawDotError,
  isFlawDotError,
  type AbortSignalLike,
  type AiAnalysisRequest,
  type AiProvider,
  type AiTier,
  type CostEstimate,
} from "@flawdot/core-model";
import { throwIfAborted } from "./abort.js";
import { fixtureExists, writeFixture } from "./fixture-file.js";

export interface RecordOptions {
  /** A real provider: the answers it gives are saved. The fake provider is refused (there is nothing to record). */
  provider: AiProvider;
  tier: AiTier;
  requests: readonly AiAnalysisRequest[];
  /** The folder of the fixtures. */
  outDir: string;
  /** Recording calls the real API, and that costs money: it only runs when this is `true`. */
  confirmSpend: boolean;
  /** Save over a fixture that is already there. By default it is skipped, and nothing is spent on it. */
  overwrite?: boolean;
  signal: AbortSignalLike;
}

export interface RecordResult {
  /** The estimate that was made before the first call. */
  estimate: CostEstimate;
  written: string[];
  skipped: number;
}

/**
 * What stopped a recording half way. It has the code and the flag of the failure that caused it (so a caller can still
 * tell a cancel from a rate limit) and what had been done by then: the answers that cost money are saved, and a new
 * run skips them.
 */
export class RecordInterrupted extends FlawDotError {
  readonly partial: RecordResult;

  constructor(failure: FlawDotError, partial: RecordResult) {
    super(
      failure.code,
      `${failure.message} ${String(partial.written.length)} fixture(s) were saved before it stopped; a new run skips them.`,
      { retryable: failure.retryable, cause: failure },
    );
    this.partial = partial;
  }
}

/**
 * Records the answers of a real provider as fixtures, so the tests can replay them for free. It spends API money, so
 * it asks for `confirmSpend` and it makes the estimate before the first call. It does nothing by itself: a person
 * runs it (the script `record-fixtures`), never a test and never the CI.
 */
export async function recordFixtures(options: RecordOptions): Promise<RecordResult> {
  if (!options.confirmSpend) {
    throw new FlawDotError(
      "INVALID_INPUT",
      "Recording calls the real API and costs money. Run it again with confirmSpend, once you have read the estimate.",
    );
  }
  if (options.provider.id === "fake") {
    throw new FlawDotError(
      "INVALID_INPUT",
      "The fake provider has nothing to record: use a real provider.",
    );
  }

  const estimate = await options.provider.estimate(options.requests, options.tier);
  const written: string[] = [];
  let skipped = 0;
  try {
    for (const request of options.requests) {
      throwIfAborted(options.signal);
      if (options.overwrite !== true && (await fixtureExists(options.outDir, request))) {
        skipped += 1;
        continue;
      }
      const answer = await options.provider.run(request, options.tier, options.signal);
      written.push(
        await writeFixture(options.outDir, request, {
          kind: "answer",
          response: answer.response,
          model: answer.model,
        }),
      );
    }
  } catch (error) {
    const failure = isFlawDotError(error)
      ? error
      : new FlawDotError("INTERNAL", "Recording failed in an unexpected way.", {
          retryable: false,
          cause: error,
        });
    throw new RecordInterrupted(failure, { estimate, written, skipped });
  }
  return { estimate, written, skipped };
}
