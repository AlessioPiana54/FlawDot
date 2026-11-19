import * as z from "zod";
import { httpUrlSchema, runStatusSchema, viewportNameSchema } from "./domain.js";
import { flawDotErrorShapeSchema } from "./errors.js";
import { runIdSchema } from "./ids.js";

export const PHASES = ["capture", "rules", "ai", "done"] as const;
export const phaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof phaseSchema>;

const pageStep = {
  runId: runIdSchema,
  url: httpUrlSchema,
  viewport: viewportNameSchema,
};

/**
 * Progress of a run: drives the "Running" screen and the MCP progress notifications. `total` in `run_started`
 * is the number of page and viewport pairs the run is going to capture.
 */
export const progressEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), runId: runIdSchema, total: z.int().nonnegative() }),
  z.object({ type: z.literal("phase"), ...pageStep, phase: phaseSchema }),
  z.object({
    type: z.literal("capture_done"),
    ...pageStep,
    findings: z.int().nonnegative(),
    costUsd: z.number().nonnegative().nullable(), // null: no AI cost (rules only, or MCP)
  }),
  z.object({ type: z.literal("capture_failed"), ...pageStep, error: flawDotErrorShapeSchema }),
  /**
   * An analyzer failed on a page that was captured. The capture and its picture are kept; only the findings of this
   * analyzer are missing, and its category has no score on this page.
   */
  z.object({
    type: z.literal("analysis_failed"),
    ...pageStep,
    analyzer: z.string().min(1),
    error: flawDotErrorShapeSchema,
  }),
  z.object({
    type: z.literal("run_finished"),
    runId: runIdSchema,
    status: runStatusSchema.exclude(["running"]), // a finished run is never "running"
  }),
]);
export type ProgressEvent = z.infer<typeof progressEventSchema>;
