import { shrinkPng } from "@flawdot/annotation";
import { createMcpServer, type Log, type McpServerHandle } from "@flawdot/mcp-server";
import type { CoreGraph } from "./compose-core.js";

export interface McpOptions {
  readonly version: string;
  readonly log: Log;
  /** For a test: how long `flawdot_next` waits. */
  readonly nextWaitMs?: number;
}

/** The MCP server on the kernel of `core`. The AI part is done by Claude Code, not by FlawDot, so `ai` is none for now. */
export function composeMcp(core: CoreGraph, options: McpOptions): McpServerHandle {
  return createMcpServer({
    flawdot: core.createKernel("mcp"),
    settings: core.settings,
    images: async (path) => ({
      data: (await shrinkPng(path)).data.toString("base64"),
      mimeType: "image/png",
    }),
    ai: { kind: "none" },
    version: options.version,
    log: options.log,
    ...(options.nextWaitMs === undefined ? {} : { nextWaitMs: options.nextWaitMs }),
  });
}
