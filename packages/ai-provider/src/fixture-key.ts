import { createHash } from "node:crypto";
import { FlawDotError, originOf, type AiAnalysisRequest } from "@flawdot/core-model";

/**
 * The fields of a request that decide which saved answer it gets: what is asked and of which page, and nothing that
 * changes from one run to the next. `requestId` and `runId` are new at every run, and the path of the image holds the
 * run id, so none of them is here. A list that is written out (not "every field except these") means that a field
 * added to the request later cannot change a hash by itself.
 */
export const FIXTURE_KEY_FIELDS = [
  "analyzer",
  "promptVersion",
  "language",
  "viewport",
  "tile",
  "pageUrl",
  "instructions",
  "elements",
  "responseSchema",
] as const satisfies readonly (keyof AiAnalysisRequest)[];

/**
 * JSON with the keys of every object in order, so that the same data gives the same text however it was built. An
 * array keeps its order (it means something). A key whose value is `undefined` is left out, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)) // the keys of an object are all different, so two are never equal
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new FlawDotError("INVALID_INPUT", "A request cannot hold a number that is not finite.");
  }
  return JSON.stringify(value) ?? "null";
}

/** 64 lowercase hexadecimal characters: the name of the file that holds the saved answer, without `.json`. */
export function fixtureKey(request: AiAnalysisRequest): string {
  const stable = Object.fromEntries(FIXTURE_KEY_FIELDS.map((field) => [field, request[field]]));
  return createHash("sha256").update(canonicalJson(stable)).digest("hex");
}

export const FIXTURE_KEY_PATTERN = /^[0-9a-f]{64}$/;

/** A line that says which request it is, for a message: no path and no query, because those can hold a token. */
export function describeRequest(request: AiAnalysisRequest): string {
  return `${request.analyzer}, tile ${String(request.tile)} (${request.viewport}) of ${originOf(request.pageUrl)}`;
}
