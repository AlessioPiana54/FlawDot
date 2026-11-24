import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type * as z from "zod";
import type { McpServerDeps } from "./ports.js";
import type { RunRegistry } from "./runs.js";
import type { ToolResult } from "./result.js";

/** What every tool gets: the server's dependencies, the registry of runs, and the time to wait. */
export interface ToolDeps extends Omit<McpServerDeps, "version" | "nextWaitMs"> {
  readonly runs: RunRegistry;
  readonly waitMs: number;
}

/** What a call brings with it. `signal` aborts when the client cancels the call or closes the connection. */
export interface ToolContext {
  readonly signal: AbortSignal;
}

export interface ToolSpec<Schema extends z.ZodObject> {
  readonly name: `flawdot_${string}`;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly annotations: ToolAnnotations;
  execute(args: z.infer<Schema>, context: ToolContext): Promise<ToolResult>;
}

/** A tool with the type of its arguments taken out, so the server can keep a list of them. */
export interface ToolDefinition {
  readonly name: string;
  readonly config: {
    readonly title: string;
    readonly description: string;
    readonly inputSchema: z.ZodObject;
    readonly annotations: ToolAnnotations;
  };
  run(args: unknown, context: ToolContext): Promise<ToolResult>;
}

/**
 * The server checks the arguments against `inputSchema` before it calls the tool, and a call with arguments that do not
 * fit never gets here. So the cast below is the type that the check has already proved.
 */
export function defineTool<Schema extends z.ZodObject>(spec: ToolSpec<Schema>): ToolDefinition {
  return {
    name: spec.name,
    config: {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: spec.annotations,
    },
    run: (args, context) => spec.execute(args as z.infer<Schema>, context),
  };
}
