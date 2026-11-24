import type { ToolDefinition, ToolDeps } from "../tool.js";
import { createAnalyzeTool } from "./analyze.js";
import { createNextTool } from "./next.js";

/** The tools of the server, in the order they are listed. A new tool is a file and a line here. */
export const createTools = (deps: ToolDeps): ToolDefinition[] => [
  createAnalyzeTool(deps),
  createNextTool(deps),
];
