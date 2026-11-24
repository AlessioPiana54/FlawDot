import * as z from "zod";
import {
  aiModeSchema,
  categorySchema,
  httpUrlSchema,
  reportLanguageSchema,
  runStatusSchema,
  viewportNameSchema,
} from "./domain.js";
import { flawDotErrorShapeSchema } from "./errors.js";
import { findingSchema } from "./finding.js";
import { projectIdSchema, runIdSchema } from "./ids.js";
import { bandSchema, categoryWeightsSchema } from "./scoring.js";

// What a report is made of. It is built from what is saved (the findings, the "ignore" states, the outcome of each
// capture) and the weights in force at the moment, so it is never stored. The objects are not strict on purpose:
// the tasks that add to a report (the comparison with the last run, the "Show N more" lists) add optional fields.

const count = z.int().nonnegative();
const score = z.int().min(0).max(100).nullable(); // null is "—": that category was not analyzed

/** A finding is not extended with a field: its schema has a rule of its own, so the pair is kept apart. */
export const reportFindingSchema = z.object({ finding: findingSchema, ignored: z.boolean() });
export type ReportFinding = z.infer<typeof reportFindingSchema>;

/** One page at one viewport. `not_run`: the run was cancelled before it got there. */
export const reportPageSchema = z.object({
  url: httpUrlSchema,
  templateKey: z.string().min(1),
  templateSize: z.int().positive(),
  viewport: viewportNameSchema,
  status: z.enum(["done", "failed", "not_run"]),
  error: flawDotErrorShapeSchema.nullable(),
  screenshot: z
    .object({ path: z.string().min(1), width: z.int().positive(), height: z.int().positive() })
    .nullable(),
  annotatedPath: z.string().min(1).nullable(),
  categories: z.object({ ui: score, ux: score, accessibility: score, conversion: score }),
  score,
  band: bandSchema.nullable(),
  /** In the order of the circle numbers, the ones with no number last. Ignored ones are here, marked. */
  findings: z.array(reportFindingSchema),
});
export type ReportPage = z.infer<typeof reportPageSchema>;

export const reportDataSchema = z.object({
  run: z.object({
    id: runIdSchema,
    projectId: projectIdSchema,
    status: runStatusSchema,
    entry: z.enum(["web", "mcp"]),
    ai: aiModeSchema,
    language: reportLanguageSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  }),
  /** The weights in force when the report was built: changing them changes every score, history included. */
  weights: categoryWeightsSchema,
  site: z.object({ score, band: bandSchema.nullable(), pagesAnalyzed: count, pagesTotal: count }),
  /** The pages of the run, then its viewports, in the order of the plan. */
  pages: z.array(reportPageSchema),
  appendix: z.object({
    analyzedCategories: z.array(categorySchema),
    needsReview: count,
    models: z.array(z.string()),
    formula: z.object({
      scoreK: z.number(),
      penalty: z.object({ critical: z.number(), medium: z.number(), low: z.number() }),
      repeatStep: z.number(),
      repeatCap: z.number(),
    }),
  }),
});
export type ReportData = z.infer<typeof reportDataSchema>;
