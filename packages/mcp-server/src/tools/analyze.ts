import * as z from "zod";
import {
  REPORT_LANGUAGES,
  VIEWPORT_NAMES,
  singlePagePlan,
  reportLanguageSchema,
  viewportNameSchema,
} from "@flawdot/core-model";
import { describeStarted } from "../format.js";
import { textResult } from "../result.js";
import { defineTool, type ToolDeps } from "../tool.js";

export function createAnalyzeTool(deps: ToolDeps) {
  return defineTool({
    name: "flawdot_analyze",
    title: "Analyze a web page",
    description:
      "Captures one web page (http or https, localhost included) at the chosen screen sizes, runs the accessibility " +
      "checks of axe-core on it and draws numbered circles on the screenshot. It starts the analysis in the " +
      "background and returns a run id at once: the result comes with flawdot_next. It only reads the page: it " +
      "never fills a form, clicks or logs in. It does not analyze a whole site.",
    inputSchema: z.strictObject({
      url: z
        .string()
        .min(1)
        .max(2048)
        .describe("http or https address of the page, for example http://localhost:3000/"),
      viewports: z
        .array(viewportNameSchema)
        .min(1)
        .max(VIEWPORT_NAMES.length)
        .optional()
        .describe(
          "Screen sizes: desktop is 1440 px wide, tablet 768 px, mobile 390 px. Default: the settings (desktop and mobile).",
        ),
      language: reportLanguageSchema
        .optional()
        .describe(
          `Language of the texts of the rules (${REPORT_LANGUAGES.join(" or ")}). Default: the settings.`,
        ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async execute(args) {
      const settings = await deps.settings.get();
      // From here to `start` nothing is awaited: the check that no other run is going and the start are one step.
      const plan = singlePagePlan(args.url, {
        viewports: args.viewports ?? settings.viewports,
        language: args.language ?? settings.defaultLanguage,
        ai: deps.ai,
      });
      const run = deps.runs.start(plan, () => deps.flawdot.analyze(plan));
      return textResult(describeStarted(run.runId, plan));
    },
  });
}
