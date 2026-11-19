import {
  DEFAULT_VIEWPORTS,
  findingIdSchema,
  findingSchema,
  projectIdSchema,
  runIdSchema,
  runSchema,
  type Clock,
  type Finding,
  type FindingId,
  type ProjectId,
  type Run,
  type RunId,
} from "@flawdot/core-model";

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A valid ULID that grows with `n` (0 to 1023): the ids sort in the order of the numbers, as real ones sort
 * by creation time. `n.toString(32)` is not used because JavaScript's digits include I, L, O and U, which a ULID has not.
 */
export function ulid(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 1023) {
    throw new RangeError("ulid(n) needs an integer from 0 to 1023");
  }
  return `${"0".repeat(24)}${BASE32.charAt(Math.floor(n / 32))}${BASE32.charAt(n % 32)}`;
}

export const runId = (n: number): RunId => runIdSchema.parse(ulid(n));
export const findingId = (n: number): FindingId => findingIdSchema.parse(ulid(n));
export const projectId = (value: string): ProjectId => projectIdSchema.parse(value);

/** A fingerprint is 64 hexadecimal characters; `fingerprint("b")` is a different one from `fingerprint("a")`. */
export function fingerprint(hexDigit: string): string {
  return hexDigit.repeat(64);
}

/** A clock that only moves when the test says so. */
export class ManualClock implements Clock {
  #now: number;

  constructor(startIso = "2026-01-01T00:00:00.000Z") {
    this.#now = Date.parse(startIso);
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(milliseconds: number): void {
    this.#now += milliseconds;
  }
}

/** A valid run of the project `example.com` that has finished. Every field can be replaced. */
export function makeRun(overrides: Partial<Run> = {}): Run {
  return runSchema.parse({
    id: runId(1),
    projectId: projectId("example.com"),
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    entry: "web",
    ai: { kind: "none" },
    language: "en",
    viewports: [DEFAULT_VIEWPORTS.desktop],
    pages: [{ url: "https://example.com/", templateKey: "/", templateSize: 1 }],
    status: "completed",
    ...overrides,
  });
}

/** A valid finding of a rule, on the element number 1 of the run `runId(1)`. Every field can be replaced. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    category: "accessibility",
    severity: "critical",
    ruleKey: "color-contrast",
    title: "Title",
    explanation: "Why",
    fix: "Fix",
    evidence: null,
    principle: { code: null, label: "axe rule" },
    source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
    location: {
      kind: "element",
      mark: 1,
      selector: "#e1",
      box: { x: 0, y: 0, width: 10, height: 10 },
      count: 1,
    },
    id: findingId(1),
    runId: runId(1),
    pageUrl: "https://example.com/",
    templateKey: "/",
    viewport: "desktop",
    number: 1,
    fingerprint: fingerprint("a"),
    language: "en",
    ...overrides,
  });
}
