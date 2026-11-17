import {
  DEFAULT_VIEWPORTS,
  type Capture,
  type Element,
  type PageTarget,
  type Run,
  captureSchema,
  elementSchema,
  pageTargetSchema,
  projectIdSchema,
  runIdSchema,
  runSchema,
} from "../src/index.js";

// Valid ULIDs: 26 Crockford base32 characters, first one at most 7.
export const RUN_ULID = "01J9ZQ3V8K5M2N7P4R6T0W1X2Y";
export const OTHER_ULID = "01J9ZQ3V8K5M2N7P4R6T0W1X2Z";

export const runId = runIdSchema.parse(RUN_ULID);
export const projectId = projectIdSchema.parse("localhost-3000");

// Built through the schemas so a fixture that drifts from the contract fails here, not in the tests.
export const pageTarget: PageTarget = pageTargetSchema.parse({
  url: "http://localhost:3000/blog/hello",
  templateKey: "/blog/:slug",
  templateSize: 12,
});

export const element: Element = elementSchema.parse({
  mark: 1,
  selector: "main > button.cta",
  box: { x: 10, y: 20.5, width: 120, height: 44 },
  tag: "button",
  role: "button",
  name: "Start free trial",
});

export const run: Run = runSchema.parse({
  id: RUN_ULID,
  projectId: "localhost-3000",
  startedAt: "2026-11-17T10:00:00.000Z",
  finishedAt: null,
  entry: "web",
  ai: { kind: "byok", model: "claude-sonnet-5-5", tier: "accurate" },
  language: "en",
  viewports: [DEFAULT_VIEWPORTS.desktop, DEFAULT_VIEWPORTS.mobile],
  pages: [pageTarget],
  status: "running",
});

export const capture: Capture = captureSchema.parse({
  runId: RUN_ULID,
  page: pageTarget,
  viewport: DEFAULT_VIEWPORTS.desktop,
  screenshot: { path: "shots/home-desktop.png", width: 1440, height: 6000 },
  marked: { path: "shots/home-desktop.marked.png" },
  elements: [element],
  title: "Home",
  capturedAt: "2026-11-17T10:00:05.000Z",
});
