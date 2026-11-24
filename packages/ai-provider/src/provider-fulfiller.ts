import {
  FlawDotError,
  isFlawDotError,
  parseAiResponse,
  type AiAnalysisRequest,
  type AiFulfiller,
  type AiFulfillment,
  type AiProvider,
  type AiTier,
  type AbortSignalLike,
} from "@flawdot/core-model";
import { raceAbort, sleep, throwIfAborted, type Sleep } from "./abort.js";

export interface ProviderFulfillerOptions {
  /** The tier to ask for, or a function that says it (read once for each request, so a change of setting is seen). */
  tier: AiTier | (() => AiTier);
  /** How many times to try again after a failure that can pass. Default 2, so at most 3 calls. */
  maxRetries?: number;
  /** The first pause, in milliseconds; each one is twice the one before. Default 500. */
  baseDelayMs?: number;
  /** How to wait. A test gives one that does not wait. */
  sleep?: Sleep;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

/** A key that is refused or an answer that is not valid does not get better by asking again, whatever the provider says. */
const NEVER_RETRIED = new Set(["AI_AUTH", "AI_BAD_RESPONSE", "CANCELLED"]);

function checked(name: string, value: number | undefined, fallback: number): number {
  const number = value ?? fallback;
  if (!Number.isInteger(number) || number < 0) {
    throw new FlawDotError("INVALID_INPUT", `${name} must be a whole number, 0 or more.`);
  }
  return number;
}

/** Whatever a provider throws crosses the boundary as a `FlawDotError`; the text of a stranger is never shown. */
function asFlawDotError(error: unknown): FlawDotError {
  return isFlawDotError(error)
    ? error
    : new FlawDotError("INTERNAL", "The AI provider failed in an unexpected way.", {
        retryable: false,
        cause: error,
      });
}

/**
 * Asks a provider (the user's key, or the fake one in the tests). It tries again, with a growing pause, when the
 * provider says the failure can pass (a limit of requests, a server that is busy), up to `maxRetries` times; it never
 * tries again after a key that is refused, an answer that is not valid or a cancel. An answer is checked again before
 * it is given on, and a failure is thrown, never turned into `not_analyzed`: that answer is for "nobody was asked".
 */
export function createProviderFulfiller(
  provider: AiProvider,
  options: ProviderFulfillerOptions,
): AiFulfiller {
  const maxRetries = checked("maxRetries", options.maxRetries, DEFAULT_MAX_RETRIES);
  const baseDelayMs = checked("baseDelayMs", options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const wait = options.sleep ?? sleep;

  return {
    mode: "byok",

    async fulfill(request: AiAnalysisRequest, signal: AbortSignalLike): Promise<AiFulfillment> {
      throwIfAborted(signal);
      const tier = typeof options.tier === "function" ? options.tier() : options.tier;

      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await raceAbort(provider.run(request, tier, signal), signal);
          return { response: parseAiResponse(result.response), model: result.model };
        } catch (error) {
          const failure = asFlawDotError(error);
          const again = failure.retryable && !NEVER_RETRIED.has(failure.code);
          if (!again || attempt >= maxRetries) throw failure;
          await wait(baseDelayMs * 2 ** attempt, signal);
        }
      }
    },
  };
}
