import * as z from "zod";
import { FlawDotError } from "@flawdot/core-model";
import { allCapturesFailed, describeProgress, describeReport, plain } from "../format.js";
import { UNEXPECTED, logError, textResult, type ToolContent, type ToolResult } from "../result.js";
import { defineTool, type ToolDeps } from "../tool.js";
import { waitUntilSettled } from "../wait.js";

export function createNextTool(deps: ToolDeps) {
  /** One picture, or the reason there is none: a picture that cannot be read does not take the result with it. */
  async function readPicture(
    path: string,
    place: number,
  ): Promise<{ image: ToolContent } | { missing: string }> {
    try {
      return { image: { type: "image", ...(await deps.images(path)) } };
    } catch (error) {
      if (error instanceof FlawDotError) {
        return { missing: `Image ${String(place)} is not attached: ${plain(error.message, 300)}` };
      }
      logError(error, deps.log);
      return { missing: `Image ${String(place)} is not attached: ${UNEXPECTED}` };
    }
  }

  return defineTool({
    name: "flawdot_next",
    title: "Get the state or the result of an analysis",
    description:
      "Returns the state of an analysis started with flawdot_analyze. It waits up to about 20 seconds for the " +
      "analysis to end. If it ends, it returns the result: the scores per category, the numbered problems with how to " +
      "fix them, and the annotated screenshot, whose circles have the same numbers. Otherwise it returns how many " +
      "captures are done. It changes nothing: it can be called again, and gives the same result for a finished run.",
    inputSchema: z.strictObject({
      runId: z.string().min(1).max(64).describe("The run id that flawdot_analyze gave."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args, context): Promise<ToolResult> {
      const run = deps.runs.get(args.runId);

      if (!run.isOver()) {
        const outcome = await waitUntilSettled(run.over, deps.waitMs, context.signal);
        if (outcome === "timeout") return textResult(describeProgress(run.runId, run.progress()));
        if (outcome === "aborted") {
          return textResult(
            "The wait was cancelled. The analysis goes on: call flawdot_next again to follow it.",
          );
        }
      }

      // A run that could not be saved rejects here, and the error goes out through the one translator.
      await run.handle.done;
      const report = await deps.flawdot.report(run.runId);
      const { text, pictures } = describeReport(report);
      const read = await Promise.all(pictures.map((path, index) => readPicture(path, index + 1)));
      const notes = read.flatMap((entry) => ("missing" in entry ? [entry.missing] : []));
      const images = read.flatMap((entry) => ("image" in entry ? [entry.image] : []));

      const content: ToolContent[] = [
        { type: "text", text: [text, ...notes].join("\n") },
        ...images,
      ];
      return allCapturesFailed(report) ? { content, isError: true } : { content };
    },
  });
}
