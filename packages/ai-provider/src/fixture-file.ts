import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ERROR_CODES,
  FlawDotError,
  parseAiResponse,
  type AiAnalysisRequest,
  type AiAnalysisResponse,
  type AiModel,
  type FlawDotErrorCode,
} from "@flawdot/core-model";
import { describeRequest, FIXTURE_KEY_PATTERN, fixtureKey } from "./fixture-key.js";

// A fixture is the saved answer to one request: a JSON file named after the hash of the request (`fixtureKey`). It is
// data that a person writes or records, and it is checked when it is loaded, like any other answer.

/** What the fake provider does when it gets a request: answer, or fail as a real provider would. */
export type FakeStep =
  | { kind: "answer"; response: AiAnalysisResponse; model: AiModel }
  | { kind: "error"; code: FlawDotErrorCode; message: string; retryable?: boolean };

/** One step, or several that follow each other, one at each call; the last one repeats ("429, 429, then an answer"). */
export type FakeFixture = FakeStep | { kind: "sequence"; steps: readonly FakeStep[] };

const MODELS: readonly AiModel[] = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-code"];
const MAX_STEPS = 20;
const MAX_MESSAGE = 300;

function broken(fileName: string, problem: string): FlawDotError {
  return new FlawDotError(
    "INTERNAL",
    `The fixture ${fileName} is not valid: ${problem}. Record it again with record-fixtures.`,
    { retryable: false },
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseStep(raw: unknown, fileName: string): FakeStep {
  const step = asRecord(raw);
  if (step === undefined) throw broken(fileName, "a step is not an object");

  if (step["kind"] === "answer") {
    const model = step["model"];
    if (!MODELS.some((known) => known === model)) throw broken(fileName, "the model is unknown");
    let response: AiAnalysisResponse;
    try {
      response = parseAiResponse(step["response"]);
    } catch (error) {
      // `parseAiResponse` only ever throws a `FlawDotError`, whose message says which part is wrong.
      throw broken(fileName, (error as FlawDotError).message);
    }
    return { kind: "answer", response, model: model as AiModel };
  }

  if (step["kind"] === "error") {
    const { code, message, retryable } = step;
    if (!ERROR_CODES.some((known) => known === code))
      throw broken(fileName, "the error code is unknown");
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE) {
      throw broken(
        fileName,
        `the error message must be text of 1 to ${String(MAX_MESSAGE)} characters`,
      );
    }
    if (retryable !== undefined && typeof retryable !== "boolean") {
      throw broken(fileName, "retryable must be true or false");
    }
    return {
      kind: "error",
      code: code as FlawDotErrorCode,
      message,
      ...(retryable === undefined ? {} : { retryable }),
    };
  }

  throw broken(fileName, 'a step must have kind "answer" or "error"');
}

/** Reads the text of a fixture. Unknown keys (`describe`, `recordedAt`) are for people and are ignored. */
export function parseFixture(text: string, fileName: string): FakeFixture {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw broken(fileName, "it is not JSON");
  }
  const fixture = asRecord(raw);
  if (fixture?.["kind"] !== "sequence") return parseStep(raw, fileName);

  const steps = fixture["steps"];
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    throw broken(fileName, `a sequence needs 1 to ${String(MAX_STEPS)} steps`);
  }
  return { kind: "sequence", steps: steps.map((step) => parseStep(step, fileName)) };
}

export function fixturePath(dir: string, key: string): string {
  // The key is computed by `fixtureKey`, so this never fails for a real request: it is a seat belt for a caller that
  // passes something else, so that a name can never leave the folder.
  if (!FIXTURE_KEY_PATTERN.test(key)) {
    throw new FlawDotError(
      "INVALID_INPUT",
      "A fixture key is 64 lowercase hexadecimal characters.",
    );
  }
  return join(dir, `${key}.json`);
}

function unreadable(key: string, error: unknown): FlawDotError {
  return new FlawDotError("INTERNAL", `The fixture ${key}.json cannot be read.`, {
    retryable: false,
    cause: error,
  });
}

/** What `work` gives, or `undefined` when the file is not there; any other failure is an error that names the file. */
async function ifThere<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw unreadable(key, error);
  }
}

/** The text of the fixture with this key (see `fixtureKey`), or `undefined` when there is none. */
export function readFixtureText(dir: string, key: string): Promise<string | undefined> {
  const path = fixturePath(dir, key);
  return ifThere(key, () => readFile(path, "utf8"));
}

/** Whether the request already has a fixture. It does not read the file. */
export async function fixtureExists(dir: string, request: AiAnalysisRequest): Promise<boolean> {
  const key = fixtureKey(request);
  const path = fixturePath(dir, key);
  return (await ifThere(key, () => access(path).then(() => true))) ?? false;
}

/** Saves the fixture of a request (and the folder, if it is not there). Gives back the path of the file. */
export async function writeFixture(
  dir: string,
  request: AiAnalysisRequest,
  fixture: FakeFixture,
): Promise<string> {
  const path = fixturePath(dir, fixtureKey(request));
  await mkdir(dir, { recursive: true });
  const body = { describe: describeRequest(request), ...fixture };
  // Written aside and then renamed, so that a process that stops half way never leaves a file that looks like a
  // fixture but is cut: `recordFixtures` would skip it for ever, and every test would fail on it.
  const aside = `${path}.tmp`;
  await writeFile(aside, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(aside, path);
  return path;
}
