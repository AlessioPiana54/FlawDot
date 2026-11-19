import {
  captureSchema,
  findingSchema,
  type Capture,
  type Finding,
  type Severity,
  type ViewportName,
} from "@flawdot/core-model";

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A valid ULID that is different for each number (up to 1024). */
const ulid = (n: number): string =>
  `${"0".repeat(24)}${BASE32[Math.floor(n / 32) % 32] ?? "0"}${BASE32[n % 32] ?? "0"}`;

export const PAGE_URL = "https://example.com/page";
export const RUN_ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

export type BoxTuple = readonly [x: number, y: number, width: number, height: number];

interface FindingOptions {
  pageUrl?: string;
  viewport?: ViewportName;
  number?: number | null;
  page?: boolean;
  /** Makes the id from this number instead of the circle number, to test an order that is not the order of the ids. */
  idSeed?: number;
}

/** A valid finding with a circle number, on the element at `box` (CSS pixels of the whole page). */
export function finding(
  number: number,
  severity: Severity,
  box: BoxTuple,
  options: FindingOptions = {},
): Finding {
  const [x, y, width, height] = box;
  const isPage = options.page === true;
  return findingSchema.parse({
    category: "accessibility",
    severity,
    ruleKey: "color-contrast",
    title: "Title",
    explanation: "Why",
    fix: "Fix",
    evidence: null,
    principle: { code: null, label: "axe rule" },
    source: { kind: "rule", engine: "axe-core", ruleId: "color-contrast" },
    location: isPage
      ? { kind: "page" }
      : {
          kind: "element",
          mark: number,
          selector: `#e${String(number)}`,
          box: { x, y, width, height },
          count: 1,
        },
    id: ulid(options.idSeed ?? number),
    runId: RUN_ID,
    pageUrl: options.pageUrl ?? PAGE_URL,
    templateKey: "/page",
    viewport: options.viewport ?? "desktop",
    number: isPage ? null : options.number === undefined ? number : options.number,
    fingerprint: "a".repeat(64),
    language: "en",
  });
}

/** A capture of a screenshot that is `width` x `height` pixels, taken at `scale` pixels for each CSS pixel. */
export function capture(screenshotPath: string, width: number, height: number, scale = 1): Capture {
  return captureSchema.parse({
    runId: RUN_ID,
    page: { url: PAGE_URL, templateKey: "/page", templateSize: 1 },
    viewport: {
      name: "desktop",
      width: width / scale,
      height: Math.min(900, height / scale),
      deviceScaleFactor: scale,
    },
    screenshot: { path: screenshotPath, width, height },
    marked: { path: `${screenshotPath}.marked` },
    elements: [],
    title: null,
    capturedAt: "2026-11-19T10:00:00.000Z",
  });
}

/** A small deterministic random generator, so a property test fails the same way every time. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
