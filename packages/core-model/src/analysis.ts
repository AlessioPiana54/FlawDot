import * as z from "zod";
import {
  aiModeSchema,
  httpUrlSchema,
  pageTargetSchema,
  reportLanguageSchema,
  runStatusSchema,
  viewportNameSchema,
} from "./domain.js";
import { canonicalAddress, originOf } from "./errors.js";
import { projectIdSchema, runIdSchema } from "./ids.js";
import { bandSchema } from "./scoring.js";

const hasNoDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;
const count = z.int().nonnegative();

/**
 * What to analyze. It comes from outside (an MCP tool call, an HTTP body), so it is checked and strict: a key that is
 * not part of it is an error. The run is told how it was started (`entry`) by whoever builds the kernel, not by the plan,
 * because a client of the web server must not be able to claim to be something else.
 */
export const analysisPlanSchema = z
  .strictObject({
    projectOrigin: httpUrlSchema, // "http://localhost:3000": only scheme, host and port count
    pages: z.array(pageTargetSchema).min(1),
    viewports: z.array(viewportNameSchema).min(1),
    language: reportLanguageSchema,
    ai: aiModeSchema,
  })
  // "http://a.com", "http://a.com/" and "HTTP://A.com/#top" are one page, and it must not be captured, or counted, twice.
  .refine((plan) => hasNoDuplicates(plan.pages.map((page) => canonicalAddress(page.url))), {
    message: "A page appears twice",
    path: ["pages"],
  })
  .refine((plan) => hasNoDuplicates(plan.viewports), {
    message: "A viewport appears twice",
    path: ["viewports"],
  })
  // A project is one site: a plan that mixed sites would put their findings and their "ignore" states together.
  .refine(
    (plan) => plan.pages.every((page) => originOf(page.url) === originOf(plan.projectOrigin)),
    { message: "Every page must be on the origin of the project", path: ["pages"] },
  );
export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

/** What a finished run comes to, in numbers: what `RunHandle.done` gives, and what a list of past runs shows. */
export const runSummarySchema = z.object({
  runId: runIdSchema,
  projectId: projectIdSchema,
  status: runStatusSchema.exclude(["running"]), // a summary is of a run that is over
  entry: z.enum(["web", "mcp"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  /** `notRun` are the pairs of page and viewport that were never reached because the run was cancelled. */
  captures: z.object({ total: count, done: count, failed: count, notRun: count }),
  /** The findings that count: the ones that are not ignored, on the captures that are done. */
  findings: count,
  score: z.int().min(0).max(100).nullable(), // "—" when nothing was analyzed
  band: bandSchema.nullable(),
  needsReview: count,
});
export type RunSummary = z.infer<typeof runSummarySchema>;
