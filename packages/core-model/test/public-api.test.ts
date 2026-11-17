import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "../src/index.js";
import * as api from "../src/index.js";
import { OTHER_ULID, RUN_ULID } from "./fixtures.js";

// Only what index.ts exports is contract: a removed or renamed export must fail a test.
describe("public API", () => {
  it("exports the runtime values the other packages rely on", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "DEFAULT_WEIGHTS",
        "PENALTY",
        "REPEAT_CAP",
        "REPEAT_STEP",
        "SCORE_K",
        "SELECTOR_MAX",
        "RULE_KEY_MAX",
        "PRINCIPLE_CODE_MAX",
        "PRINCIPLE_LABEL_MAX",
        "MODEL_MAX",
        "truncateElementName",
        "httpUrlSchema",
        "band",
        "categoryPenalty",
        "categoryScore",
        "categoryWeightsSchema",
        "findingWeight",
        "pageScore",
        "siteScore",
        "AI_TIERS",
        "CATEGORIES",
        "COMPARISONS",
        "DEFAULT_VIEWPORTS",
        "ELEMENT_NAME_MAX",
        "ERROR_CODES",
        "EVIDENCE_MAX",
        "EXPLANATION_MAX",
        "FIX_MAX",
        "FlawDotError",
        "TITLE_MAX",
        "comparisonSchema",
        "findingDraftSchema",
        "findingSchema",
        "findingStateSchema",
        "fingerprint",
        "locationSchema",
        "normalizeSelector",
        "principleSchema",
        "sourceSchema",
        "toFinding",
        "PHASES",
        "REPORT_LANGUAGES",
        "RUN_STATUSES",
        "SEVERITIES",
        "VIEWPORT_NAMES",
        "aiModeSchema",
        "aiTierSchema",
        "boxSchema",
        "captureSchema",
        "categorySchema",
        "elementSchema",
        "findingIdSchema",
        "flawDotErrorCodeSchema",
        "flawDotErrorShapeSchema",
        "isFlawDotError",
        "markIdSchema",
        "pageTargetSchema",
        "parseOrThrow",
        "phaseSchema",
        "progressEventSchema",
        "projectIdSchema",
        "projectSchema",
        "reportLanguageSchema",
        "runIdSchema",
        "runSchema",
        "runStatusSchema",
        "severitySchema",
        "viewportNameSchema",
        "viewportSchema",
      ].sort(),
    );
  });

  it("lets tests fake time and ids through the ports", () => {
    const clock: Clock = { now: () => new Date("2026-11-17T10:00:00.000Z") };
    const ids: IdGenerator = {
      runId: () => api.runIdSchema.parse(RUN_ULID),
      findingId: () => api.findingIdSchema.parse(OTHER_ULID),
    };
    expect(clock.now().toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(ids.runId()).toBe(RUN_ULID);
    expect(ids.findingId()).toBe(OTHER_ULID);
  });
});
